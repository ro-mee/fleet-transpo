import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { loadEnvLocal } from '../../scripts/load-env.mjs';
import { createHash } from 'node:crypto';

const serviceDeps = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn(), upload: vi.fn(), download: vi.fn(), sign: vi.fn(), scan: vi.fn() }));
vi.mock('@/lib/db', () => ({ query: serviceDeps.query, withTransaction: serviceDeps.transaction }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ storage: { from: () => ({ upload: serviceDeps.upload, download: serviceDeps.download, createSignedUrl: serviceDeps.sign }) } }) }));
vi.mock('@/lib/trips/gemini-odometer', () => ({ scanOdometerWithGemini: serviceDeps.scan }));
vi.mock('@/lib/api/utils', () => ({ AuthError: class extends Error { constructor(message, status, code) { super(message); this.status = status; this.code = code; } } }));
import { uploadOdometerCapture, scanOdometerCapture, consumeOdometerCapture } from './trip-odometer.service';

const enabled = process.env.ODOMETER_FIXTURE_DB_TEST === '1';
const schema = `odometer_fixture_${randomUUID().replaceAll('-', '')}`;
let client, pool, migration;
describe.skipIf(!enabled)('odometer SQL constraints in isolated rollback schema', () => {
  beforeAll(async () => {
    loadEnvLocal();
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 5000 });
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout='8s'");
    await client.query(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema}, pg_catalog;
      CREATE TABLE trips(trip_id integer PRIMARY KEY);
      CREATE TABLE drivers(driver_id integer PRIMARY KEY);
      CREATE TABLE vehicles(vehicle_id integer PRIMARY KEY);
      CREATE TABLE buckets(id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      INSERT INTO trips VALUES(1); INSERT INTO drivers VALUES(1); INSERT INTO vehicles VALUES(1);`);
    migration = readFileSync('supabase/migrations/164_trip_odometer_captures.sql', 'utf8')
      .replaceAll('public.', `${schema}.`).replaceAll('storage.buckets', `${schema}.buckets`);
    await client.query(migration);
  }, 20000);
  afterAll(async () => { try { if (client) await client.query('ROLLBACK'); } finally { client?.release(); await pool?.end(); } });
  const insert = async (changes = {}) => {
    const row = { capture_id: randomUUID(), trip_id: 1, driver_id: 1, vehicle_id: 1, stage: 'start', storage_key: randomUUID(), image_sha256: 'a'.repeat(64), content_type: 'image/jpeg', byte_size: 100, ...changes };
    const keys = Object.keys(row);
    return client.query(`INSERT INTO trip_odometer_captures(${keys.join(',')}) VALUES(${keys.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row));
  };
  const rejected = async (changes, code) => {
    await client.query('SAVEPOINT invalid');
    try { await expect(insert(changes)).rejects.toMatchObject({ code }); }
    finally { await client.query('ROLLBACK TO SAVEPOINT invalid'); }
  };
  it('reapplies safely and forces an existing bucket private with bounded uploads', async () => {
    await client.query("UPDATE buckets SET public=true,file_size_limit=99999999,allowed_mime_types=ARRAY['text/plain']");
    await client.query(migration);
    expect((await client.query('SELECT public,file_size_limit,allowed_mime_types FROM buckets')).rows).toEqual([{ public: false, file_size_limit: '5242880', allowed_mime_types: ['image/jpeg', 'image/png'] }]);
    expect((await client.query("SELECT odometer_capture_required FROM trips")).rows).toEqual([{ odometer_capture_required: false }]);
  });
  it('enables RLS and removes every client privilege', async () => {
    const { rows } = await client.query(`SELECT relrowsecurity,
      has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS anon,
      has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS authenticated
      FROM pg_class WHERE oid=$1::regclass`, [`${schema}.trip_odometer_captures`]);
    expect(rows).toEqual([{ relrowsecurity: true, anon: false, authenticated: false }]);
  });
  it('allows drafts and one committed capture per trip stage', async () => {
    await insert(); await insert();
    const ready = { state: 'committed', reading_km: 10, unit: 'km', display_kind: 'total', scanned_at: new Date(), committed_at: new Date() };
    await insert(ready);
    await rejected(ready, '23505');
    await insert({ ...ready, stage: 'end' });
  });
  it.each(['trip_id', 'driver_id', 'vehicle_id'])('rejects missing %s foreign key', async key => { await rejected({ [key]: 999 }, '23503'); });
  it('rejects invalid stages and duplicate object keys', async () => {
    await rejected({ stage: 'other' }, '23514');
    await insert({ storage_key: 'duplicate' });
    await rejected({ storage_key: 'duplicate' }, '23505');
  });
  it.each([
    { state: 'ready' },
    { state: 'ready', reading_km: 10, unit: null, display_kind: 'total', scanned_at: new Date() },
    { state: 'ready', reading_km: 10, unit: 'km', display_kind: null, scanned_at: new Date() },
    { state: 'ready', reading_km: 10, unit: 'mi', display_kind: 'total', scanned_at: new Date() },
    { state: 'committed', reading_km: 10, unit: 'km', display_kind: 'total', scanned_at: new Date() },
    { committed_at: new Date() }, { reading_km: 'NaN' }, { reading_km: 0 },
    { reading_km: 2000001 }, { byte_size: 5242881 }, { byte_size: 0 },
    { scan_attempts: 4 }, { image_sha256: 'invalid' }, { content_type: 'text/plain' },
  ])('rejects incomplete or out-of-bounds evidence %#', async changes => { await rejected(changes, '23514'); });
});

// Separate committed fixture schema permits competing connections. No operating
// table is referenced: every service transaction has this private search_path.
describe.skipIf(!enabled)('odometer service with isolated PostgreSQL retries and concurrency', () => {
  const serviceSchema = `odometer_service_${randomUUID().replaceAll('-', '')}`;
  let fixturePool;
  const session = { user: { driverId: 1 } };
  const bytes = new Uint8Array([255, 216, 255, 10]);
  const file = { size: 4, type: 'image/jpeg', arrayBuffer: async () => bytes.buffer };
  const objects = new Map();
  const run = async fn => {
    const connection = await fixturePool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query(`SET LOCAL search_path TO ${serviceSchema},pg_catalog`);
      await connection.query("SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='3s'");
      const result = await fn({ query: (sql, args) => connection.query(sql, args) });
      await connection.query('COMMIT');
      return result;
    } catch (error) { await connection.query('ROLLBACK'); throw error; }
    finally { connection.release(); }
  };
  const db = (sql, args) => run(tx => tx.query(sql, args));
  const upload = captureId => uploadOdometerCapture({ session, tripId: 1, stage: 'start', captureId, file });
  const makeReady = async captureId => {
    await upload(captureId);
    await db("UPDATE trip_odometer_captures SET state='ready',reading_km=110,reading_text='110',unit='km',display_kind='total',scanned_at=NOW() WHERE capture_id=$1", [captureId]);
  };
  const consume = captureId => run(async tx => {
    const trip = (await tx.query('SELECT * FROM trips WHERE trip_id=1 FOR UPDATE')).rows[0];
    const vehicle = (await tx.query('SELECT * FROM vehicles WHERE vehicle_id=1 FOR UPDATE')).rows[0];
    return consumeOdometerCapture({ tx, trip: { ...trip, vehicle_mileage: vehicle.mileage }, session, stage: 'start', captureId });
  });
  beforeAll(async () => {
    loadEnvLocal();
    fixturePool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 4, connectionTimeoutMillis: 5000 });
    await fixturePool.query(`CREATE SCHEMA ${serviceSchema}`);
    try {
      await run(async tx => {
        await tx.query(`CREATE TABLE trips(trip_id integer PRIMARY KEY,driver_id integer,vehicle_id integer,trip_status text,deleted_at timestamptz,start_odometer numeric,end_odometer numeric,distance numeric,distance_source text);
          CREATE TABLE drivers(driver_id integer PRIMARY KEY);
          CREATE TABLE vehicles(vehicle_id integer PRIMARY KEY,mileage numeric);
          CREATE TABLE buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
          INSERT INTO trips(trip_id,driver_id,vehicle_id,trip_status,start_odometer) VALUES(1,1,1,'Driver Accepted',100);
          INSERT INTO drivers VALUES(1); INSERT INTO vehicles VALUES(1,100);`);
        const sql = readFileSync('supabase/migrations/164_trip_odometer_captures.sql', 'utf8').replaceAll('public.', `${serviceSchema}.`).replaceAll('storage.buckets', `${serviceSchema}.buckets`);
        await tx.query(sql);
      });
    } catch (error) { await fixturePool.query(`DROP SCHEMA ${serviceSchema} CASCADE`); throw error; }
    serviceDeps.transaction.mockImplementation(run);
    serviceDeps.query.mockImplementation(db);
    serviceDeps.upload.mockImplementation(async (key, image) => {
      if (objects.has(key)) return { error: { message: 'exists' } };
      objects.set(key, new Blob([image])); return { data: {} };
    });
    serviceDeps.download.mockImplementation(async key => objects.has(key) ? { data: objects.get(key) } : { error: { message: 'missing' } });
    serviceDeps.sign.mockResolvedValue({ data: { signedUrl: 'https://fixture/one-hour' } });
    serviceDeps.scan.mockResolvedValue({ readingKm: 110, readingText: '110', unit: 'km', displayKind: 'total', failureCode: null, modelName: 'fixture', scanVersion: 'v1' });
  }, 20000);
  afterAll(async () => {
    try { if (fixturePool) await fixturePool.query(`DROP SCHEMA IF EXISTS ${serviceSchema} CASCADE`); }
    finally { await fixturePool?.end(); }
  }, 15000);
  it('serializes simultaneous same-ID uploads and rejects changed-image retry', async () => {
    const captureId = randomUUID();
    const results = await Promise.all([upload(captureId), upload(captureId)]);
    expect(results.map(result => result.capture_id)).toEqual([captureId, captureId]);
    expect((await db('SELECT COUNT(*)::integer AS count FROM trip_odometer_captures WHERE capture_id=$1', [captureId])).rows[0].count).toBe(1);
    const other = new Uint8Array([255,216,255,11]);
    await expect(uploadOdometerCapture({ session, tripId: 1, stage: 'start', captureId, file: { ...file, arrayBuffer: async () => other.buffer } })).rejects.toMatchObject({ code: 'ODOMETER_CAPTURE_MISMATCH' });
    expect((await db('SELECT image_sha256 FROM trip_odometer_captures WHERE capture_id=$1', [captureId])).rows[0].image_sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  }, 15000);
  it('allows one scan request while a real database lease is held', async () => {
    const captureId = randomUUID(); await upload(captureId);
    let release, entered;
    const waiting = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    serviceDeps.scan.mockImplementationOnce(async () => { entered(); await waiting; return { readingKm: 110, readingText: '110', unit: 'km', displayKind: 'total', failureCode: null }; });
    const first = scanOdometerCapture({ session, tripId: 1, captureId });
    try {
      await started;
      expect((await scanOdometerCapture({ session, tripId: 1, captureId })).state).toBe('scanning');
    } finally { release(); }
    const result = await first;
    const lease = (await db('SELECT scan_started_at,scan_started_at::text AS precise FROM trip_odometer_captures WHERE capture_id=$1', [captureId])).rows[0];
    expect((await db('SELECT scan_started_at=$2::timestamptz AS exact FROM trip_odometer_captures WHERE capture_id=$1', [captureId, lease.scan_started_at])).rows[0], lease.precise).toEqual({ exact: true });
    expect(result.state).toBe('ready');
    expect((await db('SELECT scan_attempts FROM trip_odometer_captures WHERE capture_id=$1', [captureId])).rows[0].scan_attempts).toBe(1);
  }, 15000);
  it('reclaims expired leases and enforces the three-attempt maximum', async () => {
    const captureId = randomUUID(); await upload(captureId);
    await db("UPDATE trip_odometer_captures SET state='scanning',scan_attempts=2,scan_started_at=NOW()-INTERVAL '31 seconds' WHERE capture_id=$1", [captureId]);
    expect((await scanOdometerCapture({ session, tripId: 1, captureId })).state).toBe('ready');
    await db("UPDATE trip_odometer_captures SET state='failed' WHERE capture_id=$1", [captureId]);
    await expect(scanOdometerCapture({ session, tripId: 1, captureId })).rejects.toMatchObject({ code: 'ODOMETER_RETAKE_REQUIRED' });
    expect((await db('SELECT scan_attempts FROM trip_odometer_captures WHERE capture_id=$1', [captureId])).rows[0].scan_attempts).toBe(3);
  }, 15000);
  it('rejects a photo older than thirty minutes without committing it', async () => {
    const captureId = randomUUID(); await makeReady(captureId);
    await db("UPDATE trip_odometer_captures SET uploaded_at=NOW()-INTERVAL '31 minutes' WHERE capture_id=$1", [captureId]);
    await expect(consume(captureId)).rejects.toMatchObject({ code: 'ODOMETER_CAPTURE_EXPIRED' });
    expect((await db('SELECT committed_at FROM trip_odometer_captures WHERE capture_id=$1', [captureId])).rows[0].committed_at).toBeNull();
  }, 15000);
  it('never lets a superseded scan overwrite the newer lease result', async () => {
    const captureId = randomUUID(); await upload(captureId);
    let release, entered;
    const waiting = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    serviceDeps.scan.mockImplementationOnce(async () => { entered(); await waiting; return { readingKm: 999, readingText: '999', unit: 'km', displayKind: 'total', failureCode: null }; });
    const first = scanOdometerCapture({ session, tripId: 1, captureId });
    try {
      await started;
      await db("UPDATE trip_odometer_captures SET scan_started_at=NOW()-INTERVAL '31 seconds' WHERE capture_id=$1", [captureId]);
      expect((await scanOdometerCapture({ session, tripId: 1, captureId })).reading_km).toBe(110);
    } finally { release(); }
    expect((await first).reading_km).toBe(110);
    expect((await db('SELECT reading_km,scan_attempts FROM trip_odometer_captures WHERE capture_id=$1', [captureId])).rows[0]).toEqual({ reading_km: '110.00', scan_attempts: 2 });
  }, 15000);
  it('rolls consumption back with a later trip transaction failure', async () => {
    const captureId = randomUUID(); await makeReady(captureId);
    await expect(run(async tx => {
      const trip = (await tx.query('SELECT * FROM trips WHERE trip_id=1 FOR UPDATE')).rows[0];
      const vehicle = (await tx.query('SELECT * FROM vehicles WHERE vehicle_id=1 FOR UPDATE')).rows[0];
      await consumeOdometerCapture({ tx, trip: { ...trip, vehicle_mileage: vehicle.mileage }, session, stage: 'start', captureId });
      throw new Error('Later trip update rejected');
    })).rejects.toThrow('Later trip update rejected');
    expect((await db('SELECT state,committed_at FROM trip_odometer_captures WHERE capture_id=$1', [captureId])).rows[0]).toEqual({ state: 'ready', committed_at: null });
  }, 15000);
  it('serializes competing commits and replays the exact winner after age/mileage changes', async () => {
    const ids = [randomUUID(), randomUUID()]; await makeReady(ids[0]); await makeReady(ids[1]);
    const results = await Promise.allSettled(ids.map(consume));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const winner = results.find(result => result.status === 'fulfilled').value.captureId;
    const loser = ids.find(id => id !== winner);
    expect(results.find(result => result.status === 'rejected').reason.code).toBe('ODOMETER_CAPTURE_MISMATCH');
    await db("UPDATE trip_odometer_captures SET uploaded_at=NOW()-INTERVAL '2 hours' WHERE capture_id=$1", [winner]);
    await db('UPDATE vehicles SET mileage=999 WHERE vehicle_id=1');
    await expect(consume(winner)).resolves.toEqual({ captureId: winner, readingKm: 110 });
    await expect(consume(loser)).rejects.toMatchObject({ code: 'ODOMETER_CAPTURE_MISMATCH' });
    expect((await db('SELECT COUNT(*)::integer AS count FROM trip_odometer_captures WHERE committed_at IS NOT NULL')).rows[0].count).toBe(1);
  }, 15000);
});
