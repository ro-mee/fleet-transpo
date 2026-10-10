import { describe, expect, it, vi } from 'vitest';
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
    const query=vi.fn(async()=>({rows:[{event_id:'11111111-1111-4111-8111-111111111111',status:'PENDING'}]}));
    const db={query,withTransaction:async work=>work({query})};
    await expect(listCargoFeedback({tripId:1,sourceSystem:'PMS',organizationId:'hotel-a'})).rejects.toMatchObject({status:503,code:'CARGO_CONFIGURATION_REQUIRED'});
    const fixture=createCargoFeedbackStaffFixture({db,config:{simulated:true,approvalRef:'fixture'},environment:'test'});
    const scope={tripId:9,sourceSystem:'PMS',organizationId:'hotel-a'};
    await fixture.listCargoFeedback({...scope,limit:25});
    expect(query.mock.calls[0][1]).toEqual([9,'PMS','hotel-a',25]);
    const result=await fixture.retryCargoFeedback({...scope,eventId:'11111111-1111-4111-8111-111111111111'});
    expect(query.mock.calls[1][1]).toEqual([9,'11111111-1111-4111-8111-111111111111','PMS','hotel-a']);
    expect(result.event_id).toBe('11111111-1111-4111-8111-111111111111');
  });
});
