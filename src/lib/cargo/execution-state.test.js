import { describe, it, expect } from 'vitest';
import { deriveCargoState } from './execution-state';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const manifest = { manifest_ref: { kind: 'REQUEST', id: id(1), revision: 1, hash: 'a'.repeat(64) }, source_ref: { system: 'PMS', organization_id: 'hotel', external_request_id: 'r1' }, service_code: 'HOTEL_SUPPLY_TRANSFER', lines: [{ line_id: 'oil', name: 'Oil', quantity_basis: 'TRANSPORT_PACKAGE', expected_quantity: '10', unit: 'box', reference_image_ref: null, handling: [] }] };
const handover = { version: 1, signer_name: 'Staff', signer_role_or_dept: 'Supply', acknowledgment: 'CARGO_HANDOVER_V1', captured_at: '2026-10-09T08:00:00.000Z', signature: { width: 600, height: 240, strokes: [[[20, 30], [60, 80]]] }, location: null };
const receipt = (stage, quantity, version = 2) => ({ receipt_id: id(version), execution_id: id(99), execution_version: version, manifest_hash: manifest.manifest_ref.hash, payload: { submission_id: id(version + 20), manifest_ref: manifest.manifest_ref, stage, observed_at: '2026-10-09T08:00:00Z', lines: [{ line_id: 'oil', observed_quantity: quantity, condition: 'INTACT', issue_code: null, remarks: '', evidence_ids: [] }], receiver_confirmation_ref: null } });
const pickup = receipt('PICKUP', '9');
const decision = { decision_id: id(3), receipt_id: pickup.receipt_id, execution_version: 3, manifest_hash: manifest.manifest_ref.hash, source_system: 'PMS', source_organization_id: 'hotel', action: 'ACCEPT_OBSERVED' };
const proof = (kind, receipt) => ({ kind, receipt_id: receipt.receipt_id, manifest_hash: manifest.manifest_ref.hash, approval_ref: 'simulated:approval', method: 'simulated-fixture', reference: id(50), simulated: true });
const clearance = { clearance_id: id(4), execution_id: pickup.execution_id, receipt_id: pickup.receipt_id, decision_id: decision.decision_id, manifest_hash: manifest.manifest_ref.hash, version: 4, safety_evidence_ref: id(50), safety_proof: proof('POST_LOAD_SECUREMENT', pickup) };
const delivery = receipt('DELIVERY', '9', 5);
delivery.receiver_proof = proof('RECEIVER_CONFIRMATION', delivery);
const run = (overrides = {}) => deriveCargoState({ manifest, pickup, delivery: null, decision: null, clearance: null, ...overrides });
pickup.payload.handover = handover;
delivery.payload.handover = handover;

describe('cargo state from immutable records', () => {
  it('requires actual manager acceptance for a clean internal pickup', () => {
    const internal = { ...manifest, source_ref: { ...manifest.source_ref, system: 'INTERNAL', organization_id: 'fleetops' } };
    const clean = { ...pickup, payload: { ...pickup.payload, lines: [{ ...pickup.payload.lines[0], observed_quantity: '10' }] } };
    expect(run({ manifest: internal, pickup: clean, clearance: { ...clearance, decision_id: null } })).toMatchObject({ can_depart: false, pickup_state: 'AWAITING_DECISION' });
  });
  it('allows a current internal receiving review to explicitly accept a delivery difference', () => {
    const internal = { ...manifest, source_ref: { ...manifest.source_ref, system: 'INTERNAL', organization_id: 'fleetops' } };
    const received = { ...delivery, payload: { ...delivery.payload, lines: [{ ...delivery.payload.lines[0], observed_quantity: '8' }] }, receiver_proof: { ...delivery.receiver_proof, method: 'internal-manager-review', accepted_discrepancy: true } };
    const result = run({ manifest: internal, decision: { ...decision, source_system: 'INTERNAL', source_organization_id: 'fleetops' }, clearance, delivery: received });
    expect(result).toMatchObject({ can_complete: true, delivery_state: 'CONFIRMED' });
    expect(result.lines[0].delivery_shortage).toBe('1');
  });
  it('keeps unsigned history readable but cannot use legacy pickup clearance to depart or complete', () => {
    const legacy = { ...pickup, payload: { ...pickup.payload } };
    delete legacy.payload.handover;
    const state = run({ pickup: legacy, decision, clearance, delivery });
    expect(state.can_depart).toBe(false);
    expect(state.can_complete).toBe(false);
    expect(state.blockers).toContainEqual(expect.objectContaining({ code: 'CARGO_PICKUP_HANDOVER_REQUIRED' }));
  });
  it('requires the current delivery acknowledgment despite independently resolved receiver proof or incident IDs', () => {
    const legacy = { ...delivery, incident_id: id(55), payload: { ...delivery.payload } };
    delete legacy.payload.handover;
    const state = run({ decision, clearance, delivery: legacy });
    expect(state.can_depart).toBe(true);
    expect(state.can_complete).toBe(false);
    expect(state.blockers).toContainEqual(expect.objectContaining({ code: 'CARGO_DELIVERY_HANDOVER_REQUIRED' }));
  });
  it('waits for acceptance of a 10 to 9 pickup', () => expect(run()).toMatchObject({ pickup_state: 'AWAITING_DECISION', can_depart: false }));
  it('keeps order shortage when all collected boxes arrive', () => {
    const state = run({ decision, clearance, delivery });
    expect(state).toMatchObject({ pickup_state: 'READY', delivery_state: 'CONFIRMED', can_complete: true });
    expect(state.lines[0]).toMatchObject({ expected_quantity: '10', pickup_quantity: '9', delivery_quantity: '9', order_shortage: '1', delivery_shortage: '0' });
  });
  it('keeps missing observations and their shortages null', () => expect(run({ pickup: null }).lines[0]).toMatchObject({ pickup_quantity: null, delivery_quantity: null, order_shortage: null, delivery_shortage: null }));
  it('handles zero observations without replacing them with missing counts', () => expect(run({ pickup: receipt('PICKUP', '0') }).lines[0]).toMatchObject({ pickup_quantity: '0', order_shortage: '10' }));
  it('requires Fleet and actual post-load proof even for a clean pickup', () => {
    const clean = receipt('PICKUP', '10');
    clean.payload.handover = handover;
    expect(run({ pickup: clean }).can_depart).toBe(false);
    expect(run({ pickup: clean, clearance: { ...clearance, decision_id: null, safety_proof: null } }).pickup_state).not.toBe('READY');
    expect(run({ pickup: clean, clearance: { ...clearance, decision_id: null } }).pickup_state).toBe('READY');
  });
  it.each(['WAIT', 'REJECT_PICKUP'])('holds %s decisions', action => expect(run({ decision: { ...decision, action }, clearance }).can_depart).toBe(false));
  it.each([{ receipt_id: id(8) }, { manifest_hash: 'b'.repeat(64) }, { source_organization_id: 'foreign' }, { execution_version: 1 }])('cannot inherit a stale decision %j', changes => expect(run({ decision: { ...decision, ...changes }, clearance }).can_depart).toBe(false));
  it('invalidates old decisions and clearance after recount', () => expect(run({ pickup: receipt('PICKUP', '9', 6), decision, clearance }).can_depart).toBe(false));
  it('a newer decision requires another clearance', () => expect(run({ decision: { ...decision, decision_id: id(6), execution_version: 6 }, clearance }).can_depart).toBe(false));
  it('a typed receiver reference alone cannot confirm delivery', () => {
    const state = run({ decision, clearance, delivery: { ...delivery, receiver_proof: null, payload: { ...delivery.payload, receiver_confirmation_ref: id(50) } } });
    expect(state.can_complete).toBe(false);
    expect(state.blockers).toContainEqual(expect.objectContaining({ code: 'CARGO_RECEIVER_CONFIRMATION_REQUIRED' }));
  });
  it('keeps delivery shortage separate and refuses overage completion', () => {
    expect(run({ decision, clearance, delivery: { ...delivery, payload: receipt('DELIVERY', '8', 5).payload } }).lines[0].delivery_shortage).toBe('1');
    expect(run({ decision, clearance, delivery: { ...delivery, payload: receipt('DELIVERY', '10', 5).payload } }).can_complete).toBe(false);
  });
  it('requires review for damage and overage without inventing a shortage', () => {
    for (const line of [{ observed_quantity: '11' }, { condition: 'DAMAGED', issue_code: 'DAMAGE' }]) {
      const observed = { ...pickup, payload: { ...pickup.payload, lines: [{ ...pickup.payload.lines[0], observed_quantity: '10', ...line }] } };
      expect(run({ pickup: observed }).pickup_state).toBe('AWAITING_DECISION');
      expect(run({ pickup: observed }).lines[0].order_shortage).toBe('0');
    }
  });
  it.each([
    { lines: [] }, { lines: [pickup.payload.lines[0], pickup.payload.lines[0]] },
    { lines: [{ ...pickup.payload.lines[0], line_id: 'foreign' }] },
    { lines: [{ ...pickup.payload.lines[0], observed_quantity: 'NaN' }] },
    { lines: [{ ...pickup.payload.lines[0], issue_code: 'WRONG_ITEM' }] }, { correction_of: id(2) },
  ])('rejects unsupported or malformed observations without arithmetic exceptions', change => {
    expect(() => run({ pickup: { ...pickup, payload: { ...pickup.payload, ...change } } })).toThrow(expect.objectContaining({ code: 'CARGO_INVALID_RECEIPT', status: 400 }));
  });
});
