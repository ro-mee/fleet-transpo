import { describe, it, expect, vi, afterEach } from 'vitest';
import { submitCargoReceipt, recordSourceDecision, clearCargoDeparture, getCargoExecution, recordManualCargoDecision, recordCargoEvidenceUpload, createCargoExecutionService } from './cargo-execution.service';
import { cargoPayloadHash } from './cargo-execution.repository';

const id = '11111111-1111-4111-8111-111111111111';
const manifest = { manifest_ref: { kind: 'REQUEST', id, revision: 1, hash: 'a'.repeat(64) }, source_ref: { system: 'PMS', organization_id: 'fixture', external_request_id: 'r1' }, service_code: 'HOTEL_SUPPLY_TRANSFER', lines: [{ line_id: 'oil', name: 'Oil', quantity_basis: 'TRANSPORT_PACKAGE', expected_quantity: '10', unit: 'box', reference_image_ref: null, handling: [] }] };
const legacyReceipt = () => ({ submission_id: id, manifest_ref: manifest.manifest_ref, stage: 'PICKUP', observed_at: '2026-10-09T08:00:00Z', lines: [{ line_id: 'oil', observed_quantity: '10', condition: 'INTACT', issue_code: null, remarks: '', evidence_ids: [] }], receiver_confirmation_ref: null });
const signedHandover = () => ({ version: 1, signer_name: 'Supplier', signer_role_or_dept: 'Supply', acknowledgment: 'CARGO_HANDOVER_V1', captured_at: '2026-10-09T08:00:00.000Z', signature: { width: 600, height: 240, strokes: [[[20, 30], [60, 80]]] }, location: null });
const assigned = { user: { role: 'driver', driverId: 1, employeeId: 1 } };
function commandService(oldPayload = null) {
  const calls = [];
  const response = { trip_id: 7, can_depart: true, version: 2, original: 'immutable legacy response' };
  const config = Object.fromEntries(['dataApprovalRef', 'privacyApprovalRef', 'receivingApprovalRef', 'retentionApprovalRef', 'sourceApprovalRef', 'safetyApprovalRef', 'fleetApprovalRef'].map(key => [key, 'simulated:approval']));
  Object.assign(config, { schemaReady: true, simulated: true, environment: 'test' });
  const db = { withTransaction: work => work({ query: async sql => {
    calls.push(sql);
    if (sql.includes('SELECT * FROM trips') || sql.includes('JOIN drivers')) return { rows: [{ trip_id: 7, driver_id: 1, dispatch_id: 1, trip_status: 'At Pickup' }] };
    if (sql.includes('SELECT * FROM cargo_trip_executions')) return { rows: [{ execution_id: id, version: 2, manifest, trip_id: 7 }] };
    if (sql.includes('SELECT * FROM cargo_execution_commands')) return { rows: oldPayload ? [{ payload_hash: cargoPayloadHash({ payload: oldPayload, employeeId: 1, driverId: 1 }), response }] : [] };
    if (/^\s*(INSERT|UPDATE)\b/.test(sql)) throw new Error('Unexpected write before validation');
    return { rows: [] };
  } }) };
  return { service: createCargoExecutionService({ db, config }), calls, response };
}

describe('new cargo acknowledgment checks preserve historic command replay', () => {
  it('rejects unsigned new observations before writing any receipt', async () => {
    const { service, calls } = commandService();
    await expect(service.submitCargoReceipt(7, legacyReceipt(), assigned)).rejects.toMatchObject({ status: 400, code: 'CARGO_HANDOVER_REQUIRED' });
    expect(calls.some(sql => /INSERT|UPDATE cargo_/.test(sql))).toBe(false);
  });
  it('returns the exact historical unsigned command response before applying new acknowledgment rules', async () => {
    const payload = legacyReceipt(), { service, response } = commandService(payload);
    expect(await service.submitCargoReceipt(7, payload, assigned)).toEqual(response);
  });
  it('keeps signed retries stable and conflicts when strokes change', async () => {
    const payload = { ...legacyReceipt(), handover: signedHandover() }, { service, response } = commandService(payload);
    expect(await service.submitCargoReceipt(7, payload, assigned)).toEqual(response);
    const changed = { ...payload, handover: { ...payload.handover, signature: { ...payload.handover.signature, strokes: [[[20, 30], [70, 80]]] } } };
    await expect(service.submitCargoReceipt(7, changed, assigned)).rejects.toMatchObject({ status: 409, code: 'CARGO_REPLAY_CONFLICT' });
  });
  it('rejects new captures from the future while keeping validation clock-free for saved replay', async () => {
    const payload = { ...legacyReceipt(), handover: { ...signedHandover(), captured_at: '2099-10-09T08:00:00.000Z' } };
    await expect(commandService().service.submitCargoReceipt(7, payload, assigned)).rejects.toMatchObject({ status: 400, code: 'CARGO_INVALID_HANDOVER' });
    const saved = commandService(payload);
    expect(await saved.service.submitCargoReceipt(7, payload, assigned)).toEqual(saved.response);
  });
});

describe('cargo execution runtime remains disabled', () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each([submitCargoReceipt, recordSourceDecision, clearCargoDeparture, getCargoExecution, recordManualCargoDecision, recordCargoEvidenceUpload])('refuses runtime access without authority before any database call', async operation => {
    await expect(operation(1, {}, {})).rejects.toMatchObject({ status: 503, code: 'CARGO_CONFIGURATION_REQUIRED' });
  });
  it('does not turn an arbitrary config object into an operational provider', () => {
    expect(() => createCargoExecutionService({ config: { schemaReady: true } })).toThrow(expect.objectContaining({ status: 503 }));
  });
  it('refuses even a complete simulated configuration in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const config = Object.fromEntries(['dataApprovalRef', 'privacyApprovalRef', 'receivingApprovalRef', 'retentionApprovalRef', 'sourceApprovalRef', 'safetyApprovalRef', 'fleetApprovalRef'].map(key => [key, 'simulated:approval']));
    expect(() => createCargoExecutionService({ config: { ...config, schemaReady: true, simulated: true, environment: 'test' }, db: { withTransaction: async () => {} } })).toThrow(expect.objectContaining({ status: 503 }));
  });
});

it('approved staff can read without being treated as the driver',async()=>{
  const config=Object.fromEntries(['dataApprovalRef','privacyApprovalRef','receivingApprovalRef','retentionApprovalRef','sourceApprovalRef','safetyApprovalRef','fleetApprovalRef','staffReadApprovalRef'].map(key=>[key,'simulated:approval']));
  Object.assign(config,{schemaReady:true,simulated:true,environment:'test'});
  const calls=[],db={withTransaction:work=>work({query:async(sql)=>{calls.push(sql);return {rows:sql.includes('SELECT * FROM trips')?[{trip_id:7,driver_id:1,dispatch_id:1}]:sql.includes('FROM employees')?[{employee_id:2}]:sql.includes('SELECT * FROM cargo_trip_executions')?[{execution_id:'x',trip_id:7,version:1,manifest:{manifest_ref:{kind:'REQUEST',id:'11111111-1111-4111-8111-111111111111',revision:1,hash:'a'.repeat(64)},source_ref:{system:'PMS',organization_id:'fixture',external_request_id:'r1'},service_code:'HOTEL_SUPPLY_TRANSFER',lines:[{line_id:'oil',name:'Oil',quantity_basis:'TRANSPORT_PACKAGE',expected_quantity:'10',unit:'box',reference_image_ref:null,handling:[]}]}}]:[]};}})};
  const service=createCargoExecutionService({db,config,authorizeStaffRead:async()=>true});
  expect(await service.getCargoExecution(7,{user:{role:'management',employeeId:2}})).toMatchObject({trip_id:7});
  expect(calls.some(sql=>sql.includes('JOIN drivers'))).toBe(false);
  expect(calls.find(sql=>sql.includes('FROM cargo_receipts'))).toContain('LIMIT 2');
  await expect(createCargoExecutionService({db,config}).getCargoExecution(7,{user:{role:'admin',employeeId:2}})).rejects.toMatchObject({status:403});
});
