import { describe, expect, it } from 'vitest';
import { cargoFeedbackSchema } from './contracts';
import { cargoFeedbackEnvelopeSchema } from './feedback-contract';

const payload = {
  execution_id: '11111111-1111-4111-8111-111111111111', execution_version: 2,
  source_ref: { system: 'PMS', organization_id: 'hotel-a', external_request_id: 'request-1' },
  event_type: 'PICKUP_RECORDED', manifest_ref: { kind: 'REQUEST', id: '22222222-2222-4222-8222-222222222222', revision: 1, hash: 'a'.repeat(64) },
  receipt: { receipt_id: '33333333-3333-4333-8333-333333333333', payload: { submission_id: '44444444-4444-4444-8444-444444444444', manifest_ref: { kind: 'REQUEST', id: '22222222-2222-4222-8222-222222222222', revision: 1, hash: 'a'.repeat(64) }, stage: 'PICKUP', observed_at: '2026-10-09T08:00:00Z', lines: [{ line_id: 'oil', observed_quantity: '9', condition: 'INTACT', issue_code: 'SHORTAGE', remarks: 'Nine boxes', evidence_ids: [] }], receiver_confirmation_ref: null } },
  decision: null,
};

describe('cargo feedback transport contract', () => {
  it('validates a stable outbox envelope using the Task 5 event contract', () => {
    const parsed = cargoFeedbackEnvelopeSchema.parse({ event_id: '55555555-5555-4555-8555-555555555555', payload, payload_hash: 'b'.repeat(64), attempt: 1 });
    expect(parsed.payload.event_type).toBe('PICKUP_RECORDED');
  });
  it('rejects unvalidated bodies and malformed source identities', () => {
    expect(cargoFeedbackSchema.safeParse({ ...payload, body_url: 'https://evil.test' }).success).toBe(false);
    expect(cargoFeedbackEnvelopeSchema.safeParse({ event_id: '55555555-5555-4555-8555-555555555555', payload: { ...payload, source_ref: { ...payload.source_ref, organization_id: '' } }, payload_hash: 'b'.repeat(64), attempt: 1 }).success).toBe(false);
  });
});
