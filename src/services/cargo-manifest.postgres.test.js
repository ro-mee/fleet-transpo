import { beforeAll, afterAll, it, expect, describe } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { loadEnvLocal } from '../../scripts/load-env.mjs';
import { ingestRequestManifest, resolveTripManifest } from './cargo-manifest.service';

const enabled = process.env.CARGO_FIXTURE_DB_TEST === '1';
let pool, client, db, migration;
const schema = `cargo_fixture_${randomUUID().replaceAll('-', '')}`;
const principal = { system: 'PMS', organization_id: 'simulated:hotel', subject: 'fixture', capabilities: ['cargo:manifest:write'] };
const envelope = () => ({ event_id: 'simulated:event1', revision: 1, manifest: { source_ref: { system: 'PMS', organization_id: 'simulated:hotel', external_request_id: 'r1' }, service_code: 'HOTEL_SUPPLY_TRANSFER', lines: [{ line_id: 'oil', name: 'Oil', quantity_basis: 'TRANSPORT_PACKAGE', expected_quantity: '10', unit: 'box', reference_image_ref: null, handling: [] }] } });
describe.skipIf(!enabled)('candidate cargo SQL and real ingest, isolated rollback schema only', () => {
  beforeAll(async () => {
    loadEnvLocal();
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 5000 });
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout='8s'");
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path TO ${schema}, pg_catalog`);
    await client.query(`CREATE TABLE transportation_requests (request_id integer PRIMARY KEY, source_system text, external_request_id text, load_type text, service_type_id integer, deleted_at timestamptz);
      CREATE TABLE service_types (service_type_id integer PRIMARY KEY, service_code text);
      CREATE TABLE dispatchschedules (dispatch_id integer PRIMARY KEY, request_id integer, service_type text);
      CREATE TABLE trips (trip_id integer PRIMARY KEY, dispatch_id integer);
      CREATE TABLE supply_shipments (supply_shipment_id uuid PRIMARY KEY, source_organization_id text, external_request_id text, current_manifest_revision integer);
      CREATE TABLE supply_manifest_revisions (supply_manifest_revision_id uuid PRIMARY KEY, supply_shipment_id uuid, manifest_revision integer, manifest_hash text, manifest_snapshot jsonb);
      CREATE TABLE supply_dispatch_allocations (dispatch_id integer, supply_shipment_id uuid, manifest_revision integer, allocation_status text);
      INSERT INTO service_types VALUES (1, 'HOTEL_SUPPLY_TRANSFER');
      INSERT INTO transportation_requests VALUES (1, 'PMS', 'r1', 'Cargo', 1, NULL), (2, 'PMS', 'r2', 'Cargo', 1, NULL);`);
    await client.query('ALTER TABLE transportation_requests ADD COLUMN cargo_weight_kg numeric(12,3)');
    migration = readFileSync('supabase/migrations/158_request_cargo_manifest_revisions.sql', 'utf8').replaceAll('public.', `${schema}.`);
    await client.query(migration);
    db = { query: (...args) => client.query(...args), withTransaction: async fn => {
      await client.query('SAVEPOINT ingest');
      try { const result = await fn(db); await client.query('RELEASE SAVEPOINT ingest'); return result; }
      catch (error) { await client.query('ROLLBACK TO SAVEPOINT ingest'); throw error; }
    }, cargoConfig: { dataApprovalRef: 'simulated:data', privacyApprovalRef: 'simulated:privacy', schemaReady: true, simulated: true, environment: 'test', requestOwnership: [{ system: 'PMS', external_request_id: 'r1', organization_id: 'simulated:hotel' }] } };
  }, 20000);
  afterAll(async () => { try { if (client) await client.query('ROLLBACK'); } finally { client?.release(); await pool?.end(); } });
  it('is idempotent and private with no anonymous/authenticated table privileges', async () => {
    await client.query(migration);
    const { rows } = await client.query(`SELECT c.relrowsecurity, has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') anon, has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') authenticated FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname='request_cargo_manifest_revisions'`, [schema]);
    expect(rows).toEqual([{ relrowsecurity: true, anon: false, authenticated: false }]);
  });
  it('ingests once, reads typed request cargo despite PASSENGER discriminator, and detects changed event replay', async () => {
    const result = await ingestRequestManifest(envelope(), principal, db);
    expect(result.replayed).toBe(false);
    expect(await ingestRequestManifest(envelope(), principal, db)).toEqual({ ...result, replayed: true });
    await client.query("INSERT INTO dispatchschedules VALUES (1,1,'PASSENGER'); INSERT INTO trips VALUES(1,1)");
    const view = await resolveTripManifest(1, db);
    expect(view.manifest_ref).toEqual(result.manifest_ref);
    expect(view.lines[0].expected_quantity).toBe('10');
    const changed = envelope(); changed.manifest.lines[0].expected_quantity = '9';
    await expect(ingestRequestManifest(changed, principal, db)).rejects.toMatchObject({ status: 409 });
    expect((await client.query('SELECT count(*)::int AS count FROM request_cargo_manifest_revisions')).rows[0].count).toBe(1);
  });
  it('does not derive organization ownership from first writer and blocks later revisions without custody hook', async () => {
    const foreign = envelope(); foreign.event_id = 'simulated:event2'; foreign.manifest.source_ref.external_request_id = 'r2';
    await expect(ingestRequestManifest(foreign, principal, db)).rejects.toMatchObject({ code: 'CARGO_SOURCE_SCOPE_REQUIRED' });
    await expect(ingestRequestManifest(envelope(), { ...principal, organization_id: 'other' }, db)).rejects.toMatchObject({ status: 403 });
    await expect(ingestRequestManifest({ ...envelope(), event_id: 'simulated:event2', revision: 2 }, principal, db)).rejects.toMatchObject({ code: 'CARGO_REVISION_REVIEW_REQUIRED', status: 409 });
  });
  it('rejects SQL updates and deletes and duplicate request revisions', async () => {
    for (const sql of ["UPDATE request_cargo_manifest_revisions SET revision=2", 'DELETE FROM request_cargo_manifest_revisions', 'INSERT INTO request_cargo_manifest_revisions SELECT * FROM request_cargo_manifest_revisions', "UPDATE transportation_requests SET external_request_id='changed' WHERE request_id=1", "UPDATE transportation_requests SET load_type='Passenger' WHERE request_id=1"]) {
      await client.query('SAVEPOINT negative');
      await expect(client.query(sql)).rejects.toBeDefined();
      await client.query('ROLLBACK TO SAVEPOINT negative');
    }
  });
  it('rejects missing source identity inside JSON instead of accepting SQL unknown', async () => {
    const input = envelope().manifest;
    input.source_ref = {};
    await client.query('SAVEPOINT negative');
    await expect(client.query(`INSERT INTO request_cargo_manifest_revisions(request_id,revision,manifest_hash,source_system,source_organization_id,source_external_request_id,source_event_id,manifest_snapshot)
      VALUES(2,1,$1,'PMS','simulated:hotel','r2','bad-json',$2::jsonb)`, ['a'.repeat(64), JSON.stringify(input)])).rejects.toBeDefined();
    await client.query('ROLLBACK TO SAVEPOINT negative');
  });
  it('refuses attaching a first manifest to already dispatched work until custody review exists', async () => {
    await client.query("INSERT INTO dispatchschedules VALUES (2,2,'PASSENGER')");
    const input = envelope(); input.event_id = 'simulated:event3'; input.manifest.source_ref.external_request_id = 'r2';
    const configured = { ...db, cargoConfig: { ...db.cargoConfig, requestOwnership: [...db.cargoConfig.requestOwnership, { system: 'PMS', external_request_id: 'r2', organization_id: 'simulated:hotel' }] } };
    await expect(ingestRequestManifest(input, principal, configured)).rejects.toMatchObject({ code: 'CARGO_REVISION_REVIEW_REQUIRED' });
  });
  it('resolves only an assigned current supply allocation and an exact approved service mapping', async () => {
    const shipment = randomUUID(), revision = randomUUID();
    await client.query("INSERT INTO dispatchschedules VALUES (3,NULL,'SUPPLY_DELIVERY'); INSERT INTO trips VALUES(3,3)");
    await client.query("INSERT INTO supply_shipments VALUES($1,'simulated:scm','s1',1)", [shipment]);
    await client.query('INSERT INTO supply_manifest_revisions VALUES($1,$2,1,$3,$4::jsonb)', [revision, shipment, 'b'.repeat(64), JSON.stringify({ lines: [{ external_line_id: 'crate', sku_ref: 'SKU', transport_package_count: 2, ordered_quantity: 100, ordered_uom: 'unit', handling: [] }] })]);
    await client.query("INSERT INTO supply_dispatch_allocations VALUES(3,$1,1,'ASSIGNED')", [shipment]);
    await expect(resolveTripManifest(3, db)).rejects.toMatchObject({ code: 'CARGO_SERVICE_REQUIRED' });
    const configured = { ...db, cargoConfig: { ...db.cargoConfig, supplyServices: [{ system: 'SCM', organization_id: 'simulated:scm', external_request_id: 's1', approval_ref: 'simulated:service', service_code: 'RESTAURANT_SUPPLY_PICKUP' }] } };
    expect(await resolveTripManifest(3, configured)).toMatchObject({ manifest_ref: { kind: 'SUPPLY', id: revision, revision: 1 }, service_code: 'RESTAURANT_SUPPLY_PICKUP', lines: [{ expected_quantity: '2', unit: 'packages' }] });
    await client.query('UPDATE supply_shipments SET current_manifest_revision=2 WHERE supply_shipment_id=$1', [shipment]);
    await expect(resolveTripManifest(3, configured)).rejects.toMatchObject({ code: 'CARGO_MANIFEST_REQUIRED' });
  });
});
