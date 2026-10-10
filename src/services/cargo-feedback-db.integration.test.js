import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { loadEnvLocal } from '../../scripts/load-env.mjs';
import { createCargoFeedbackWorker } from './cargo-feedback.service';
import { cargoPayloadHash } from './cargo-execution.repository';

const enabled = process.env.CARGO_FIXTURE_DB_TEST === '1';
const schema = `cargo_feedback_fixture_${randomUUID().replaceAll('-', '')}`;
const storageSchema = `${schema}_objects`;
const executionId = randomUUID(), manifestId = randomUUID(), executionId2=randomUUID(),manifestId2=randomUUID();
const source = { system: 'PMS', organization_id: 'fixture-hotel', external_request_id: 'feedback-1' };
const manifestRef = { kind: 'REQUEST', id: manifestId, revision: 1, hash: 'a'.repeat(64) };
const workerPids=[];
let pool;
const db = (recordWorkerSession=false, holdLease=null) => ({ withTransaction: async work => {
  const client = await pool.connect();
  try { await client.query('BEGIN'); await client.query(`SET LOCAL search_path TO ${schema}, pg_catalog`); await client.query("SET LOCAL statement_timeout='10s'"); let isLease=false; const result=await work({query:async(...args)=>{const response=await client.query(...args);if(String(args[0]).includes('WITH due')){isLease=true;if(recordWorkerSession)workerPids.push((await client.query('SELECT pg_backend_pid() pid')).rows[0].pid);}return response;}}); if(holdLease&&isLease)await holdLease(); await client.query('COMMIT'); return result; }
  catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
} });

function envelope(id, version) {
  return { execution_id: executionId, execution_version: version, source_ref: source, event_type: 'TRANSPORT_CLOSED', manifest_ref: manifestRef, receipt: null, decision: null };
}
async function insertEvent(id, version) {
  const payload=envelope(id,version);
  await db().withTransaction(tx=>tx.query(`INSERT INTO cargo_feedback_outbox(event_id,execution_id,execution_version,source_system,source_organization_id,event_type,payload,payload_hash)
    VALUES($1,$2,$3,'PMS',$4,'TRANSPORT_CLOSED',$5::jsonb,$6)`,[id,executionId,version,source.organization_id,JSON.stringify(payload),cargoPayloadHash(payload)]));
}

describe.skipIf(!enabled)('cargo feedback worker PostgreSQL isolation and competing sessions',()=>{
  beforeAll(async()=>{
    loadEnvLocal();
    pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},max:4,connectionTimeoutMillis:5000});
    await pool.query(`CREATE SCHEMA ${schema}; CREATE SCHEMA ${storageSchema}`);
    await db().withTransaction(async tx=>{
      await tx.query(`CREATE TABLE employees(employee_id integer PRIMARY KEY);
        CREATE TABLE drivers(driver_id integer PRIMARY KEY,employee_id integer);
        CREATE TABLE transportation_requests(request_id integer PRIMARY KEY);
        CREATE TABLE dispatchschedules(dispatch_id integer PRIMARY KEY,request_id integer,service_type text);
        CREATE TABLE trips(trip_id integer PRIMARY KEY,dispatch_id integer,driver_id integer,deleted_at timestamptz);
        CREATE TABLE request_cargo_manifest_revisions(request_cargo_manifest_revision_id uuid PRIMARY KEY,request_id integer,revision integer,manifest_hash text,manifest_snapshot jsonb);
        CREATE TABLE supply_dispatch_allocations(supply_dispatch_allocation_id uuid PRIMARY KEY,dispatch_id integer,supply_shipment_id uuid,manifest_revision integer,allocation_status text);
        CREATE TABLE supply_manifest_revisions(supply_manifest_revision_id uuid PRIMARY KEY,supply_shipment_id uuid,manifest_revision integer,manifest_hash text);
        CREATE TABLE ${storageSchema}.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
        CREATE TABLE ${storageSchema}.objects(bucket_id text);
        INSERT INTO employees VALUES(1),(2); INSERT INTO drivers VALUES(1,1),(2,2); INSERT INTO transportation_requests VALUES(1),(2);
        INSERT INTO dispatchschedules VALUES(1,1,'PASSENGER'),(2,2,'PASSENGER'); INSERT INTO trips VALUES(1,1,1,NULL),(2,2,2,NULL);`);
      const manifest={ manifest_ref:manifestRef,source_ref:source,service_code:'HOTEL_SUPPLY_TRANSFER',lines:[{line_id:'oil',name:'Oil',quantity_basis:'TRANSPORT_PACKAGE',expected_quantity:'1',unit:'box',reference_image_ref:null,handling:[]}] };
      const {manifest_ref,...snapshot}=manifest;
      const source2={...source,organization_id:'fixture-hotel-b',external_request_id:'feedback-2'};
      const manifest2={...manifest,manifest_ref:{...manifestRef,id:manifestId2},source_ref:source2};
      const {manifest_ref:ignored,...snapshot2}=manifest2;
      await tx.query('INSERT INTO request_cargo_manifest_revisions VALUES($1,1,1,$2,$3),($4,2,1,$2,$5)',[manifestId,manifestRef.hash,JSON.stringify(snapshot),manifestId2,JSON.stringify(snapshot2)]);
      const sql=readFileSync('supabase/migrations/159_cargo_execution_storage.sql','utf8').replaceAll('public.',`${schema}.`).replaceAll('storage.',`${storageSchema}.`);
      await tx.query(sql);
      await tx.query('INSERT INTO cargo_trip_executions(execution_id,trip_id,request_manifest_id,manifest) VALUES($1,1,$2,$3::jsonb),($4,2,$5,$6::jsonb)',[executionId,manifestId,JSON.stringify(manifest),executionId2,manifestId2,JSON.stringify(manifest2)]);
    });
  },30000);
  afterAll(async()=>{try{if(pool)await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP SCHEMA IF EXISTS ${storageSchema} CASCADE`);}finally{await pool?.end();}});

  it('commits the lease before network I/O, serializes one execution across workers and preserves event order',async()=>{
    const first=randomUUID(), second=randomUUID(); await insertEvent(first,1); await insertEvent(second,2);
    let networkEntered=false, release, leaseLocked, releaseLease;
    const wait=new Promise(resolve=>{release=resolve;});
    const leaseWait=new Promise(resolve=>{releaseLease=resolve;});
    const locked=new Promise(resolve=>{leaseLocked=resolve;});
    const gateway={send:async event=>{
      networkEntered=true;
      const leased=(await pool.query(`SELECT lease_token,attempts FROM ${schema}.cargo_feedback_outbox WHERE event_id=$1`,[event.event_id])).rows[0];
      expect(leased.lease_token).toBeTruthy(); expect(leased.attempts).toBe(1);
      if(event.event_id===first) await wait;
      return {event_id:event.event_id,received:true};
    }};
    const workerA=createCargoFeedbackWorker({db:db(true,async()=>{leaseLocked();await leaseWait;}),gateway,environment:'test'}), workerB=createCargoFeedbackWorker({db:db(true),gateway,environment:'test'});
    const running=workerA.deliverCargoFeedback({batchSize:5});
    await locked;
    expect(await workerB.deliverCargoFeedback({batchSize:5})).toEqual({acknowledged:0,pending:0,failed:0});
    releaseLease();
    while(!networkEntered) await new Promise(resolve=>setTimeout(resolve,5));
    expect(new Set(workerPids).size, `worker PostgreSQL sessions: ${workerPids.join(',')}`).toBeGreaterThanOrEqual(2);
    release(); expect(await running).toEqual({acknowledged:1,pending:0,failed:0});
    expect(await workerB.deliverCargoFeedback({batchSize:5})).toEqual({acknowledged:1,pending:0,failed:0});
    const rows=(await pool.query(`SELECT event_id,status,attempts,payload_hash FROM ${schema}.cargo_feedback_outbox WHERE execution_id=$1 ORDER BY execution_version`,[executionId])).rows;
    expect(rows).toEqual([{event_id:first,status:'ACKNOWLEDGED',attempts:1,payload_hash:cargoPayloadHash(envelope(first,1))},{event_id:second,status:'ACKNOWLEDGED',attempts:1,payload_hash:cargoPayloadHash(envelope(second,2))}]);
    await expect(pool.query(`UPDATE ${schema}.cargo_feedback_outbox SET payload='{}' WHERE event_id=$1`,[first])).rejects.toMatchObject({code:'55000'});
  });

  it('prevents a timed-out worker from overwriting the successor lease result',async()=>{
    const id=randomUUID();await insertEvent(id,3);
    let entered,release;
    const atGateway=new Promise(resolve=>{entered=resolve;});const wait=new Promise(resolve=>{release=resolve;});
    const stale=createCargoFeedbackWorker({db:db(),gateway:{send:async event=>{entered();await wait;return {event_id:event.event_id,received:true};}},environment:'test'});
    const staleRun=stale.deliverCargoFeedback({batchSize:1});await atGateway;
    await pool.query(`UPDATE ${schema}.cargo_feedback_outbox SET lease_expires_at=now()-interval '1 second' WHERE event_id=$1`,[id]);
    const successor=createCargoFeedbackWorker({db:db(),gateway:{send:async event=>({event_id:event.event_id,received:true})},environment:'test'});
    expect(await successor.deliverCargoFeedback({batchSize:1})).toEqual({acknowledged:1,pending:0,failed:0});
    release();expect(await staleRun).toEqual({acknowledged:0,pending:1,failed:0});
    expect((await pool.query(`SELECT status,attempts,lease_token FROM ${schema}.cargo_feedback_outbox WHERE event_id=$1`,[id])).rows[0]).toMatchObject({status:'ACKNOWLEDGED',attempts:2,lease_token:null});
  });

  it('scopes inbox event identity by source organization and rejects an in-scope collision',async()=>{
    const sharedEvent=randomUUID();
    await db().withTransaction(async tx=>{
      for(const [execution,manifest,employee,driver,organization] of [[executionId,manifestId,1,1,source.organization_id],[executionId2,manifestId2,2,2,'fixture-hotel-b']]){
        const receiptId=randomUUID(),submissionId=randomUUID(),decisionId=randomUUID();
        const ref={...manifestRef,id:manifest};const receiptPayload={submission_id:submissionId,manifest_ref:ref,stage:'PICKUP',observed_at:'2026-10-10T08:00:00Z',lines:[{line_id:'oil',observed_quantity:'1',condition:'INTACT',issue_code:null,remarks:'',evidence_ids:[]}],receiver_confirmation_ref:null};
        const receiptHash=cargoPayloadHash(receiptPayload);
        await tx.query(`INSERT INTO cargo_receipts(receipt_id,execution_id,execution_version,stage,manifest_ref,manifest_hash,submission_id,payload_hash,payload,lines,reporter_employee_id,reporter_driver_id,observed_at)
          VALUES($1,$2,2,'PICKUP',$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11)`,[receiptId,execution,JSON.stringify(ref),ref.hash,submissionId,receiptHash,JSON.stringify(receiptPayload),JSON.stringify(receiptPayload.lines),employee,driver,receiptPayload.observed_at]);
        const decisionPayload={event_id:sharedEvent,receipt_id:receiptId,manifest_hash:ref.hash,action:'ACCEPT_OBSERVED',reason:'Fixture decision'};
        await tx.query(`INSERT INTO cargo_decisions(decision_id,receipt_id,execution_version,action,manifest_hash,source_system,source_organization_id,principal_ref,reason,event_id,payload_hash,payload)
          VALUES($1,$2,2,'ACCEPT_OBSERVED',$3,'PMS',$4,'fixture-owner','Fixture decision',$5,$6,$7::jsonb)`,[decisionId,receiptId,ref.hash,organization,sharedEvent,cargoPayloadHash(decisionPayload),JSON.stringify(decisionPayload)]);
        await tx.query(`INSERT INTO cargo_decision_inbox(source_system,source_organization_id,event_id,payload_hash,response,receipt_id,actor_ref,decision_id)
          VALUES('PMS',$1,$2,$3,$4::jsonb,$5,'fixture-owner',$6)`,[organization,sharedEvent,cargoPayloadHash(decisionPayload),JSON.stringify(decisionPayload),receiptId,decisionId]);
      }
    });
    expect((await pool.query(`SELECT source_organization_id,event_id FROM ${schema}.cargo_decision_inbox WHERE event_id=$1 ORDER BY source_organization_id`,[sharedEvent])).rows).toHaveLength(2);
    await expect(db().withTransaction(tx=>tx.query(`INSERT INTO cargo_decision_inbox(source_system,source_organization_id,event_id,payload_hash,response,receipt_id,actor_ref,decision_id)
      SELECT source_system,source_organization_id,event_id,payload_hash,response,receipt_id,actor_ref,decision_id FROM cargo_decision_inbox WHERE event_id=$1 LIMIT 1`,[sharedEvent]))).rejects.toMatchObject({code:'23505'});
  });
});
