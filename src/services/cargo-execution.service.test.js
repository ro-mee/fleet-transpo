import { describe, it, expect, vi, afterEach } from 'vitest';
import { submitCargoReceipt, recordSourceDecision, clearCargoDeparture, getCargoExecution, recordManualCargoDecision, recordCargoEvidenceUpload, createCargoExecutionService } from './cargo-execution.service';

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
