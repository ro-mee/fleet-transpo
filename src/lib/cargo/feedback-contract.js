import { z } from 'zod';
import { cargoFeedbackSchema, cargoFeedbackEventTypeSchema } from './contracts';
import { cargoPayloadHash } from '@/services/cargo-execution.repository';

export { cargoFeedbackSchema, cargoFeedbackEventTypeSchema };

export const cargoFeedbackEnvelopeSchema = z.object({
  event_id: z.string().uuid(),
  payload: cargoFeedbackSchema,
  payload_hash: z.string().regex(/^[a-f0-9]{64}$/),
  attempt: z.number().int().positive().max(10),
}).strict().superRefine((event, ctx) => {
  if (event.payload.execution_id.length !== 36) ctx.addIssue({ code: 'custom', message: 'Invalid execution identity.' });
});

export const cargoFeedbackAckSchema = z.object({
  event_id: z.string().uuid(),
  received: z.literal(true),
  fixture_outcome: z.enum(['ACCEPT', 'WAIT', 'REJECT']).optional(),
}).strict();

export function validateCargoFeedbackEnvelope(input) {
  const event = cargoFeedbackEnvelopeSchema.parse(input);
  if (cargoPayloadHash(event.payload) !== event.payload_hash) throw new Error('Cargo feedback payload hash does not match.');
  return event;
}
