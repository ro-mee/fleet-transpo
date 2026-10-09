import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { loadEnvLocal } from '../../scripts/load-env.mjs';
import { loadExecutionForUpdate, insertReceipt, appendCargoDecision, appendCargoFeedback } from './cargo-execution.repository';
import { createCargoEvidenceStore } from '@/lib/cargo/evidence-storage';

const enabled = process.env.CARGO_FIXTURE_DB_TEST === '1';
const schema = `cargo_storage_fixture_${randomUUID().replaceAll('-', '')}`;
const storageSchema = `${schema}_objects`;
const manifestId = randomUUID(), foreignManifestId = randomUUID();
const actor = { user: { role: 'driver', driverId: 1, employeeId: 1 } };
const config = { dataApprovalRef: 'simulated:data', privacyApprovalRef: 'simulated:privacy', receivingApprovalRef: 'simulated:receiving', retentionApprovalRef: 'simulated:retention', sourceApprovalRef: 'simulated:source', schemaReady: true, simulated: true, environment: 'test' };
const manifest = { manifest_ref: { kind: 'REQUEST', id: manifestId, revision: 1, hash: 'a'.repeat(64) }, source_ref: { system: 'PMS', organization_id: 'simulated:hotel', external_request_id: 'r1' }, service_code: 'HOTEL_SUPPLY_TRANSFER', lines: [{ line_id: 'oil', name: 'Oil', quantity_basis: 'TRANSPORT_PACKAGE', expected_quantity: '10', unit: 'box', reference_image_ref: null, handling: [] }] };
const receipt = () => ({ submission_id: randomUUID(), manifest_ref: manifest.manifest_ref, stage: 'PICKUP', observed_at: '2026-10-09T08:00:00Z', lines: [{ line_id: 'oil', observed_quantity: '9', condition: 'INTACT', issue_code: 'SHORTAGE', remarks: 'Simulated shortage', evidence_ids: [] }], receiver_confirmation_ref: null });
let pool, migration, execution, saved;
const database = () => ({ cargoConfig: config, withTransaction: async work => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL search_path TO ${schema}, pg_catalog`);
    await client.query("SET LOCAL statement_timeout='10s'");
    const tx = { query: (...args) => client.query(...args), cargoConfig: config, cargoTripId: 1, cargoActor: actor };
    const result = await work(tx); await client.query('COMMIT'); return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
} });
const run = work => database().withTransaction(work);
const rejectedSQL = async (sql, params = []) => {
  try { await run(tx => tx.query(sql, params)); } catch (error) { expect(['23514', '23503', '23505', '55000']).toContain(error.code); return; }
  throw new Error('Expected a constraint or immutable-history refusal.');
};

describe.skipIf(!enabled)('cargo storage candidate, isolated real PostgreSQL namespace and two sessions', () => {
  beforeAll(async () => {
    loadEnvLocal();
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3, connectionTimeoutMillis: 5000 });
    // Committed disposable namespaces are visible to both race sessions. Never public operational rows.
    await pool.query(`CREATE SCHEMA ${schema}; CREATE SCHEMA ${storageSchema}`);
    await run(async tx => {
      await tx.query(`CREATE TABLE employees(employee_id integer PRIMARY KEY);
        CREATE TABLE drivers(driver_id integer PRIMARY KEY, employee_id integer);
        CREATE TABLE transportation_requests(request_id integer PRIMARY KEY);
        CREATE TABLE dispatchschedules(dispatch_id integer PRIMARY KEY, request_id integer, service_type text);
        CREATE TABLE trips(trip_id integer PRIMARY KEY, dispatch_id integer, driver_id integer, deleted_at timestamptz);
        CREATE TABLE request_cargo_manifest_revisions(request_cargo_manifest_revision_id uuid PRIMARY KEY, request_id integer, revision integer, manifest_hash text, manifest_snapshot jsonb);
        CREATE TABLE supply_dispatch_allocations(supply_dispatch_allocation_id uuid PRIMARY KEY, dispatch_id integer, supply_shipment_id uuid, manifest_revision integer, allocation_status text);
        CREATE TABLE supply_manifest_revisions(supply_manifest_revision_id uuid PRIMARY KEY, supply_shipment_id uuid, manifest_revision integer, manifest_hash text);
        CREATE TABLE ${storageSchema}.buckets(id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
        CREATE TABLE ${storageSchema}.objects(bucket_id text);
        ALTER TABLE ${storageSchema}.objects ENABLE ROW LEVEL SECURITY;
        INSERT INTO employees VALUES(1),(2); INSERT INTO drivers VALUES(1,1),(2,2);
        INSERT INTO transportation_requests VALUES(1),(2);
        INSERT INTO dispatchschedules VALUES(1,1,'PASSENGER'),(2,2,'PASSENGER');
        INSERT INTO trips VALUES(1,1,1,NULL),(2,2,2,NULL);`);
      await tx.query('INSERT INTO request_cargo_manifest_revisions VALUES($1,1,1,$3,$4),($2,2,1,$3,$4)', [manifestId, foreignManifestId, manifest.manifest_ref.hash, JSON.stringify({ ...manifest, manifest_ref: undefined })]);
      migration = readFileSync('supabase/migrations/159_cargo_execution_storage.sql', 'utf8').replaceAll('public.', `${schema}.`).replaceAll('storage.', `${storageSchema}.`);
      await tx.query(migration);
    });
  }, 25000);
  afterAll(async () => { try { if (pool) await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP SCHEMA IF EXISTS ${storageSchema} CASCADE`); } finally { await pool?.end(); } });
  it('reruns safely and revokes all exposed-role table/function access, with a private bucket', async () => {
    await run(tx => tx.query(migration));
    const rows = (await pool.query(`SELECT c.relname,c.relrowsecurity,has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') anon,has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') authenticated FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname LIKE 'cargo_%' AND c.relkind='r'`, [schema])).rows;
    expect(rows).toHaveLength(7);
    for (const row of rows) expect(row).toMatchObject({ relrowsecurity: true, anon: false, authenticated: false });
    expect((await pool.query(`SELECT public FROM ${storageSchema}.buckets WHERE id='cargo-evidence'`)).rows).toEqual([{ public: false }]);
    const policy = (await pool.query('SELECT permissive,roles,qual,with_check FROM pg_policies WHERE schemaname=$1', [storageSchema])).rows[0];
    expect(policy).toMatchObject({ permissive: 'RESTRICTIVE' });
    expect(policy.qual).toContain('cargo-evidence'); expect(policy.with_check).toContain('cargo-evidence');
    const functions = (await pool.query(`SELECT has_function_privilege('anon',p.oid,'EXECUTE') anon FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1`, [schema])).rows;
    expect(functions.length).toBeGreaterThan(0); expect(functions.every(row => !row.anon)).toBe(true);
  });
  it('binds only the trip actual manifest; enforces exclusive and unique execution', async () => {
    execution = await run(tx => loadExecutionForUpdate(1, tx));
    expect(execution.manifest).toEqual(manifest);
    await rejectedSQL('INSERT INTO cargo_trip_executions(trip_id,request_manifest_id,manifest) VALUES(2,$1,$2)', [manifestId, JSON.stringify(manifest)]);
    await rejectedSQL('INSERT INTO cargo_trip_executions(trip_id,request_manifest_id,manifest) VALUES(1,$1,$2)', [manifestId, JSON.stringify(manifest)]);
    await rejectedSQL('INSERT INTO cargo_trip_executions(trip_id,manifest) VALUES(2,$1)', [JSON.stringify(manifest)]);
    await expect(run(tx => loadExecutionForUpdate(2, tx))).rejects.toMatchObject({ status: 404 });
  });
  it('serializes two sessions, preserves exact replay, rejects changed replay and keeps expected count', async () => {
    const input = receipt();
    const sessions = [];
    const submit = () => run(async tx => { sessions.push((await tx.query('SELECT pg_backend_pid() pid')).rows[0].pid); return insertReceipt(input, actor, tx); });
    const outcomes = await Promise.all([submit(), submit()]);
    expect(new Set(sessions).size).toBe(2);
    expect(outcomes[0]).toEqual(outcomes[1]); saved = outcomes[0];
    expect(saved.payload.lines[0].observed_quantity).toBe('9');
    expect((await run(tx => loadExecutionForUpdate(1, tx))).manifest.lines[0].expected_quantity).toBe('10');
    await expect(run(tx => insertReceipt({ ...input, observed_at: '2026-10-09T08:01:00Z' }, actor, tx))).rejects.toMatchObject({ status: 409 });
    expect((await run(tx => tx.query('SELECT count(*)::int n FROM cargo_receipts'))).rows[0].n).toBe(1);
    expect((await run(tx => tx.query('SELECT count(*)::int n FROM cargo_feedback_outbox'))).rows[0].n).toBe(2);
  });
  it('rejects receipt history changes and missing references', async () => {
    await rejectedSQL("UPDATE cargo_receipts SET stage='DELIVERY'");
    await rejectedSQL('DELETE FROM cargo_receipts');
    await rejectedSQL('UPDATE cargo_trip_executions SET request_manifest_id=$1', [foreignManifestId]);
    await expect(run(tx => insertReceipt({ ...receipt(), manifest_ref: { ...manifest.manifest_ref, id: foreignManifestId } }, actor, tx))).rejects.toMatchObject({ status: 409 });
    await expect(run(tx => insertReceipt({ ...receipt(), lines: [{ ...receipt().lines[0], evidence_ids: [randomUUID()] }] }, actor, tx))).rejects.toMatchObject({ status: 404 });
  });
  it('does not let parent linkage changes move an existing execution to a foreign source', async () => {
    await rejectedSQL('UPDATE trips SET dispatch_id=2 WHERE trip_id=1');
    await rejectedSQL('UPDATE dispatchschedules SET request_id=2 WHERE dispatch_id=1');
  });
  it('binds SUPPLY execution to the actual allocation, manifest and dispatch', async () => {
    const allocation = randomUUID(), revision = randomUUID(), shipment = randomUUID();
    const supplyManifest = { ...manifest, manifest_ref: { kind: 'SUPPLY', id: revision, revision: 1, hash: 'b'.repeat(64) }, source_ref: { system: 'SCM', organization_id: 'simulated:scm', external_request_id: 's1' } };
    await run(async tx => {
      await tx.query("INSERT INTO dispatchschedules VALUES(3,NULL,'SUPPLY_DELIVERY'); INSERT INTO trips VALUES(3,3,1,NULL)");
      await tx.query('INSERT INTO supply_manifest_revisions VALUES($1,$2,1,$3)', [revision, shipment, 'b'.repeat(64)]);
      await tx.query("INSERT INTO supply_dispatch_allocations VALUES($1,3,$2,1,'ASSIGNED')", [allocation, shipment]);
    });
    await rejectedSQL('INSERT INTO cargo_trip_executions(trip_id,supply_allocation_id,manifest) VALUES(2,$1,$2)', [allocation, JSON.stringify(supplyManifest)]);
    await rejectedSQL('INSERT INTO cargo_trip_executions(trip_id,request_manifest_id,supply_allocation_id,manifest) VALUES(3,$1,$2,$3)', [manifestId, allocation, JSON.stringify(supplyManifest)]);
    await rejectedSQL('INSERT INTO cargo_trip_executions(trip_id,supply_allocation_id,manifest) VALUES(3,$1,$2)', [allocation, JSON.stringify(manifest)]);
    await run(tx => tx.query('INSERT INTO cargo_trip_executions(trip_id,supply_allocation_id,manifest) VALUES(3,$1,$2)', [allocation, JSON.stringify(supplyManifest)]));
    await rejectedSQL('UPDATE supply_dispatch_allocations SET manifest_revision=2 WHERE supply_dispatch_allocation_id=$1', [allocation]);
  });
  it('source decisions are scoped, immutable and atomically replayed through the inbox', async () => {
    const principal = { system: 'PMS', organization_id: 'simulated:hotel', subject: 'simulated:owner', capabilities: ['cargo:decision:write'] };
    const input = { event_id: randomUUID(), receipt_id: saved.receipt_id, manifest_hash: manifest.manifest_ref.hash, action: 'WAIT', reason: 'Simulated review' };
    await expect(run(tx => appendCargoDecision(input, { ...principal, organization_id: 'foreign' }, tx))).rejects.toMatchObject({ status: 403 });
    const result = await run(tx => appendCargoDecision(input, principal, tx));
    expect(await run(tx => appendCargoDecision(input, principal, tx))).toEqual(result);
    await expect(run(tx => appendCargoDecision({ ...input, action: 'ACCEPT_OBSERVED' }, principal, tx))).rejects.toMatchObject({ status: 409 });
    await rejectedSQL("UPDATE cargo_decisions SET action='ACCEPT_OBSERVED'");
    await rejectedSQL('DELETE FROM cargo_decision_inbox');
    await rejectedSQL(`INSERT INTO cargo_fleet_clearances(execution_id,receipt_id,decision_id,authorized_employee_id,version,manifest_hash,reason)
      VALUES($1,$2,$3,1,1,$4,'simulated stale clearance')`, [execution.execution_id, saved.receipt_id, result.decision_id, manifest.manifest_ref.hash]);
    const current = await run(tx => loadExecutionForUpdate(1, tx));
    await run(tx => tx.query(`INSERT INTO cargo_fleet_clearances(execution_id,receipt_id,decision_id,authorized_employee_id,version,manifest_hash,reason)
      VALUES($1,$2,$3,1,$4,$5,'simulated binding only; no safety proof')`, [execution.execution_id, saved.receipt_id, result.decision_id, current.version, manifest.manifest_ref.hash]));
    expect((await run(tx => tx.query('SELECT safety_evidence_ref FROM cargo_fleet_clearances'))).rows[0].safety_evidence_ref).toBe(null);
    await rejectedSQL("UPDATE cargo_feedback_outbox SET payload='{}'");
    await run(tx => tx.query("UPDATE cargo_feedback_outbox SET attempts=1,status='ACKNOWLEDGED',acknowledged_at=now(),acknowledgement='{}'"));
    expect((await run(tx => tx.query('SELECT action FROM cargo_decisions'))).rows).toEqual([{ action: 'WAIT' }]);
  });
  it('rolls back a receipt and its durable feedback together', async () => {
    const input = receipt();
    await expect(run(async tx => { await insertReceipt(input, actor, tx); throw new Error('simulated transaction failure'); })).rejects.toThrow('simulated transaction failure');
    expect((await run(tx => tx.query('SELECT * FROM cargo_receipts WHERE submission_id=$1', [input.submission_id]))).rows).toHaveLength(0);
    await expect(run(tx => appendCargoFeedback({ execution, eventType: 'ACKNOWLEDGED' }, tx))).rejects.toMatchObject({ status: 400 });
  });
  it('tracks upload failure, reuses server keys and signs only owned ready evidence', async () => {
    const uploads = []; let fail = true, signs = 0;
    const storage = { upload: async (key) => { uploads.push(key); if (fail) throw new Error('simulated upload failure'); }, sign: async key => { signs++; return `simulated:${key}`; } };
    const store = createCargoEvidenceStore({ db: database(), storage, config });
    const submissionId = randomUUID(), file = { type: 'image/jpeg', size: 1, arrayBuffer: async () => new Uint8Array([255,216,255]).buffer };
    await expect(store.storeCargoEvidence({ file, tripId: 2, submissionId }, actor)).rejects.toMatchObject({ status: 404 });
    expect(uploads).toHaveLength(0);
    await expect(store.storeCargoEvidence({ file, tripId: 1, submissionId }, actor)).rejects.toMatchObject({ status: 503 });
    expect((await run(tx => tx.query('SELECT state FROM cargo_evidence'))).rows).toEqual([{ state: 'ORPHANED' }]);
    fail = false;
    const result = await store.storeCargoEvidence({ file, tripId: 1, submissionId }, actor);
    expect(await store.storeCargoEvidence({ file, tripId: 1, submissionId }, actor)).toEqual(result);
    expect(new Set(uploads).size).toBe(1);
    await expect(store.signCargoEvidence(result.evidence_id, { user: { role: 'driver', driverId: 2, employeeId: 2 } })).rejects.toMatchObject({ status: 404 });
    expect(signs).toBe(0);
    expect(await store.signCargoEvidence(result.evidence_id, actor)).toContain('simulated:');
    await run(tx => insertReceipt({ ...receipt(), submission_id: submissionId, lines: [{ ...receipt().lines[0], evidence_ids: [result.evidence_id] }] }, actor, tx));
    expect((await run(tx => tx.query('SELECT state FROM cargo_evidence'))).rows).toEqual([{ state: 'ATTACHED' }]);
  });
  it('does not rebind an old receipt clearance to the newest execution version after recount', async () => {
    const current = await run(tx => loadExecutionForUpdate(1, tx));
    const decision = (await run(tx => tx.query('SELECT decision_id FROM cargo_decisions WHERE receipt_id=$1', [saved.receipt_id]))).rows[0];
    await rejectedSQL(`INSERT INTO cargo_fleet_clearances(execution_id,receipt_id,decision_id,authorized_employee_id,version,manifest_hash,reason)
      VALUES($1,$2,$3,1,$4,$5,'simulated stale receipt at new version')`, [execution.execution_id, saved.receipt_id, decision.decision_id, current.version, manifest.manifest_ref.hash]);
  });
  it('serializes distinct simultaneous submissions with distinct versions and durable events', async () => {
    const results = await Promise.all([run(tx => insertReceipt(receipt(), actor, tx)), run(tx => insertReceipt(receipt(), actor, tx))]);
    expect(results[0].receipt_id).not.toBe(results[1].receipt_id);
    expect(results[0].execution_version).not.toBe(results[1].execution_version);
    const current = await run(tx => loadExecutionForUpdate(1, tx));
    const latest = results.find(row => row.execution_version === current.version);
    expect(latest).toBeDefined();
    const event = await run(tx => appendCargoFeedback({ execution: current, eventType: 'PICKUP_RECORDED', receipt: latest }, tx));
    expect(await run(tx => appendCargoFeedback({ execution: current, eventType: 'PICKUP_RECORDED', receipt: latest }, tx))).toBe(event);
    await expect(run(tx => appendCargoFeedback({ execution: current, eventType: 'PICKUP_RECORDED', receipt: { ...latest, payload: { ...latest.payload, observed_at: '2026-10-09T10:00:00Z' } } }, tx))).rejects.toMatchObject({ status: 409 });
  });
});
