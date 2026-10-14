import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from 'vitest';
const apiFixture=vi.hoisted(()=>({run:null,transaction:null,session:{user:{role:'driver',driverId:1,employeeId:1}}}));
vi.mock('@/lib/db', () => ({ query: (...args) => apiFixture.run(tx => tx.query(...args)), withTransaction: work => apiFixture.transaction(work) }));
// Historical policy fixtures exercise custody logic only. This explicit test
// provider never changes the retired runtime roster or its no-database refusal.
vi.mock('@/services/driver-qualification.service', () => ({ loadDriverQualifications: async (ids, db) => {
  const { rows } = await db.query('SELECT *,qualification_group AS "group" FROM driver_service_qualifications WHERE driver_id=ANY($1::int[])', [ids]);
  return new Map(ids.map(id => [id, rows.filter(row => Number(row.driver_id) === Number(id))]));
} }));
vi.mock('@/services/status.service', () => ({ syncVehicleStatus: async () => {}, syncDriverStatus: async () => {}, ensureTripForDispatch: async () => {} }));
vi.mock('@/services/outbound.service', () => ({ emitTransportStatus: async () => {} }));
vi.mock('@/services/push.service', () => ({ sendPush: async () => {} }));
vi.mock('@/services/trip-geofence.service', () => ({ checkPickupProximity: async () => ({ state: 'outside', distanceM: 1000 }), checkDestinationProximity: async () => ({ state: 'unknown' }) }));
vi.mock('@/lib/audit', async original => ({ ...await original(), writeAudit: async () => null }));
vi.mock('@/lib/api/utils',()=>({resolveIdentity:async()=>apiFixture.session,AuthError:class extends Error {constructor(message,status,code){super(message);Object.assign(this,{status,code});}},ok:data=>Response.json(data),handleError:error=>Response.json({error:error.message,code:error.code},{status:error.status??500})}));
vi.mock('@/lib/api/ownership',()=>({assertTripOwnership:async(session,tripId)=>{const trip=(await apiFixture.run(tx=>tx.query('SELECT * FROM trips WHERE trip_id=$1',[tripId]))).rows[0];if(!trip||(session.user.role==='driver'&&trip.driver_id!==session.user.driverId))throw Object.assign(new Error('Not found'),{status:404});return trip;}}));
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { loadEnvLocal } from '../../scripts/load-env.mjs';
import { createCargoExecutionService, assertCargoCheckpoint, prepareCargoLifecycle } from './cargo-execution.service';
import { createCargoApi } from '@/lib/cargo/api';
import { createCargoReadAdapter } from '@/lib/cargo/read-adapter';
import { cargoPayloadHash } from './cargo-execution.repository';
import { setTripStatus } from './transition.service';
import { completeTrip, cancelTrip } from './trip-lifecycle.service';

const schema = `cargo_service_fixture_${randomUUID().replaceAll('-', '')}`, storage = `${schema}_objects`;
const config = { dataApprovalRef: 'simulated:data', privacyApprovalRef: 'simulated:privacy', receivingApprovalRef: 'simulated:receiver', retentionApprovalRef: 'simulated:retention', sourceApprovalRef: 'simulated:source', safetyApprovalRef: 'simulated:safety', fleetApprovalRef: 'simulated:fleet', schemaReady: true, simulated: true, environment: 'test' };
const actor = { user: { role: 'driver', driverId: 1, employeeId: 1 } }, fleet = { user: { role: 'dispatcher', employeeId: 2 } };
const source = { subject: 'simulated:owner', system: 'PMS', organization_id: 'simulated:hotel', capabilities: ['cargo:decision:write'] };
const manifest = { manifest_ref: { kind: 'REQUEST', id: randomUUID(), revision: 1, hash: 'a'.repeat(64) }, source_ref: { system: source.system, organization_id: source.organization_id, external_request_id: 'r1' }, service_code: 'HOTEL_SUPPLY_TRANSFER', lines: [{ line_id: 'oil', name: 'Oil', quantity_basis: 'TRANSPORT_PACKAGE', expected_quantity: '10', unit: 'box', reference_image_ref: null, handling: [] }] };
const manifestSnapshot = { source_ref: manifest.source_ref, service_code: manifest.service_code, lines: manifest.lines };
manifest.manifest_ref.hash = cargoPayloadHash(manifestSnapshot);
const receipt = (quantity = '9', stage = 'PICKUP') => ({ submission_id: randomUUID(), manifest_ref: manifest.manifest_ref, stage, observed_at: '2026-10-09T08:00:00Z', lines: [{ line_id: 'oil', observed_quantity: quantity, condition: 'INTACT', issue_code: null, remarks: '', evidence_ids: [] }], receiver_confirmation_ref: null });
const decision = view => ({ event_id: randomUUID(), receipt_id: view.pickup_receipt.receipt_id, manifest_hash: manifest.manifest_ref.hash, action: 'ACCEPT_OBSERVED', reason: 'Simulated owner accepts the count' });
const proof = (kind, row) => ({ kind, receipt_id: row.receipt_id, manifest_hash: row.manifest_hash, approval_ref: kind === 'POST_LOAD_SECUREMENT' ? config.safetyApprovalRef : config.receivingApprovalRef, method: 'simulated-fixture', reference: randomUUID(), simulated: true });
let pool, service, migration, manualMigration;
const db = { withTransaction: async work => {
  const client = await pool.connect();
  try { await client.query('BEGIN'); await client.query(`SET LOCAL search_path TO ${schema},pg_catalog`); await client.query("SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='5s'"); const result = await work({ query: (...args) => client.query(...args) }); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
} };
const run = work => db.withTransaction(work);
apiFixture.run=run;
apiFixture.transaction=run;
const makeService = overrides => createCargoExecutionService({ db, config, authorizeFleet: async ({ session }) => session?.user?.role === 'dispatcher', resolveSafetyProof: async ({ receipt }) => proof('POST_LOAD_SECUREMENT', receipt), resolveReceiverProof: async ({ receipt }) => proof('RECEIVER_CONFIRMATION', receipt), ...overrides });
const stage = status => run(tx => tx.query('UPDATE trips SET trip_status=$1 WHERE trip_id=1', [status]));
const prepare = async () => { await stage('At Pickup'); return service.submitCargoReceipt(1, receipt(), actor); };

const communications = new Map();
const manualConfig = { ...config, manualDecisionApprovalRef: 'simulated:manual' };
const makeManualService = overrides => makeService({ config: manualConfig, authorizeManualRecord: async ({ session }) => session.user.role === 'dispatcher', resolveManualAuthority: async ({ input }) => communications.get(input.communication_evidence_ids[0]), ...overrides });
async function manualInput(picked, changes = {}) {
  const evidenceId = randomUUID(), submissionId = randomUUID();
  await run(tx => tx.query(`INSERT INTO cargo_evidence(evidence_id,execution_id,uploader_employee_id,uploader_driver_id,submission_id,object_key,mime_type,byte_length,content_hash,state)
    VALUES($1,$2,1,1,$3,$4,'image/jpeg',3,$5,'READY')`, [evidenceId,picked.execution_id,submissionId,`${picked.execution_id}/${submissionId}/${evidenceId}.jpg`,'c'.repeat(64)]));
  const input = { ...decision(picked), approver_identity: 'Simulated purchasing owner', approver_reference: 'simulated:source-owner-42', communicated_at: '2026-10-09T09:00:00Z', communication_evidence_ids: [evidenceId], ...changes };
  communications.set(evidenceId, { kind:'SOURCE_COMMUNICATION', method:'simulated-fixture', reference:`simulated:communication:${evidenceId}`, approval_ref:manualConfig.manualDecisionApprovalRef, source_ref:manifest.source_ref, receipt_id:input.receipt_id, manifest_hash:input.manifest_hash, action:input.action, reason:input.reason, approver_identity:input.approver_identity, approver_reference:input.approver_reference, communicated_at:input.communicated_at, evidence_ids:[evidenceId], simulated:true });
  return input;
}

describe.skipIf(process.env.CARGO_FIXTURE_DB_TEST !== '1')('cargo service with real isolated transactions', () => {
  beforeAll(async () => {
    loadEnvLocal(); pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3, connectionTimeoutMillis: 5000 });
    await pool.query(`CREATE SCHEMA ${schema}; CREATE SCHEMA ${storage}`);
    await run(async tx => {
      await tx.query(`CREATE TABLE employees(employee_id integer PRIMARY KEY); CREATE TABLE drivers(driver_id integer PRIMARY KEY,employee_id integer);
        CREATE TABLE dispatchschedules(dispatch_id integer PRIMARY KEY,request_id integer,service_type text);
        CREATE TABLE trips(trip_id integer PRIMARY KEY,dispatch_id integer,driver_id integer,deleted_at timestamptz,trip_status text);
        CREATE TABLE request_cargo_manifest_revisions(request_cargo_manifest_revision_id uuid PRIMARY KEY,request_id integer,revision integer,manifest_hash text,manifest_snapshot jsonb);
        CREATE TABLE supply_dispatch_allocations(supply_dispatch_allocation_id uuid PRIMARY KEY,dispatch_id integer,supply_shipment_id uuid,manifest_revision integer,allocation_status text);
        CREATE TABLE supply_manifest_revisions(supply_manifest_revision_id uuid PRIMARY KEY,supply_shipment_id uuid,manifest_revision integer,manifest_hash text);
        CREATE TABLE audit_logs(log_id bigserial PRIMARY KEY,employee_id integer,action text,resource text,resource_id integer,old_values jsonb,new_values jsonb,ip_address text,user_agent text,event_key uuid);
        CREATE UNIQUE INDEX audit_event_key ON audit_logs(event_key) WHERE event_key IS NOT NULL;
        CREATE TABLE ${storage}.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
        CREATE TABLE ${storage}.objects(bucket_id text); ALTER TABLE ${storage}.objects ENABLE ROW LEVEL SECURITY;
        INSERT INTO employees VALUES(1),(2); INSERT INTO drivers VALUES(1,1),(2,2);
        INSERT INTO dispatchschedules VALUES(1,1,'PASSENGER'),(2,1,'PASSENGER'); INSERT INTO trips VALUES(1,1,1,NULL,'At Pickup'),(2,2,2,NULL,'At Pickup');`);
      await tx.query(`ALTER TABLE trips ADD COLUMN vehicle_id integer DEFAULT 1, ADD COLUMN updated_at timestamptz, ADD COLUMN at_pickup_at timestamptz, ADD COLUMN at_pickup_override boolean DEFAULT false;
        ALTER TABLE drivers ADD COLUMN deleted_at timestamptz;
        CREATE TABLE service_types(service_type_id integer PRIMARY KEY,service_code text,deleted_at timestamptz);
        CREATE TABLE transportation_requests(request_id integer PRIMARY KEY,load_type text,source_system text,external_request_id text,service_type_id integer,deleted_at timestamptz);
        INSERT INTO service_types VALUES(1,'HOTEL_SUPPLY_TRANSFER',NULL);
        INSERT INTO transportation_requests VALUES(1,'Cargo','PMS','r1',1,NULL);`);
      await tx.query('ALTER TABLE transportation_requests ADD COLUMN cargo_weight_kg numeric(12,3)');
      await tx.query(readFileSync('supabase/migrations/156_driver_service_qualifications.sql', 'utf8'));
      await tx.query("INSERT INTO driver_service_qualifications(driver_id,qualification_group,status,policy_version,verified_by,verified_at,reason) VALUES(1,'CARGO','ACTIVE','simulated:v1',2,now(),'Fixture approval')");
      await tx.query('INSERT INTO request_cargo_manifest_revisions VALUES($1,1,1,$2,$3)', [manifest.manifest_ref.id, manifest.manifest_ref.hash, JSON.stringify(manifestSnapshot)]);
      await tx.query(readFileSync('supabase/migrations/159_cargo_execution_storage.sql', 'utf8').replaceAll('public.', `${schema}.`).replaceAll('storage.', `${storage}.`));
      migration = readFileSync('supabase/migrations/160_cargo_execution_commands.sql', 'utf8').replaceAll('public.', `${schema}.`);
      await tx.query(migration);
      manualMigration = readFileSync('supabase/migrations/161_cargo_manual_provenance.sql', 'utf8').replaceAll('public.', `${schema}.`);
      await tx.query(manualMigration);
    });
    service = makeService();
  }, 30000);
  afterAll(async () => { try { if (pool) await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP SCHEMA IF EXISTS ${storage} CASCADE`); } finally { await pool?.end(); } });
  afterEach(() => { vi.unstubAllEnvs(); apiFixture.transaction = run; });

  function enableLifecycle() {
    vi.stubEnv('CARGO_LIFECYCLE_MODE', 'ENFORCE');
    vi.stubEnv('DRIVER_QUALIFICATION_MODE', 'ENFORCE');
    vi.stubEnv('DRIVER_QUALIFICATION_POLICY_VERSION', 'simulated:v1');
    vi.stubEnv('DRIVER_QUALIFICATION_ROSTER_REVIEW', 'simulated:review');
    vi.stubEnv('DRIVER_QUALIFICATION_EXISTING_TRIPS', 'RECHECK');
    const lifecycle = makeService({ config: { ...config, lifecycleApprovalRef: 'simulated:lifecycle' }, authorizeLifecycle: async () => true });
    apiFixture.transaction = work => run(base => work(lifecycle.bindLifecycleTransaction(base)));
    return lifecycle;
  }

  it('actual shared departure and completion reject missing pickup even with geofence override', async () => {
    enableLifecycle();
    await stage('At Pickup');
    for (const to of ['Passenger Onboard', 'In Progress']) await expect(setTripStatus({ tripId: 1, to, session: actor, geofenceOverride: true, geofenceReason: 'Fixture override' })).rejects.toMatchObject({ code: 'CARGO_PICKUP_REQUIRED' });
    await stage('In Progress');
    for (const to of ['En Route', 'Arrived']) await expect(setTripStatus({ tripId: 1, to, session: actor })).rejects.toMatchObject({ code: 'CARGO_PICKUP_REQUIRED' });
    await expect(completeTrip(1, actor)).rejects.toMatchObject({ code: 'CARGO_PICKUP_REQUIRED' });
    expect((await run(tx => tx.query('SELECT trip_status FROM trips WHERE trip_id=1'))).rows[0].trip_status).toBe('In Progress');
  });

  it('guards actual lifecycle transaction: start needs no receipt, loading does, recorded pickup holds custody', async () => {
    const lifecycle = enableLifecycle();
    await run(tx => tx.query("INSERT INTO dispatchschedules VALUES(3,1,'PASSENGER'); INSERT INTO trips(trip_id,dispatch_id,driver_id,trip_status) VALUES(3,3,1,'Driver Accepted')"));
    for (const to of ['Reassign', 'Cancelled']) await expect(run(async base => {
      const tx = lifecycle.bindLifecycleTransaction(base);
      await prepareCargoLifecycle(tx);
      return assertCargoCheckpoint({ trip_id: 3 }, { to, session: fleet, patch: { vehicle_id: 2 } }, tx);
    })).resolves.toBeNull();
    const checkpoint = (tripId, to) => run(async base => {
      const tx = lifecycle.bindLifecycleTransaction(base);
      await prepareCargoLifecycle(tx);
      await assertCargoCheckpoint({ trip_id: tripId }, { to, session: actor }, tx);
      return tx.query('UPDATE trips SET trip_status=$1 WHERE trip_id=$2 RETURNING *', [to, tripId]);
    });
    expect((await checkpoint(3, 'Trip Started')).rows[0].trip_status).toBe('Trip Started');
    await expect(service.clearCargoDeparture(3, { receipt_id: randomUUID(), expected_version: 1, reason: 'No pickup exists' }, fleet)).rejects.toMatchObject({ status: 404 });
    await run(async base => {
      const tx = lifecycle.bindLifecycleTransaction(base);
      await prepareCargoLifecycle(tx);
      await assertCargoCheckpoint({ trip_id: 3 }, { to: 'Reassign', session: fleet, patch: { vehicle_id: 2 } }, tx);
      await tx.query('UPDATE trips SET vehicle_id=2 WHERE trip_id=3');
    });
    expect((await run(tx => tx.query('SELECT vehicle_id FROM trips WHERE trip_id=3'))).rows[0].vehicle_id).toBe(2);
    await expect(checkpoint(3, 'In Progress')).rejects.toMatchObject({ code: 'CARGO_PICKUP_REQUIRED' });
    expect((await run(tx => tx.query('SELECT trip_status FROM trips WHERE trip_id=3'))).rows[0].trip_status).toBe('Trip Started');
    await checkpoint(3, 'At Pickup');
    await service.submitCargoReceipt(3, receipt('10'), actor);
    await expect(checkpoint(3, 'Cancelled')).rejects.toMatchObject({ code: 'CARGO_CUSTODY_REVIEW_REQUIRED' });
    await expect(checkpoint(3, 'Reassign')).rejects.toMatchObject({ code: 'CARGO_CUSTODY_REVIEW_REQUIRED' });
    await expect(checkpoint(3, 'Completed')).rejects.toMatchObject({ code: 'CARGO_PICKUP_NOT_CLEARED' });
  });

  it('uses current assignment-bound clearance rather than immutable READY replay and requires receiver proof', async () => {
    enableLifecycle();
    await stage('At Pickup');
    const picked = await service.submitCargoReceipt(1, receipt('10'), actor);
    const input = { receipt_id: picked.pickup_receipt.receipt_id, expected_version: picked.version, reason: 'Fixture securement' };
    const original = await service.clearCargoDeparture(1, input, fleet);
    expect(original.can_depart).toBe(true);
    expect(original.fleet_clearance.assignment).toEqual({ driver_id: 1, vehicle_id: 1 });
    await expect(setTripStatus({ tripId: 1, to: 'Passenger Onboard', session: actor, extra: { vehicle_id: 2 }, geofenceOverride: true, geofenceReason: 'Fixture override' })).rejects.toMatchObject({ code: 'CARGO_CUSTODY_REVIEW_REQUIRED' });
    await run(tx => tx.query('UPDATE trips SET driver_id=2 WHERE trip_id=1'));
    const nextDriver = { user: { role: 'driver', employeeId: 2, driverId: 2 } };
    expect((await service.getCargoExecution(1, nextDriver)).can_depart).toBe(false);
    await expect(setTripStatus({ tripId: 1, to: 'Passenger Onboard', session: actor, geofenceOverride: true, geofenceReason: 'Fixture override' })).rejects.toMatchObject({ status: 404 });
    await run(tx => tx.query('UPDATE trips SET driver_id=1 WHERE trip_id=1'));
    await run(tx => tx.query('UPDATE trips SET vehicle_id=2 WHERE trip_id=1'));
    expect(await service.clearCargoDeparture(1, input, fleet)).toEqual(original);
    await expect(setTripStatus({ tripId: 1, to: 'Passenger Onboard', session: actor, geofenceOverride: true, geofenceReason: 'Fixture override' })).rejects.toMatchObject({ code: 'CARGO_PICKUP_NOT_CLEARED' });
    await run(tx => tx.query('UPDATE trips SET vehicle_id=1 WHERE trip_id=1'));
    await setTripStatus({ tripId: 1, to: 'Passenger Onboard', session: actor, geofenceOverride: true, geofenceReason: 'Fixture override' });
    await setTripStatus({ tripId: 1, to: 'En Route', session: actor });
    await expect(cancelTrip(1, actor)).rejects.toMatchObject({ code: 'CARGO_CUSTODY_REVIEW_REQUIRED' });
    await expect(setTripStatus({ tripId: 1, to: 'Arrived', session: actor })).rejects.toMatchObject({ code: 'CARGO_RECEIVER_CONFIRMATION_REQUIRED' });
    await expect(completeTrip(1, actor)).rejects.toMatchObject({ code: 'CARGO_RECEIVER_CONFIRMATION_REQUIRED' });
    await stage('Drop-off');
    await service.submitCargoReceipt(1, receipt('10', 'DELIVERY'), actor);
    await apiFixture.transaction(async tx => { await prepareCargoLifecycle(tx); expect((await assertCargoCheckpoint({ trip_id: 1 }, { to: 'Completed', session: actor }, tx)).can_complete).toBe(true); });
    const audit = (await run(tx => tx.query("SELECT new_values FROM audit_logs WHERE action='cargo_checkpoint' ORDER BY log_id DESC LIMIT 1"))).rows[0];
    expect(JSON.stringify(audit)).not.toMatch(/https?:|remarks|payload/);
  });

  it('keeps passenger qualification independent when the simulated cargo boundary is active', async () => {
    enableLifecycle();
    await run(tx => tx.query("INSERT INTO service_types VALUES(2,'GUEST_TRANSPORT',NULL); INSERT INTO transportation_requests VALUES(2,'Passenger','PMS','passenger',2,NULL); INSERT INTO dispatchschedules VALUES(4,2,'PASSENGER'); INSERT INTO trips(trip_id,dispatch_id,driver_id,trip_status) VALUES(4,4,1,'Trip Started')"));
    await expect(setTripStatus({ tripId: 4, to: 'In Progress', session: actor })).rejects.toMatchObject({ code: 'DRIVER_SERVICE_QUALIFICATION_REQUIRED' });
    expect((await run(tx => tx.query('SELECT trip_status FROM trips WHERE trip_id=4'))).rows[0].trip_status).toBe('Trip Started');
  });

  it('rejects missing enforced qualification policy and stale manifest at the final checkpoint', async () => {
    const lifecycle = enableLifecycle();
    await stage('Driver Accepted');
    vi.stubEnv('DRIVER_QUALIFICATION_MODE', 'OFF');
    await expect(apiFixture.transaction(async tx => { await prepareCargoLifecycle(tx); return assertCargoCheckpoint({ trip_id: 1 }, { to: 'Trip Started', session: actor }, tx); })).rejects.toMatchObject({ status: 503 });
    vi.stubEnv('DRIVER_QUALIFICATION_MODE', 'ENFORCE');
    await stage('At Pickup');
    await service.submitCargoReceipt(1, receipt('10'), actor);
    const changed = { ...manifestSnapshot, lines: [{ ...manifest.lines[0], expected_quantity: '11' }] };
    await run(tx => tx.query('INSERT INTO request_cargo_manifest_revisions VALUES($1,1,2,$2,$3)', [randomUUID(), cargoPayloadHash(changed), JSON.stringify(changed)]));
    try {
      await expect(run(async base => { const tx = lifecycle.bindLifecycleTransaction(base); await prepareCargoLifecycle(tx); return assertCargoCheckpoint({ trip_id: 1 }, { to: 'Passenger Onboard', session: actor }, tx); })).rejects.toMatchObject({ code: 'CARGO_MANIFEST_CONFLICT' });
    } finally { await run(tx => tx.query('DELETE FROM request_cargo_manifest_revisions WHERE revision=2')); }
  });

  it('rolls back departure when its required checkpoint audit fails', async () => {
    const lifecycle = enableLifecycle();
    await stage('At Pickup');
    const picked = await service.submitCargoReceipt(1, receipt('10'), actor);
    await service.clearCargoDeparture(1, { receipt_id: picked.pickup_receipt.receipt_id, expected_version: picked.version, reason: 'Fixture securement' }, fleet);
    apiFixture.transaction = work => run(base => work(lifecycle.bindLifecycleTransaction({ query: (sql, params) => sql.includes('INSERT INTO audit_logs') ? Promise.reject(new Error('checkpoint audit failure')) : base.query(sql, params) })));
    await expect(setTripStatus({ tripId: 1, to: 'Passenger Onboard', session: actor, geofenceOverride: true, geofenceReason: 'Fixture override' })).rejects.toThrow('checkpoint audit failure');
    expect((await run(tx => tx.query('SELECT trip_status FROM trips WHERE trip_id=1'))).rows[0].trip_status).toBe('At Pickup');
  });

  it('serializes final departure behind committed revocation on a separate database session', async () => {
    const lifecycle = enableLifecycle();
    await stage('At Pickup');
    const picked = await service.submitCargoReceipt(1, receipt('10'), actor);
    await service.clearCargoDeparture(1, { receipt_id: picked.pickup_receipt.receipt_id, expected_version: picked.version, reason: 'Fixture securement' }, fleet);
    const client = await pool.connect();
    let departure;
    try {
      await client.query('BEGIN'); await client.query(`SET LOCAL search_path TO ${schema},pg_catalog`);
      await client.query('SELECT driver_id FROM drivers WHERE driver_id=1 FOR UPDATE');
      await client.query("UPDATE driver_service_qualifications SET status='REVOKED',version=version+1 WHERE driver_id=1");
      let entered; const waiting = new Promise(resolve => { entered = resolve; });
      apiFixture.transaction = work => run(base => work(lifecycle.bindLifecycleTransaction({ query: async (sql, params) => {
        if (sql.startsWith('SELECT driver_id FROM drivers WHERE driver_id=')) entered();
        return base.query(sql, params);
      } })));
      departure = setTripStatus({ tripId: 1, to: 'Passenger Onboard', session: actor, geofenceOverride: true, geofenceReason: 'Fixture override' }).then(value => ({ value }), error => ({ error }));
      await waiting;
      await client.query('COMMIT');
      expect((await departure).error).toMatchObject({ code: 'DRIVER_SERVICE_QUALIFICATION_REQUIRED', status: 409 });
      expect((await run(tx => tx.query('SELECT trip_status FROM trips WHERE trip_id=1'))).rows[0].trip_status).toBe('At Pickup');
    } finally {
      await client.query('ROLLBACK'); client.release();
      if (departure) await departure;
      await run(tx => tx.query("UPDATE driver_service_qualifications SET status='ACTIVE',version=version+1 WHERE driver_id=1"));
    }
  });

  it('reruns the candidate safely and keeps command snapshots private', async () => {
    await run(tx => tx.query(migration));
    await run(tx => tx.query(manualMigration));
    const row = (await pool.query(`SELECT relrowsecurity,has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') anon,has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') authenticated FROM pg_class WHERE oid=$1::regclass`, [`${schema}.cargo_execution_commands`])).rows[0];
    expect(row).toEqual({ relrowsecurity: true, anon: false, authenticated: false });
    const provenance=(await pool.query(`SELECT relrowsecurity,has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') anon,has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') authenticated FROM pg_class WHERE oid=$1::regclass`,[`${schema}.cargo_manual_decision_provenance`])).rows[0];
    expect(provenance).toEqual({relrowsecurity:true,anon:false,authenticated:false});
  });
  it('durably records independently resolved manual provenance and exact replay after later events',async()=>{
    const picked=await prepare(),input=await manualInput(picked),manual=makeManualService();
    const api=createCargoApi({service:manual,simulated:true,environment:'test',approvalRef:'simulated:api',authorizeStaff:async()=>true});
    apiFixture.session=fleet;
    let original;
    try {
      const response=await api.manualDecision(new Request('http://localhost/api/trips/1/cargo/manual-decision',{method:'POST',body:JSON.stringify(input)}),{params:Promise.resolve({id:'1'})});
      expect(response.status).toBe(200);original=(await response.json()).data;
    } finally { apiFixture.session=actor; }
    expect(original.source_decision.manual_provenance).toMatchObject({recording_employee_id:2,approver_identity:input.approver_identity,approver_reference:input.approver_reference,communication_evidence_ids:input.communication_evidence_ids,source_system:source.system,source_organization_id:source.organization_id});
    const stored=(await run(tx=>tx.query('SELECT * FROM cargo_manual_decision_provenance WHERE decision_id=$1',[original.source_decision.decision_id]))).rows[0];
    expect(stored.authority_proof.reference).toBe(communications.get(input.communication_evidence_ids[0]).reference);
    const audit=(await run(tx=>tx.query('SELECT a.* FROM audit_logs a JOIN cargo_execution_commands c ON c.audit_log_id=a.log_id WHERE c.command_key=$1',[input.event_id]))).rows[0];
    expect(audit.employee_id).toBe(2);expect(audit.action).toBe('cargo_manual_decision');expect(original.source_decision.principal_ref).toBe(input.approver_reference);
    await expect(run(tx=>tx.query(`INSERT INTO cargo_manual_decision_provenance SELECT decision_id,execution_id,receipt_id,recording_employee_id,source_system,source_organization_id,external_request_id,'forged owner',approver_reference,communicated_at,communication_evidence_ids,authority_reference,authority_approval_ref,authority_proof,command_payload,created_at FROM cargo_manual_decision_provenance WHERE decision_id=$1`,[original.source_decision.decision_id]))).rejects.toMatchObject({code:'23514'});
    await expect(run(async tx=>{
      const commandId=randomUUID();
      const auditRow=(await tx.query("INSERT INTO audit_logs(action,resource,resource_id,employee_id,new_values) VALUES('cargo_manual_decision','cargo_execution',1,1,$1) RETURNING log_id",[JSON.stringify({command_id:commandId})])).rows[0];
      await tx.query(`INSERT INTO cargo_execution_commands(command_id,execution_id,command_kind,command_key,payload_hash,receipt_id,decision_id,clearance_id,audit_log_id,response,evidence_id) SELECT $1,execution_id,command_kind,command_key,payload_hash,receipt_id,decision_id,clearance_id,$2,response,evidence_id FROM cargo_execution_commands WHERE command_key=$3`,[commandId,auditRow.log_id,input.event_id]);
    })).rejects.toMatchObject({code:'23514'});
    await service.submitCargoReceipt(1,receipt('10'),actor);await stage('En Route');
    expect(await manual.recordManualCargoDecision(1,input,fleet)).toEqual(original);
    await expect(manual.recordManualCargoDecision(1,{...input,approver_reference:'changed-owner'},fleet)).rejects.toMatchObject({code:'CARGO_REPLAY_CONFLICT',status:409});
    await expect(run(tx=>tx.query('UPDATE cargo_manual_decision_provenance SET approver_identity=$1 WHERE decision_id=$2',['changed',original.source_decision.decision_id]))).rejects.toMatchObject({code:'55000'});
  });
  it('refuses caller communication IDs without independent proof and rejects foreign source/evidence',async()=>{
    const picked=await prepare(),input=await manualInput(picked);
    await expect(makeManualService({resolveManualAuthority:undefined}).recordManualCargoDecision(1,input,fleet)).rejects.toMatchObject({status:503});
    await expect(makeManualService({resolveManualAuthority:async()=>null}).recordManualCargoDecision(1,input,fleet)).rejects.toMatchObject({status:403});
    await expect(makeManualService().recordManualCargoDecision(1,{...input,action:'WAIT'},fleet)).rejects.toMatchObject({status:403});
    await expect(makeManualService({authorizeManualRecord:async()=>false}).recordManualCargoDecision(1,input,{user:{role:'admin',employeeId:2}})).rejects.toMatchObject({status:403});
    await expect(makeManualService({resolveManualAuthority:async()=>({...communications.get(input.communication_evidence_ids[0]),source_ref:{...manifest.source_ref,organization_id:'foreign'}})}).recordManualCargoDecision(1,input,fleet)).rejects.toMatchObject({status:403});
    await expect(makeManualService().recordManualCargoDecision(1,input,actor)).rejects.toMatchObject({status:403});
    const foreignExecution=randomUUID(),foreignEvidence=randomUUID(),submission=randomUUID();
    await run(async tx=>{
      await tx.query('INSERT INTO cargo_trip_executions(execution_id,trip_id,request_manifest_id,manifest) VALUES($1,2,$2,$3)',[foreignExecution,manifest.manifest_ref.id,JSON.stringify(manifest)]);
      await tx.query(`INSERT INTO cargo_evidence(evidence_id,execution_id,uploader_employee_id,uploader_driver_id,submission_id,object_key,mime_type,byte_length,content_hash,state) VALUES($1,$2,2,2,$3,$4,'image/jpeg',3,$5,'READY')`,[foreignEvidence,foreignExecution,submission,`${foreignExecution}/${submission}/${foreignEvidence}.jpg`,'d'.repeat(64)]);
    });
    const foreignInput={...input,communication_evidence_ids:[foreignEvidence]};
    communications.set(foreignEvidence,{...communications.get(input.communication_evidence_ids[0]),evidence_ids:[foreignEvidence]});
    await expect(makeManualService().recordManualCargoDecision(1,foreignInput,fleet)).rejects.toMatchObject({status:404});
  });
  it.each(['audit_logs','cargo_feedback_outbox','cargo_manual_decision_provenance','cargo_execution_commands'])('rolls manual provenance, decision, inbox, version and feedback back if required %s fails',async table=>{
    const picked=await prepare(),input=await manualInput(picked);
    const failing=makeManualService({db:{withTransaction:work=>db.withTransaction(tx=>work({query:(sql,params)=>sql.includes(`INSERT INTO ${table}`)?Promise.reject(new Error('required manual write failure')):tx.query(sql,params)}))}});
    await expect(failing.recordManualCargoDecision(1,input,fleet)).rejects.toThrow('required manual write failure');
    expect((await run(tx=>tx.query('SELECT * FROM cargo_decisions WHERE event_id=$1',[input.event_id]))).rows).toHaveLength(0);
    expect((await run(tx=>tx.query('SELECT * FROM cargo_decision_inbox WHERE event_id=$1',[input.event_id]))).rows).toHaveLength(0);
    expect((await service.getCargoExecution(1,actor)).version).toBe(picked.version);
    expect((await run(tx=>tx.query('SELECT * FROM cargo_feedback_outbox WHERE receipt_id=$1 AND event_type=$2',[input.receipt_id,'SOURCE_DECISION_RECORDED']))).rows).toHaveLength(0);
    expect((await run(tx=>tx.query('SELECT * FROM cargo_manual_decision_provenance WHERE receipt_id=$1',[input.receipt_id]))).rows).toHaveLength(0);
  });
  it('persists the evidence upload view and ID once and replays after later events',async()=>{
    const picked=await prepare(),input=await manualInput(picked),evidenceId=input.communication_evidence_ids[0];
    const api=createCargoApi({service,simulated:true,environment:'test',approvalRef:'simulated:api',storeEvidence:async()=>({evidence_id:evidenceId})});
    const idForEvidence=(await run(tx=>tx.query('SELECT submission_id FROM cargo_evidence WHERE evidence_id=$1',[evidenceId]))).rows[0].submission_id;
    const upload=()=>{
      const form=new FormData();form.append('submission_id',idForEvidence);form.append('file',new File([new Uint8Array([255,216,255])],'communication.jpg',{type:'image/jpeg'}));
      return api.evidence(new Request('http://localhost/api/trips/1/cargo/evidence',{method:'POST',body:form}),{params:Promise.resolve({id:'1'})});
    };
    const response=await upload();expect(response.status).toBe(200);const original=(await response.json()).data;
    expect(original).toMatchObject({execution_id:picked.execution_id,evidence_upload:{evidence_id:evidenceId}});
    await service.submitCargoReceipt(1,receipt('10'),actor);
    expect(await (await upload()).json()).toEqual({data:original});
    expect(JSON.stringify(original)).not.toMatch(/https?:\/\//);
  });
  it.each(['audit_logs','cargo_execution_commands'])('keeps READY upload tracking when its required %s write fails',async table=>{
    const picked=await prepare(),input=await manualInput(picked),evidenceId=input.communication_evidence_ids[0];
    const failing=makeService({db:{withTransaction:work=>db.withTransaction(tx=>work({query:(sql,params)=>sql.includes(`INSERT INTO ${table}`)?Promise.reject(new Error('required evidence write failure')):tx.query(sql,params)}))}});
    await expect(failing.recordCargoEvidenceUpload(1,evidenceId,actor)).rejects.toThrow('required evidence write failure');
    expect((await run(tx=>tx.query('SELECT state FROM cargo_evidence WHERE evidence_id=$1',[evidenceId]))).rows[0].state).toBe('READY');
    expect((await run(tx=>tx.query('SELECT * FROM cargo_execution_commands WHERE command_key=$1',[evidenceId]))).rows).toHaveLength(0);
  });
  it('routes actual scoped source duplicates and conflicts without storing URLs',async()=>{
    await stage('At Pickup');
    const adapter=createCargoReadAdapter({config,db:{query:(...args)=>run(tx=>tx.query(...args)),withTransaction:db.withTransaction},simulated:true,environment:'test',approvalRef:'simulated:read'});
    const api=createCargoApi({service,simulated:true,environment:'test',approvalRef:'simulated:api',readHistory:adapter.readHistory,resolveSourceRequest:adapter.resolveSourceRequest,credentials:[{secret:'fixture-secret',system:source.system,organization_id:source.organization_id,subject:source.subject,approval_ref:'simulated:source',simulated:true,capabilities:source.capabilities}]});
    const request=(body)=>new Request('http://localhost/api/integration/cargo/decisions',{method:'POST',headers:{authorization:'Bearer fixture-secret'},body:JSON.stringify(body)});
    const picked=await api.receipts(new Request('http://localhost/api/trips/1/cargo/receipts',{method:'POST',body:JSON.stringify(receipt())}),{params:Promise.resolve({id:'1'})});
    expect(picked.status).toBe(200);
    const payload={...decision((await picked.json()).data),external_request_id:'r1'};
    const read=await api.get(new Request('http://localhost/api/trips/1/cargo?history_limit=1'),{params:Promise.resolve({id:'1'})});
    expect(read.status).toBe(200);expect((await read.json()).data.history.rows).toHaveLength(1);
    const first=await api.sourceDecision(request(payload));expect(first.status).toBe(200);const original=await first.json();
    expect(await (await api.sourceDecision(request(payload))).json()).toEqual(original);
    expect((await api.sourceDecision(request({...payload,reason:'Changed owner instruction'}))).status).toBe(409);
    expect((await api.sourceDecision(request({...payload,external_request_id:'foreign'}))).status).toBe(404);
    const other=createCargoApi({service,simulated:true,environment:'test',approvalRef:'simulated:api',resolveSourceRequest:adapter.resolveSourceRequest,credentials:[{secret:'fixture-secret',system:source.system,organization_id:'other-hotel',subject:source.subject,approval_ref:'simulated:source',simulated:true,capabilities:source.capabilities}]});
    expect((await other.sourceDecision(request(payload))).status).toBe(404);
    expect(JSON.stringify(original)).not.toMatch(/https?:\/\//);
  });
  it('preserves 10/9/9 and requires separate source, Fleet and receiver authority', async () => {
    const picked = await prepare(); expect(picked.pickup_state).toBe('AWAITING_DECISION');
    const accepted = await service.recordSourceDecision(1, decision(picked), source); expect(accepted.can_depart).toBe(false);
    const cleared = await service.clearCargoDeparture(1, { receipt_id: picked.pickup_receipt.receipt_id, expected_version: accepted.version, reason: 'Simulated securement checked' }, fleet);
    expect(cleared.can_depart).toBe(true); expect(cleared.fleet_clearance.version).toBe(cleared.version);
    expect((await service.getCargoExecution(1, actor)).can_depart).toBe(true);
    expect((await makeService({ config: { ...config, safetyApprovalRef: 'simulated:replacement' } }).getCargoExecution(1, actor)).can_depart).toBe(false);
    await stage('Drop-off');
    const delivered = await service.submitCargoReceipt(1, receipt('9', 'DELIVERY'), actor);
    expect(delivered).toMatchObject({ delivery_state: 'CONFIRMED', can_complete: true });
    expect(delivered.lines[0]).toMatchObject({ expected_quantity: '10', pickup_quantity: '9', delivery_quantity: '9', order_shortage: '1', delivery_shortage: '0' });
    expect((await run(tx => tx.query("SELECT event_type FROM cargo_feedback_outbox WHERE receipt_id=$1", [delivered.delivery_receipt.receipt_id]))).rows).toEqual([{ event_type: 'DELIVERY_RECORDED' }]);
  });
  it('replays the original whole view after recount, source changes and config changes', async () => {
    await stage('At Pickup'); const input = receipt(); const original = await service.submitCargoReceipt(1, input, actor);
    const command = decision(original); const accepted = await service.recordSourceDecision(1, command, source);
    await service.submitCargoReceipt(1, receipt('10'), actor);
    const changedConfig = makeService({ config: { ...config, safetyApprovalRef: 'simulated:changed' } });
    expect(await changedConfig.submitCargoReceipt(1, input, actor)).toEqual(original);
    expect(await changedConfig.recordSourceDecision(1, command, source)).toEqual(accepted);
    await expect(service.submitCargoReceipt(1, { ...input, observed_at: '2026-10-09T09:00:00Z' }, actor)).rejects.toMatchObject({ status: 409 });
    await expect(service.recordSourceDecision(1, { ...command, action: 'WAIT' }, source)).rejects.toMatchObject({ status: 409 });
  });
  it('checks authenticated identities and source scope before replay or writes', async () => {
    const picked = await prepare(); const command = decision(picked);
    await expect(service.submitCargoReceipt(1, receipt(), { user: { role: 'driver', driverId: 1, employeeId: 2 } })).rejects.toMatchObject({ status: 404 });
    await expect(service.recordSourceDecision(1, command, actor)).rejects.toMatchObject({ status: 403 });
    await expect(service.recordSourceDecision(1, command, { ...source, organization_id: 'foreign' })).rejects.toMatchObject({ status: 403 });
    await expect(service.recordSourceDecision(2, command, source)).rejects.toMatchObject({ status: 404 });
    await expect(service.clearCargoDeparture(1, { receipt_id: picked.pickup_receipt.receipt_id, expected_version: picked.version, reason: 'x' }, actor)).rejects.toMatchObject({ status: 403 });
    await expect(service.submitCargoReceipt(1, { ...receipt(), manifest_ref: { ...manifest.manifest_ref, revision: 2 } }, actor)).rejects.toMatchObject({ status: 409, code: 'CARGO_MANIFEST_CONFLICT' });
    await expect(service.submitCargoReceipt(1, { ...receipt(), lines: [{ ...receipt().lines[0], observed_quantity: 'NaN' }] }, actor)).rejects.toMatchObject({ status: 400, code: 'CARGO_INVALID_INPUT' });
  });
  it('holds clean receipts without post-load evidence and blocks caller receiver references', async () => {
    await stage('At Pickup'); const picked = await service.submitCargoReceipt(1, receipt('10'), actor);
    const missingSafety = makeService({ resolveSafetyProof: undefined });
    await expect(missingSafety.clearCargoDeparture(1, { receipt_id: picked.pickup_receipt.receipt_id, expected_version: picked.version, reason: 'x' }, fleet)).rejects.toMatchObject({ code: 'CARGO_SECUREMENT_REQUIRED' });
    await service.clearCargoDeparture(1, { receipt_id: picked.pickup_receipt.receipt_id, expected_version: picked.version, reason: 'x' }, fleet);
    await stage('Drop-off'); const input = { ...receipt('10', 'DELIVERY'), receiver_confirmation_ref: randomUUID() };
    const observed = await makeService({ resolveReceiverProof: undefined }).submitCargoReceipt(1, input, actor);
    expect(observed.can_complete).toBe(false); expect(observed.blockers).toContainEqual(expect.objectContaining({ code: 'CARGO_RECEIVER_CONFIRMATION_REQUIRED' }));
  });
  it('invalidates acceptance/clearance on recount, and refuses stale decisions', async () => {
    const picked = await prepare(); const accepted = await service.recordSourceDecision(1, decision(picked), source);
    await service.clearCargoDeparture(1, { receipt_id: picked.pickup_receipt.receipt_id, expected_version: accepted.version, reason: 'x' }, fleet);
    const recount = await service.submitCargoReceipt(1, receipt(), actor); expect(recount.can_depart).toBe(false);
    await expect(service.recordSourceDecision(1, decision(picked), source)).rejects.toMatchObject({ status: 409 });
    await expect(service.clearCargoDeparture(1, { receipt_id: picked.pickup_receipt.receipt_id, expected_version: recount.version, reason: 'x' }, fleet)).rejects.toMatchObject({ status: 409 });
  });
  it('allows source review while travelling to pickup, but safely audits a late new decision', async () => {
    const picked = await prepare(); await stage('Trip Started'); const wait = { ...decision(picked), action: 'WAIT' }; const held = await service.recordSourceDecision(1, wait, source);
    await stage('En Route'); const before = (await run(tx => tx.query('SELECT count(*)::int n FROM cargo_decisions'))).rows[0].n;
    expect(await service.recordSourceDecision(1, wait, source)).toEqual(held);
    await expect(service.recordSourceDecision(1, decision(picked), source)).rejects.toMatchObject({ code: 'CARGO_CUSTODY_LOCKED', status: 409 });
    expect((await run(tx => tx.query('SELECT count(*)::int n FROM cargo_decisions'))).rows[0].n).toBe(before);
    expect((await run(tx => tx.query("SELECT count(*)::int n FROM audit_logs WHERE action='cargo_decision_late'"))).rows[0].n).toBe(1);
  });
  it.each(['audit_logs', 'cargo_feedback_outbox'])('rolls all receipt writes back if mandatory %s fails', async table => {
    await stage('At Pickup'); const input = receipt();
    const failing = makeService({ db: { withTransaction: work => db.withTransaction(tx => work({ query: (sql, params) => sql.includes(`INSERT INTO ${table}`) ? Promise.reject(new Error('fixture required write failure')) : tx.query(sql, params) })) } });
    await expect(failing.submitCargoReceipt(1, input, actor)).rejects.toThrow('fixture required write failure');
    expect((await run(tx => tx.query('SELECT * FROM cargo_receipts WHERE submission_id=$1', [input.submission_id]))).rows).toHaveLength(0);
    expect((await run(tx => tx.query('SELECT * FROM cargo_execution_commands WHERE command_key=$1', [input.submission_id]))).rows).toHaveLength(0);
  });
  it.each(['audit_logs', 'cargo_feedback_outbox'])('rolls source decision, inbox, version and feedback back if %s fails', async table => {
    const picked = await prepare(); const input = decision(picked);
    const failing = makeService({ db: { withTransaction: work => db.withTransaction(tx => work({ query: (sql, params) => sql.includes(`INSERT INTO ${table}`) ? Promise.reject(new Error('fixture required write failure')) : tx.query(sql, params) })) } });
    await expect(failing.recordSourceDecision(1, input, source)).rejects.toThrow('fixture required write failure');
    expect((await run(tx => tx.query('SELECT * FROM cargo_decision_inbox WHERE event_id=$1', [input.event_id]))).rows).toHaveLength(0);
    expect((await run(tx => tx.query('SELECT * FROM cargo_decisions WHERE event_id=$1', [input.event_id]))).rows).toHaveLength(0);
    expect((await service.getCargoExecution(1, actor)).version).toBe(picked.version);
  });
  it('rolls a clearance and its version back on audit failure', async () => {
    await stage('At Pickup'); const picked = await service.submitCargoReceipt(1, receipt('10'), actor);
    const failing = makeService({ db: { withTransaction: work => db.withTransaction(tx => work({ query: (sql, params) => sql.includes('INSERT INTO audit_logs') ? Promise.reject(new Error('audit failure')) : tx.query(sql, params) })) } });
    await expect(failing.clearCargoDeparture(1, { receipt_id: picked.pickup_receipt.receipt_id, expected_version: picked.version, reason: 'fixture' }, fleet)).rejects.toThrow('audit failure');
    expect((await service.getCargoExecution(1, actor)).version).toBe(picked.version);
    expect((await run(tx => tx.query('SELECT * FROM cargo_fleet_clearances WHERE receipt_id=$1', [picked.pickup_receipt.receipt_id]))).rows).toHaveLength(0);
  });
  it('serializes duplicate requests from distinct database sessions into one response and audit', async () => {
    await stage('At Pickup'); const input = receipt(); const sessions = new Set();
    const concurrent = makeService({ db: { withTransaction: work => db.withTransaction(async tx => { sessions.add((await tx.query('SELECT pg_backend_pid() pid')).rows[0].pid); return work(tx); }) } });
    const result = await Promise.all([concurrent.submitCargoReceipt(1, input, actor), concurrent.submitCargoReceipt(1, input, actor)]);
    expect(sessions.size).toBe(2); expect(result[0]).toEqual(result[1]);
    const commands = (await run(tx => tx.query('SELECT * FROM cargo_execution_commands WHERE command_key=$1', [input.submission_id]))).rows;
    expect(commands).toHaveLength(1); expect(commands[0].audit_log_id).toBeTruthy();
    await expect(run(tx => tx.query('UPDATE cargo_execution_commands SET response=$1 WHERE command_key=$2', ['{}', input.submission_id]))).rejects.toMatchObject({ code: '55000' });
    const fakeCommand = randomUUID();
    await expect(run(async tx => {
      const audit = (await tx.query("INSERT INTO audit_logs(action,resource,resource_id,employee_id,new_values) VALUES('cargo_receipt','cargo_execution',1,1,$1) RETURNING log_id", [JSON.stringify({ command_id: fakeCommand })])).rows[0];
      await tx.query(`INSERT INTO cargo_execution_commands(command_id,execution_id,command_kind,command_key,payload_hash,receipt_id,audit_log_id,response)
        SELECT $1,execution_id,command_kind,'invented-submission',payload_hash,receipt_id,$2,response FROM cargo_execution_commands WHERE command_key=$3`, [fakeCommand, audit.log_id, input.submission_id]);
    })).rejects.toMatchObject({ code: '23514' });
  });
});
