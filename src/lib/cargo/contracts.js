import { z } from 'zod';
import { normalizeQuantity, compareQuantities } from './quantities';
import { physicalManifestLineSchema } from './physical-load';
import { validateCargoHandover } from '../../../shared/cargo-handover';

const text = max => z.string().min(1).max(max).refine(value => value.trim().length > 0);
const uuid = z.string().uuid();
const quantity = z.string().refine(value => {
  try { normalizeQuantity(value, { basis: 'UNIT' }); return true; } catch { return false; }
}, 'Use a nonnegative decimal string with at most three decimal places.').transform(value => normalizeQuantity(value, { basis: 'UNIT' }));
export const cargoServiceSchema = z.enum(['RESTAURANT_SUPPLY_PICKUP', 'RESTAURANT_FOOD_DELIVERY', 'HOTEL_SUPPLY_TRANSFER']);
export const manifestRefSchema = z.object({ kind: z.enum(['REQUEST', 'SUPPLY']), id: uuid, revision: z.number().int().positive().max(2147483647), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const sourceRefSchema = z.object({ system: z.enum(['PMS', 'POS', 'SCM']), organization_id: text(128), external_request_id: text(255) }).strict();
const lineSchema = z.object({
  line_id: text(128), name: text(500), quantity_basis: z.enum(['TRANSPORT_PACKAGE', 'UNIT']),
  expected_quantity: quantity, unit: text(32), reference_image_ref: uuid.nullable(),
  handling: z.array(z.enum(['FRAGILE', 'NO_STACK', 'FOOD_SEPARATION', 'SECURE_LOAD', 'SPILL_CONTAINMENT'])).max(5),
  source_sku_ref: text(128).optional(),
  physical: physicalManifestLineSchema.optional(),
}).strict().superRefine((line, ctx) => {
  // Zod may run this refinement after the field already reported an issue.
  const expected = quantity.safeParse(line.expected_quantity);
  if (!expected.success) return;
  if (compareQuantities(expected.data, '0') <= 0 || (line.quantity_basis === 'TRANSPORT_PACKAGE' && expected.data.includes('.'))) {
    ctx.addIssue({ code: 'custom', message: 'Expected quantity must be positive; package counts must be integers.' });
  }
});
const uniqueLines = schema => z.array(schema).min(1).max(500).refine(lines => new Set(lines.map(line => line.line_id)).size === lines.length, 'Line IDs must be unique.');
const manifestContent = z.object({
  source_ref: sourceRefSchema, service_code: cargoServiceSchema, lines: uniqueLines(lineSchema),
  physical_contract_version: z.literal(1).optional(),
}).strict();
function validatePhysicalVersion(manifest, ctx) {
  if (!Array.isArray(manifest.lines)) return;
  manifest.lines.forEach((line, index) => {
    if (manifest.physical_contract_version === 1) {
      if (!line.physical) ctx.addIssue({ code: 'custom', path: ['lines', index, 'physical'], message: 'Versioned physical manifests require package facts for every line.' });
      else if (line.quantity_basis === 'TRANSPORT_PACKAGE' && line.expected_quantity !== String(line.physical.transport_package_count)) {
        ctx.addIssue({ code: 'custom', path: ['lines', index, 'physical', 'transport_package_count'], message: 'Package expectations and transport package counts must agree.' });
      }
    } else if (line.physical || line.source_sku_ref !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['physical_contract_version'], message: 'Physical facts require an explicit physical contract version.' });
    }
  });
}
export const manifestContentSchema = manifestContent.superRefine(validatePhysicalVersion);
export const manifestSchema = manifestContent.extend({ manifest_ref: manifestRefSchema }).superRefine(validatePhysicalVersion).superRefine((manifest, ctx) => {
  if ((manifest.manifest_ref.kind === 'SUPPLY') !== (manifest.source_ref.system === 'SCM')) ctx.addIssue({ code: 'custom', message: 'Manifest kind and source must agree.' });
});
export const requestManifestEnvelopeSchema = z.object({ event_id: text(255), revision: z.number().int().positive().max(2147483647), manifest: manifestContentSchema }).strict();
const handoverSchema = z.unknown().transform((value, ctx) => {
  try { return validateCargoHandover(value); }
  catch { ctx.addIssue({ code: 'custom', message: 'Invalid cargo handover acknowledgment.' }); return z.NEVER; }
});
export const receiptSchema = z.object({
  submission_id: uuid, manifest_ref: manifestRefSchema, stage: z.enum(['PICKUP', 'DELIVERY']), observed_at: z.string().datetime({ offset: true }),
  lines: uniqueLines(z.object({ line_id: text(128), observed_quantity: quantity, condition: z.enum(['INTACT', 'DAMAGED']), issue_code: z.enum(['SHORTAGE', 'EXCESS', 'DAMAGE']).nullable(), remarks: z.string().max(2000), evidence_ids: z.array(uuid).max(5) }).strict()),
  receiver_confirmation_ref: uuid.nullable(),
  handover: handoverSchema.optional(),
}).strict();
// Only new submissions apply clock checks. Historical parsing/replay is deterministic.
export function assertNewReceiptHandover(payload, now = Date.now()) {
  const fail = (code, message) => { throw Object.assign(new Error(message), { code, status: 400 }); };
  if (!payload.handover) fail('CARGO_HANDOVER_REQUIRED', 'Capture the cargo handover acknowledgment.');
  if ([payload.handover.captured_at, payload.handover.location?.captured_at].filter(Boolean).some(value => Date.parse(value) > now + 300000)) {
    fail('CARGO_INVALID_HANDOVER', 'Cargo handover capture time is ahead of the server time.');
  }
}
const publicReceiptSchema = receiptSchema.omit({ handover: true }).strict();
export function cargoFeedbackReceiptPayload(payload) {
  const receipt = receiptSchema.parse(payload);
  return publicReceiptSchema.parse(Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== 'handover')));
}
export const decisionSchema = z.object({ event_id: uuid, receipt_id: uuid, manifest_hash: z.string().regex(/^[a-f0-9]{64}$/), action: z.enum(['WAIT', 'ACCEPT_OBSERVED', 'REJECT_PICKUP']), reason: text(2000) }).strict();

export const cargoFeedbackEventTypeSchema = z.enum(['PICKUP_RECORDED', 'DISCREPANCY_REPORTED', 'SOURCE_DECISION_RECORDED', 'DELIVERY_RECORDED', 'TRANSPORT_CLOSED']);
export const cargoFeedbackSchema = z.object({
  execution_id: uuid, execution_version: z.number().int().positive(), source_ref: sourceRefSchema,
  event_type: cargoFeedbackEventTypeSchema, manifest_ref: manifestRefSchema,
  receipt: z.object({ receipt_id: uuid, payload: publicReceiptSchema }).strict().nullable(),
  decision: z.object({ decision_id: uuid, payload: decisionSchema }).strict().nullable(),
}).strict().superRefine((event, ctx) => {
  const invalid = message => ctx.addIssue({ code: 'custom', message });
  if (event.event_type !== 'TRANSPORT_CLOSED' && !event.receipt) invalid('Receipt is required.');
  if ((event.event_type === 'SOURCE_DECISION_RECORDED') !== Boolean(event.decision)) invalid('Decision must match event type.');
  if (event.receipt && Object.keys(event.manifest_ref).some(key => event.receipt.payload.manifest_ref[key] !== event.manifest_ref[key])) invalid('Receipt manifest mismatch.');
  if (event.decision && (event.decision.payload.receipt_id !== event.receipt?.receipt_id || event.decision.payload.manifest_hash !== event.manifest_ref.hash)) invalid('Decision receipt mismatch.');
  if (event.event_type === 'PICKUP_RECORDED' && event.receipt?.payload.stage !== 'PICKUP') invalid('Pickup receipt required.');
  if (event.event_type === 'DELIVERY_RECORDED' && event.receipt?.payload.stage !== 'DELIVERY') invalid('Delivery receipt required.');
});

export function validateReceiptAgainstManifest(input, expected) {
  const receipt = receiptSchema.parse(input), manifest = manifestSchema.parse(expected);
  if (Object.keys(manifest.manifest_ref).some(key => receipt.manifest_ref[key] !== manifest.manifest_ref[key])) throw new Error('Stale manifest reference.');
  if (receipt.lines.length !== manifest.lines.length) throw new Error('Observe every manifest line.');
  for (const line of receipt.lines) {
    const original = manifest.lines.find(item => item.line_id === line.line_id);
    if (!original) throw new Error('Unknown manifest line.');
    normalizeQuantity(line.observed_quantity, { basis: original.quantity_basis });
  }
  return receipt;
}
