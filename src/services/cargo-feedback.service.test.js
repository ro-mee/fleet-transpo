import { describe, expect, it, vi } from 'vitest';
const auditMock = vi.hoisted(() => ({ writeAuditRequired: vi.fn(async () => ({ log_id: 99 })) }));
vi.mock('@/lib/audit', () => auditMock);
import { createCargoFeedbackWorker, createCargoFeedbackStaffFixture, listCargoFeedback } from './cargo-feedback.service';
import { cargoPayloadHash } from './cargo-execution.repository';

const event = (id, version, execution='11111111-1111-4111-8111-111111111111') => { const payload={ execution_id: execution, execution_version: version, source_ref: { system: 'PMS', organization_id: 'hotel-a', external_request_id: 'r1' }, event_type: 'TRANSPORT_CLOSED', manifest_ref: { kind: 'REQUEST', id: '22222222-2222-4222-8222-222222222222', revision: 1, hash: 'a'.repeat(64) }, receipt: null, decision: null }; return { event_id: id, execution_id: execution, execution_version: version, source_system: 'PMS', source_organization_id: 'hotel-a', event_type: 'TRANSPORT_CLOSED', receipt_id: null, decision_id: null, payload, payload_hash: cargoPayloadHash(payload), status: 'PENDING', attempts: 0 }; };

function createHarness(rows) {
  const calls=[]; let next=0;
  const db={ withTransaction: async fn=>fn({ query: async (sql,params=[])=>{
    calls.push({sql,params});
    if(sql.includes('SELECT')&&sql.includes('cargo_feedback_outbox')) return {rows: rows.slice(next++, next).map(row=>({...row,attempts:row.attempts+1,lease_token:params[2]}))};
    if(sql.includes('UPDATE cargo_feedback_outbox')) return {rowCount:1,rows:[]};
    return {rows:[]};
  } }) };
  return {db,calls};
}

describe('cargo feedback worker', () => {
  it('leases before sending, validates the ACK, and never applies its fixture outcome as a decision', async () => {
    const row=event('11111111-1111-4111-8111-111111111111',1), {db,calls}=createHarness([row]);
    const gateway={send:vi.fn(async e=>({event_id:e.event_id,received:true,fixture_outcome:'ACCEPT'}))};
    const worker=createCargoFeedbackWorker({db,gateway,environment:'test'});
    const result = await worker.deliverCargoFeedback({now:new Date('2026-10-10T00:00:00Z')});
    expect(calls.map(call=>call.sql)).toHaveLength(2);
    expect(gateway.send).toHaveBeenCalled();
    expect(calls.at(-1).sql).toContain("status='ACKNOWLEDGED'");
    expect(result).toEqual({acknowledged:1,pending:0,failed:0});
    expect(gateway.send).toHaveBeenCalledWith(expect.objectContaining({event_id:row.event_id}));
    expect(calls[0].sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(calls.some(call=>call.sql.includes('UPDATE cargo_decision_inbox'))).toBe(false);
    expect(calls.at(-1).params[2]).toBe(row.event_id);
    expect(calls.at(-1).params[3]).toBe(calls[0].params[2]);
  });
  it('treats timeout and malformed ACK as retryable feedback failures', async () => {
    for(const gateway of [{send:async()=>{throw new Error('network');}},{send:async()=>({event_id:'other',received:true})}]) {
      const {db}=createHarness([event('11111111-1111-4111-8111-111111111111',1)]);
      const result=await createCargoFeedbackWorker({db,gateway,environment:'test'}).deliverCargoFeedback({now:new Date('2026-10-10T00:00:00Z')});
      expect(result).toEqual({acknowledged:0,pending:1,failed:0});
    }
  });
  it('uses the minute-one retry and retains the event at attempt ten for review', async () => {
    const base=new Date('2026-10-10T00:00:00Z');
    const first=createHarness([event('11111111-1111-4111-8111-111111111111',1)]);
    await createCargoFeedbackWorker({db:first.db,gateway:{send:async()=>{throw Object.assign(new Error('timeout'),{code:'GATEWAY_TIMEOUT'});}},environment:'test'}).deliverCargoFeedback({now:base});
    expect(first.calls.at(-1).params[1]).toEqual(new Date(base.getTime()+60_000));
    expect(first.calls.at(-1).params[2]).toBe('GATEWAY_TIMEOUT');
    const finalRow=event('22222222-2222-4222-8222-222222222222',9); finalRow.status='PENDING'; finalRow.attempts=9;
    const last=createHarness([finalRow]);
    expect(await createCargoFeedbackWorker({db:last.db,gateway:{send:async()=>{throw new Error('timeout');}},environment:'test'}).deliverCargoFeedback({now:base})).toEqual({acknowledged:0,pending:0,failed:1});
    expect(last.calls.at(-1).sql).toContain("status=$1"); expect(last.calls.at(-1).params[0]).toBe('FAILED');
    expect(last.calls.at(-1).params[2]).toBe('GATEWAY_DELIVERY_FAILED');
  });
  it('rejects batch sizes outside the bounded worker limit', async () => {
    const worker=createCargoFeedbackWorker({db:{},gateway:{},environment:'test'});
    await expect(worker.deliverCargoFeedback({batchSize:501})).rejects.toMatchObject({status:400});
  });
  it('returns unavailable before leasing anything when no provider is configured', async () => {
    const {db,calls}=createHarness([event('11111111-1111-4111-8111-111111111111',1)]);
    await expect(createCargoFeedbackWorker({db,environment:'test'}).deliverCargoFeedback()).rejects.toMatchObject({status:503,code:'CARGO_CONFIGURATION_REQUIRED'});
    expect(calls).toHaveLength(0);
  });
  it('keeps staff reads closed by default and scopes fixture retry to the same trip and source', async () => {
    const query=vi.fn(async(sql)=>{
      if(sql.includes('FROM trips t JOIN cargo_trip_executions'))return {rows:[{trip_id:9,execution_id:'execution',manifest:{source_ref:{system:'PMS',organization_id:'hotel-a'}}}]};
      if(sql.includes('FROM employees'))return {rows:[{employee_id:4}]};
      if(sql.includes('FROM cargo_feedback_outbox o WHERE'))return {rows:[{event_id:'11111111-1111-4111-8111-111111111111',status:'PENDING'}]};
      if(sql.includes('FROM cargo_feedback_outbox')&&sql.includes('FOR UPDATE'))return {rows:[{event_id:'11111111-1111-4111-8111-111111111111',status:'FAILED',attempts:10,source_system:'PMS',source_organization_id:'hotel-a'}]};
      if(sql.includes("SET status='PENDING'"))return {rowCount:1,rows:[{event_id:'11111111-1111-4111-8111-111111111111',status:'PENDING',attempts:0}]};
      return {rows:[]};
    });
    const db={withTransaction:async work=>work({query})};
    await expect(listCargoFeedback({tripId:1,sourceSystem:'PMS',organizationId:'hotel-a'})).rejects.toMatchObject({status:503,code:'CARGO_CONFIGURATION_REQUIRED'});
    const session={user:{employeeId:4,role:'admin'}};
    const fixture=createCargoFeedbackStaffFixture({db,config:{simulated:true,approvalRef:'fixture'},authorizeStaff:async()=>true,environment:'test'});
    const scope={tripId:9,sourceSystem:'PMS',organizationId:'hotel-a'};
    await fixture.listCargoFeedback({req:new Request('http://localhost'),session,...scope,limit:25});
    expect(query.mock.calls[2][1]).toEqual(['execution','PMS','hotel-a',25]);
    const result=await fixture.retryCargoFeedback({req:new Request('http://localhost'),session,...scope,eventId:'11111111-1111-4111-8111-111111111111'});
    expect(query.mock.calls[5][1]).toEqual(['execution','11111111-1111-4111-8111-111111111111']);
    expect(result.event_id).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('lets an authorized staff retry start a fresh bounded attempt cycle and deliver the same immutable event', async () => {
    const eventId='11111111-1111-4111-8111-111111111111';
    const persisted=event(eventId,1); persisted.status='FAILED'; persisted.attempts=10; persisted.last_error_code='GATEWAY_TIMEOUT';
    const calls=[]; let current={...persisted};
    const db={withTransaction:async work=>{
      let draft={...current};
      const tx={query:async(sql,params=[])=>{
        calls.push({sql,params});
        if(sql.includes('FROM trips t JOIN cargo_trip_executions')) return {rows:[{trip_id:9,execution_id:persisted.execution_id,manifest:{source_ref:persisted.payload.source_ref}}]};
        if(sql.includes('FROM employees')) return {rows:[{employee_id:4}]};
        if(sql.includes("SET status='PENDING'")){draft={...draft,status:'PENDING',attempts:0,last_error_code:null};return {rows:[{event_id:eventId,status:'PENDING',attempts:0}],rowCount:1};}
        if(sql.includes('WITH due')){if(draft.status!=='PENDING')return {rows:[]};draft={...draft,attempts:draft.attempts+1,lease_token:params[2]};return {rows:[draft]};}
        if(sql.includes('FROM cargo_feedback_outbox')&&sql.includes('FOR UPDATE')) return {rows:[{...draft,payload:persisted.payload,payload_hash:persisted.payload_hash}]};
        if(sql.includes("SET status='ACKNOWLEDGED'")){draft={...draft,status:'ACKNOWLEDGED',lease_token:null};return {rows:[],rowCount:1};}
        return {rows:[]};
      }};
      const result=await work(tx);current=draft;return result;
    }};
    const session={user:{employeeId:4,role:'admin'}};
    const authorizeStaff=vi.fn(async ({session:actor,action,trip,execution})=>actor.user.employeeId===4&&action==='execute'&&trip.trip_id===9&&execution.manifest.source_ref.organization_id==='hotel-a');
    const fixture=createCargoFeedbackStaffFixture({db,config:{simulated:true,approvalRef:'fixture'},authorizeStaff,environment:'test'});
    await fixture.retryCargoFeedback({req:new Request('http://localhost'),session,tripId:9,sourceSystem:'PMS',organizationId:'hotel-a',eventId});
    const gateway={send:vi.fn(async e=>({event_id:e.event_id,received:true}))};
    const delivery=await createCargoFeedbackWorker({db,gateway,environment:'test'}).deliverCargoFeedback();
    expect(gateway.send).toHaveBeenCalled();
    expect(delivery).toEqual({acknowledged:1,pending:0,failed:0});
    expect(gateway.send).toHaveBeenCalledWith(expect.objectContaining({event_id:eventId,attempt:1}));
    expect(current).toMatchObject({status:'ACKNOWLEDGED',attempts:1,payload:persisted.payload,payload_hash:persisted.payload_hash});
    expect(auditMock.writeAuditRequired).toHaveBeenCalledWith(expect.anything(),expect.anything(),session,expect.objectContaining({action:'cargo_feedback_retry',oldValues:{status:'FAILED',attempts:10,error_code:'GATEWAY_TIMEOUT'}}));
  });

  it('denies a caller-selected source scope that disagrees with persisted trip data', async () => {
    const req=new Request('http://localhost');const session={user:{employeeId:4,role:'admin'}};
    const tx={query:vi.fn(async sql=>sql.includes('FROM trips t JOIN cargo_trip_executions')?{rows:[{trip_id:9,execution_id:'execution',manifest:{source_ref:{system:'PMS',organization_id:'hotel-a'}}}]}:{rows:[{employee_id:4}]})};
    const db={withTransaction:work=>work(tx)};
    const authorizeStaff=vi.fn(async()=>true);
    const fixture=createCargoFeedbackStaffFixture({db,config:{simulated:true,approvalRef:'fixture'},authorizeStaff,environment:'test'});
    await expect(fixture.listCargoFeedback({req,session,tripId:9,sourceSystem:'PMS',organizationId:'hotel-b'})).rejects.toMatchObject({status:403,code:'CARGO_SOURCE_FORBIDDEN'});
    expect(authorizeStaff).not.toHaveBeenCalled();
  });

  it('rolls back a staff retry when required audit persistence fails', async () => {
    const eventId='11111111-1111-4111-8111-111111111111';let status='FAILED',attempts=10;let committed=false;
    const db={withTransaction:async work=>{let nextStatus=status,nextAttempts=attempts;const tx={query:async sql=>{
      if(sql.includes('FROM trips t JOIN cargo_trip_executions'))return {rows:[{trip_id:9,execution_id:'execution',manifest:{source_ref:{system:'PMS',organization_id:'hotel-a'}}}]};
      if(sql.includes('FROM employees'))return {rows:[{employee_id:4}]};
      if(sql.includes('FROM cargo_feedback_outbox')&&sql.includes('FOR UPDATE'))return {rows:[{event_id:eventId,status,attempts,source_system:'PMS',source_organization_id:'hotel-a'}]};
      if(sql.includes("SET status='PENDING'")){nextStatus='PENDING';nextAttempts=0;return {rows:[{event_id:eventId}],rowCount:1};}
      return {rows:[]};
    }};const result=await work(tx);status=nextStatus;attempts=nextAttempts;committed=true;return result;}};
    auditMock.writeAuditRequired.mockRejectedValueOnce(new Error('audit unavailable'));
    const fixture=createCargoFeedbackStaffFixture({db,config:{simulated:true,approvalRef:'fixture'},authorizeStaff:async()=>true,environment:'test'});
    await expect(fixture.retryCargoFeedback({req:new Request('http://localhost'),session:{user:{employeeId:4,role:'admin'}},tripId:9,sourceSystem:'PMS',organizationId:'hotel-a',eventId})).rejects.toThrow('audit unavailable');
    expect(committed).toBe(false);expect(status).toBe('FAILED');expect(attempts).toBe(10);
  });
});
