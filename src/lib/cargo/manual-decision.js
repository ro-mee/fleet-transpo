import { z } from 'zod';
import { decisionSchema, sourceRefSchema } from './contracts';

const reference = z.string().trim().min(1).max(255).refine(value => !/https?:\/\//i.test(value));
const evidenceIds = z.array(z.string().uuid()).min(1).max(5).refine(ids => new Set(ids).size === ids.length);
export const manualDecisionSchema = decisionSchema.extend({
  approver_identity: reference,
  approver_reference: reference,
  communicated_at: z.string().datetime({ offset: true }),
  communication_evidence_ids: evidenceIds,
}).strict();

// This proof comes from an independently approved server resolver, never JSON
// submitted by the staff member. Actual communication evidence is mandatory.
export const manualAuthorityProofSchema = z.object({
  kind: z.literal('SOURCE_COMMUNICATION'),
  method: z.literal('simulated-fixture'),
  reference,
  approval_ref: reference,
  source_ref: sourceRefSchema,
  receipt_id: z.string().uuid(),
  manifest_hash: z.string().regex(/^[a-f0-9]{64}$/),
  action: decisionSchema.shape.action,
  reason: decisionSchema.shape.reason,
  approver_identity: reference,
  approver_reference: reference,
  communicated_at: z.string().datetime({ offset: true }),
  evidence_ids: evidenceIds,
  simulated: z.literal(true),
}).strict();
