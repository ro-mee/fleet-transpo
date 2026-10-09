import { z } from 'zod';
import { normalizeQuantity, compareQuantities } from './quantities';

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
}).strict().superRefine((line, ctx) => {
  // Zod may run this refinement after the field already reported an issue.
  const expected = quantity.safeParse(line.expected_quantity);
  if (!expected.success) return;
  if (compareQuantities(expected.data, '0') <= 0 || (line.quantity_basis === 'TRANSPORT_PACKAGE' && expected.data.includes('.'))) {
    ctx.addIssue({ code: 'custom', message: 'Expected quantity must be positive; package counts must be integers.' });
  }
});
const uniqueLines = schema => z.array(schema).min(1).max(500).refine(lines => new Set(lines.map(line => line.line_id)).size === lines.length, 'Line IDs must be unique.');
export const manifestContentSchema = z.object({ source_ref: sourceRefSchema, service_code: cargoServiceSchema, lines: uniqueLines(lineSchema) }).strict();
export const manifestSchema = manifestContentSchema.extend({ manifest_ref: manifestRefSchema }).superRefine((manifest, ctx) => {
  if ((manifest.manifest_ref.kind === 'SUPPLY') !== (manifest.source_ref.system === 'SCM')) ctx.addIssue({ code: 'custom', message: 'Manifest kind and source must agree.' });
});
export const requestManifestEnvelopeSchema = z.object({ event_id: text(255), revision: z.number().int().positive().max(2147483647), manifest: manifestContentSchema }).strict();
export const receiptSchema = z.object({
  submission_id: uuid, manifest_ref: manifestRefSchema, stage: z.enum(['PICKUP', 'DELIVERY']), observed_at: z.string().datetime({ offset: true }),
  lines: uniqueLines(z.object({ line_id: text(128), observed_quantity: quantity, condition: z.enum(['INTACT', 'DAMAGED']), issue_code: z.enum(['SHORTAGE', 'EXCESS', 'DAMAGE']).nullable(), remarks: z.string().max(2000), evidence_ids: z.array(uuid).max(5) }).strict()),
  receiver_confirmation_ref: uuid.nullable(),
}).strict();
export const decisionSchema = z.object({ event_id: uuid, receipt_id: uuid, manifest_hash: z.string().regex(/^[a-f0-9]{64}$/), action: z.enum(['WAIT', 'ACCEPT_OBSERVED', 'REJECT_PICKUP']), reason: text(2000) }).strict();

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
