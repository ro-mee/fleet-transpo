import { it, expect, vi } from 'vitest';
import { insertReceipt, appendCargoDecision, loadExecutionForUpdate, appendCargoFeedback } from './cargo-execution.repository';
import { cargoFeedbackSchema } from '@/lib/cargo/contracts';
import { cargoPayloadHash } from './cargo-execution.repository';

it('refuses unconfigured repository access before any database operation', async () => {
  const tx = { query: vi.fn() };
  for (const work of [() => insertReceipt({}, {}, tx), () => appendCargoDecision({}, {}, tx), () => loadExecutionForUpdate(1, tx), () => appendCargoFeedback({}, tx)]) await expect(work()).rejects.toMatchObject({ status: 503 });
  expect(tx.query).not.toHaveBeenCalled();
});
it('validates durable event types and refuses acknowledgement as a source decision', () => {
  expect(cargoFeedbackSchema.safeParse({ event_type: 'ACKNOWLEDGED' }).success).toBe(false);
  expect(cargoFeedbackSchema.safeParse({ event_type: 'SOURCE_DECISION_RECORDED', decision: { action: 'ACKNOWLEDGED' } }).success).toBe(false);
});
it('redacts private handover before event validation, hashing, persistence and comparison with stored receipts', async () => {
  const id = '11111111-1111-4111-8111-111111111111', ref = { kind: 'REQUEST', id, revision: 1, hash: 'a'.repeat(64) };
  const handover = { version: 1, signer_name: 'Private supplier', signer_role_or_dept: 'Supply', acknowledgment: 'CARGO_HANDOVER_V1', captured_at: '2026-10-09T08:00:00.000Z', signature: { width: 600, height: 240, strokes: [[[20, 30], [60, 80]]] }, location: { latitude: 14.6, longitude: 121, accuracy_m: 20, captured_at: '2026-10-09T08:00:00.000Z' } };
  const payload = { submission_id: id, manifest_ref: ref, stage: 'PICKUP', observed_at: '2026-10-09T08:00:00Z', lines: [{ line_id: 'oil', observed_quantity: '10', condition: 'INTACT', issue_code: null, remarks: '', evidence_ids: [] }], receiver_confirmation_ref: null };
  const execution = { execution_id: id, version: 2, manifest: { manifest_ref: ref, source_ref: { system: 'PMS', organization_id: 'fixture', external_request_id: 'r1' } } };
  const config = Object.fromEntries(['dataApprovalRef', 'privacyApprovalRef', 'receivingApprovalRef', 'retentionApprovalRef', 'sourceApprovalRef'].map(key => [key, 'simulated:approval']));
  Object.assign(config, { schemaReady: true, simulated: true, environment: 'test' });
  const writes = [];
  const tx = { cargoConfig: config, query: async (sql, params) => {
    if (sql.includes('SELECT * FROM cargo_trip_executions')) return { rows: [execution] };
    if (sql.includes('SELECT payload FROM cargo_receipts')) return { rows: [{ payload: { ...payload, handover } }] };
    if (sql.includes('INSERT INTO cargo_feedback_outbox')) { writes.push(params); return { rows: [{ event_id: id }] }; }
    return { rows: [] };
  } };
  await appendCargoFeedback({ execution, eventType: 'PICKUP_RECORDED', receipt: { receipt_id: id, payload: { ...payload, handover } } }, tx);
  await appendCargoFeedback({ execution, eventType: 'PICKUP_RECORDED', receipt: { receipt_id: id, payload } }, tx);
  expect(writes).toHaveLength(2);
  expect(writes[0][7]).toBe(writes[1][7]);
  expect(writes[0][8]).toBe(cargoPayloadHash(JSON.parse(writes[0][7])));
  expect(writes[0][7]).not.toMatch(/CARGO_HANDOVER_V1|Private supplier|strokes|latitude|handover/);
  expect(cargoFeedbackSchema.safeParse(JSON.parse(writes[0][7])).success).toBe(true);
});
