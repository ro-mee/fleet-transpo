import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { loadEnvLocal } from '../../scripts/load-env.mjs';
import { createInternalCargoExecutionService } from './cargo-internal-execution.service';
import { cargoPayloadHash } from './cargo-execution.repository';
import { assertCargoCheckpoint } from './cargo-execution.service';

const schema = `cargo_internal_${randomUUID().replaceAll('-', '')}`, storage = `${schema}_storage`;
const driver = { user: { role: 'driver', driverId: 1, employeeId: 1 } }, manager = { user: { role: 'fleet_manager', employeeId: 2 } };
let pool, service, manifest, picked, releaseInput;
const db = { withTransaction: async work => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL search_path TO ${schema},pg_catalog`);
    await client.query("SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='5s'");
    const result = await work({ query: (...args) => client.query(...args) });
    await client.query('COMMIT'); return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
} };
const run = work => db.withTransaction(work);
const observation = (quantity = '10', stage = 'PICKUP') => ({ submission_id: randomUUID(), manifest_ref: manifest.manifest_ref, stage, observed_at: '2026-10-27T01:00:00Z',
  lines: [{ line_id: 'oil', observed_quantity: quantity, condition: 'INTACT', issue_code: null, remarks: '', evidence_ids: [] }], receiver_confirmation_ref: null,
  handover: { version: 1, signer_name: 'Store staff', signer_role_or_dept: 'Supply', acknowledgment: 'CARGO_HANDOVER_V1', captured_at: '2026-10-27T01:00:00.000Z', signature: { width: 600, height: 240, strokes: [[[20,30],[60,80]]] }, location: null } });
const review = (view, kind, action) => ({ submission_id: randomUUID(), receipt_id: (kind === 'RECEIVER' ? view.delivery_receipt : view.pickup_receipt).receipt_id,
  expected_version: view.version, kind, action, reason: 'Actual counts, acknowledgment and available evidence reviewed.', reviewed_evidence_ids: (kind === 'RECEIVER' ? view.delivery_receipt : view.pickup_receipt).payload.lines.flatMap(line=>line.evidence_ids),
  ...(kind === 'SECUREMENT' ? { securement_checks: { load_secured: true, vehicle_safe: true, counts_reviewed: true } } : {}) });

describe.skipIf(process.env.CARGO_FIXTURE_DB_TEST !== '1')('internal cargo actual private transactions', () => {
  beforeAll(async () => {
    loadEnvLocal(); pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3, connectionTimeoutMillis: 5000 });
    await pool.query(`CREATE SCHEMA ${schema}; CREATE SCHEMA ${storage}`);
    await run(async tx => {
      await tx.query(`CREATE TABLE roles(role_id integer PRIMARY KEY,role_name text);
        CREATE TABLE employees(employee_id integer PRIMARY KEY,role_id integer,status text DEFAULT 'Active',deleted_at timestamptz);
        CREATE TABLE drivers(driver_id integer PRIMARY KEY,employee_id integer,deleted_at timestamptz,driver_type text DEFAULT 'Cargo');
        CREATE TABLE vehicles(vehicle_id integer PRIMARY KEY,deleted_at timestamptz,operational_use text DEFAULT 'Cargo');
        CREATE TABLE service_types(service_type_id integer PRIMARY KEY,service_code text);
        CREATE TABLE transportation_requests(request_id integer PRIMARY KEY,load_type text,source_system text,external_request_id text,service_type_id integer,cargo_weight_kg numeric,deleted_at timestamptz);
        CREATE TABLE dispatchschedules(dispatch_id integer PRIMARY KEY,request_id integer,service_type text,deleted_at timestamptz);
        CREATE TABLE trips(trip_id integer PRIMARY KEY,dispatch_id integer,driver_id integer,vehicle_id integer,trip_status text,deleted_at timestamptz);
        CREATE TABLE supply_dispatch_allocations(supply_dispatch_allocation_id uuid PRIMARY KEY,dispatch_id integer,supply_shipment_id uuid,manifest_revision integer,allocation_status text);
        CREATE TABLE supply_manifest_revisions(supply_manifest_revision_id uuid PRIMARY KEY,supply_shipment_id uuid,manifest_revision integer,manifest_hash text);
        CREATE TABLE audit_logs(log_id bigserial PRIMARY KEY,employee_id integer,action text,resource text,resource_id integer,old_values jsonb,new_values jsonb,ip_address text,user_agent text,event_key uuid);
        CREATE UNIQUE INDEX audit_event_key ON audit_logs(event_key) WHERE event_key IS NOT NULL;
        CREATE TABLE ${storage}.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
        CREATE TABLE ${storage}.objects(bucket_id text); ALTER TABLE ${storage}.objects ENABLE ROW LEVEL SECURITY;
        INSERT INTO roles VALUES(1,'driver'),(2,'fleet_manager'),(3,'dispatcher'); INSERT INTO employees(employee_id,role_id) VALUES(1,1),(2,2),(3,3);
        INSERT INTO drivers(driver_id,employee_id) VALUES(1,1); INSERT INTO vehicles(vehicle_id) VALUES(1),(2);
        INSERT INTO service_types VALUES(1,'HOTEL_SUPPLY_TRANSFER');
        INSERT INTO transportation_requests VALUES(1,'Cargo','INTERNAL','internal:test',1,10,NULL),(2,'Cargo','PMS','external',1,10,NULL);`);
      for (const filename of ['158_request_cargo_manifest_revisions.sql','159_cargo_execution_storage.sql','160_cargo_execution_commands.sql','161_cargo_manual_provenance.sql','170_internal_cargo_reviews.sql']) {
        await tx.query(readFileSync(`supabase/migrations/${filename}`, 'utf8').replaceAll('public.', `${schema}.`).replaceAll('storage.', `${storage}.`));
      }
      const snapshot = { source_ref: { system: 'INTERNAL', organization_id: 'fleetops', external_request_id: 'internal:test' }, service_code: 'HOTEL_SUPPLY_TRANSFER', lines: [{ line_id: 'oil', name: 'Oil', quantity_basis: 'TRANSPORT_PACKAGE', expected_quantity: '10', unit: 'box', reference_image_ref: null, handling: [] }] };
      const id = randomUUID(), hash = cargoPayloadHash(snapshot);
      await tx.query(`INSERT INTO request_cargo_manifest_revisions(request_cargo_manifest_revision_id,request_id,revision,manifest_hash,source_system,source_organization_id,source_external_request_id,source_event_id,manifest_snapshot)
        VALUES($1,1,1,$2,'INTERNAL','fleetops','internal:test','initial',$3)`, [id,hash,JSON.stringify(snapshot)]);
      await tx.query("INSERT INTO dispatchschedules VALUES(1,1,'PASSENGER',NULL),(2,2,'PASSENGER',NULL); INSERT INTO trips VALUES(1,1,1,1,'At Pickup',NULL),(2,2,1,1,'At Pickup',NULL)");
      manifest = { ...snapshot, manifest_ref: { kind: 'REQUEST', id, revision: 1, hash } };
    });
    service = createInternalCargoExecutionService({ db });
  }, 30000);
  afterAll(async () => { try { if (pool) await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP SCHEMA IF EXISTS ${storage} CASCADE`); } finally { await pool?.end(); } });

  it('initializes a real saved internal manifest on the first assigned driver read', async () => {
    expect(await service.getCargoExecution(1, driver)).toMatchObject({ manifest, version: 1, can_depart: false });
    await expect(service.getCargoExecution(2,driver)).rejects.toMatchObject({ status: 503 });
    await expect(run(tx=>assertCargoCheckpoint({trip_id:1},{to:'Passenger Onboard',session:driver},tx))).rejects.toMatchObject({code:'CARGO_PICKUP_REQUIRED'});
  },30000);
  it('records a clean pickup but requires a current actual manager release', async () => {
    const payload = observation(), evidenceId = randomUUID(), execution = await service.getCargoExecution(1,driver);
    await run(tx=>tx.query(`INSERT INTO cargo_evidence(evidence_id,execution_id,uploader_employee_id,uploader_driver_id,submission_id,object_key,mime_type,byte_length,content_hash,state,retention_state)
      VALUES($1,$2,1,1,$3,$4,'image/jpeg',3,$5,'READY','INTERNAL_PRESERVE')`,[evidenceId,execution.execution_id,payload.submission_id,`${execution.execution_id}/${payload.submission_id}/${evidenceId}.jpg`,'c'.repeat(64)]));
    payload.lines[0].evidence_ids = [evidenceId];
    await expect(service.submitCargoReceipt(1,{...payload,submission_id:randomUUID()},driver)).rejects.toMatchObject({code:'CARGO_EVIDENCE_NOT_FOUND'});
    picked = await service.submitCargoReceipt(1, payload, driver);
    expect(picked).toMatchObject({ can_depart: false, pickup_state: 'AWAITING_DECISION' });
    expect(picked.pickup_receipt.payload.lines[0].evidence_ids).toEqual([evidenceId]);
    expect((await run(tx=>tx.query('SELECT state,receipt_id FROM cargo_evidence WHERE evidence_id=$1',[evidenceId]))).rows[0]).toEqual({state:'ATTACHED',receipt_id:picked.pickup_receipt.receipt_id});
    releaseInput = review(picked,'SOURCE','ACCEPT_OBSERVED');
    await expect(service.reviewInternalCargo(1,releaseInput,{ user: { role:'dispatcher',employeeId:3 } })).rejects.toMatchObject({ status:403 });
    await expect(service.reviewInternalCargo(1,{...releaseInput,reviewed_evidence_ids:[]},manager)).rejects.toMatchObject({code:'CARGO_EVIDENCE_REVIEW_REQUIRED'});
    const released = await service.reviewInternalCargo(1,releaseInput,manager);
    expect(released).toMatchObject({ can_depart:false, source_decision:{action:'ACCEPT_OBSERVED'} });
    expect(released.internal_reviews[0]).toMatchObject({ reviewer_employee_id:2,kind:'SOURCE' });
    expect((await run(tx=>tx.query('SELECT * FROM cargo_feedback_outbox'))).rows).toHaveLength(0);
    await expect(run(tx=>assertCargoCheckpoint({trip_id:1},{to:'Cancelled',session:manager},tx))).rejects.toMatchObject({code:'CARGO_CUSTODY_REVIEW_REQUIRED'});
  },30000);
  it('replays manager results and rejects changed or stale review commands', async () => {
    const original = await service.reviewInternalCargo(1,releaseInput,manager);
    expect(await service.reviewInternalCargo(1,releaseInput,manager)).toEqual(original);
    await expect(service.reviewInternalCargo(1,{...releaseInput,reason:'Changed'},manager)).rejects.toMatchObject({code:'CARGO_REPLAY_CONFLICT'});
    await expect(service.reviewInternalCargo(1,{...releaseInput,submission_id:randomUUID()},manager)).rejects.toMatchObject({code:'CARGO_RECEIPT_STALE'});
  });
  it('requires independent securement and later receiving approval, including explicit delivery differences', async () => {
    let current = await service.getCargoExecution(1,manager);
    current = await service.reviewInternalCargo(1,review(current,'SECUREMENT','CLEAR'),manager);
    expect(current.can_depart).toBe(true);
    expect(await run(tx=>assertCargoCheckpoint({trip_id:1},{to:'Passenger Onboard',session:driver},tx))).toMatchObject({can_depart:true});
    await run(tx=>tx.query("UPDATE trips SET trip_status='Drop-off' WHERE trip_id=1"));
    current = await service.submitCargoReceipt(1,observation('9','DELIVERY'),driver);
    expect(current.can_complete).toBe(false);
    await expect(run(tx=>assertCargoCheckpoint({trip_id:1},{to:'Completed',session:driver},tx))).rejects.toMatchObject({code:'CARGO_RECEIVER_CONFIRMATION_REQUIRED'});
    current = await service.reviewInternalCargo(1,review(current,'RECEIVER','ACCEPT_DELIVERY'),manager);
    expect(current).toMatchObject({ can_complete:true,lines:[{delivery_shortage:'1'}] });
    expect(await run(tx=>assertCargoCheckpoint({trip_id:1},{to:'Completed',session:driver},tx))).toMatchObject({can_complete:true});
    const counts = await run(tx=>tx.query("SELECT count(*)::int AS count FROM audit_logs WHERE action='cargo_internal_review' AND employee_id=2"));
    expect(counts.rows[0].count).toBe(3);
  },30000);
  it('invalidates securement after assignment changes and prohibits review history rewriting', async () => {
    await run(tx=>tx.query('UPDATE trips SET vehicle_id=2 WHERE trip_id=1'));
    expect((await service.getCargoExecution(1,driver)).can_depart).toBe(false);
    await expect(run(tx=>tx.query("UPDATE cargo_internal_reviews SET reason='rewrite'"))).rejects.toMatchObject({code:'55000'});
  });
  it('invalidates old decisions on recount and serializes concurrent identical manager commands', async () => {
    await run(tx=>tx.query("UPDATE trips SET vehicle_id=1,trip_status='At Pickup' WHERE trip_id=1"));
    const current = await service.submitCargoReceipt(1,observation('9'),driver);
    expect(current).toMatchObject({can_depart:false,pickup_state:'AWAITING_DECISION'});
    await expect(service.reviewInternalCargo(1,{...releaseInput,submission_id:randomUUID(),expected_version:current.version},manager)).rejects.toMatchObject({code:'CARGO_RECEIPT_STALE'});
    const input = review(current,'SOURCE','ACCEPT_OBSERVED');
    const results = await Promise.all([service.reviewInternalCargo(1,input,manager),service.reviewInternalCargo(1,input,manager)]);
    expect(results[0]).toEqual(results[1]);
    expect((await run(tx=>tx.query('SELECT count(*)::int AS count FROM cargo_internal_reviews WHERE submission_id=$1',[input.submission_id]))).rows[0].count).toBe(1);
  },30000);
  it('rolls back review, clearance, version and response when required audit fails', async () => {
    const before = await service.getCargoExecution(1,manager), input = review(before,'SECUREMENT','CLEAR');
    await run(tx=>tx.query(`CREATE FUNCTION reject_internal_review_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='cargo_internal_review' THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_internal_review_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_internal_review_audit()`));
    try { await expect(service.reviewInternalCargo(1,input,manager)).rejects.toThrow('fixture audit failure'); }
    finally { await run(tx=>tx.query('DROP TRIGGER reject_internal_review_audit ON audit_logs; DROP FUNCTION reject_internal_review_audit()')); }
    const after = await service.getCargoExecution(1,manager);
    expect(after.version).toBe(before.version);
    expect((await run(tx=>tx.query('SELECT review_id FROM cargo_internal_reviews WHERE submission_id=$1',[input.submission_id]))).rows).toHaveLength(0);
  },30000);
  it('reruns the migration safely and keeps internal reviews private from exposed roles', async () => {
    await run(tx=>tx.query(readFileSync('supabase/migrations/170_internal_cargo_reviews.sql','utf8').replaceAll('public.',`${schema}.`)));
    const result = await run(tx=>tx.query(`SELECT c.relrowsecurity,has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS anon_access,
      has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS authenticated_access
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname='cargo_internal_reviews'`,[schema]));
    expect(result.rows).toEqual([{relrowsecurity:true,anon_access:false,authenticated_access:false}]);
  },30000);
});
