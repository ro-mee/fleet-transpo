import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { loadEnvLocal } from '../../scripts/load-env.mjs';
const fixture = vi.hoisted(() => ({ storage: null, schema: null }));
vi.mock('@/lib/db', () => ({
  query: async (...args) => {
    const client = fixture.storage.getStore();
    await client.query('BEGIN');
    try { await client.query(`SET LOCAL search_path TO "${fixture.schema}",pg_catalog`); return await client.query(...args); }
    finally { await client.query('ROLLBACK'); }
  },
  withTransaction: async work => {
    const client = fixture.storage.getStore();
    await client.query('BEGIN');
    try { await client.query(`SET LOCAL search_path TO "${fixture.schema}",pg_catalog`); await client.query("SET LOCAL statement_timeout='12s'; SET LOCAL lock_timeout='8s'"); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
  },
}));
import { commitDispatchEvidence, readDispatchRevision } from './dispatch-evidence.service';
import { readPlanRevision } from './dispatch-plan-evidence.service';

describe.skipIf(process.env.FLEETOPS_REVIEW_DB_TEST !== '1')('cargo evidence in two isolated PostgreSQL sessions', () => {
  const schema = `cargo_evidence_${randomUUID().replaceAll('-', '')}`;
  let pool, dispatch, writer, observer;
  const run = work => fixture.storage.run(dispatch, work);
  const token = async (requestId = null) => ({ driverId: 1, vehicleId: 7, requestId,
    revision: await run(() => readDispatchRevision({ driverId: 1, vehicleId: 7, requestId })),
    expiresAt: new Date(Date.now() + 60000).toISOString() });
  beforeAll(async () => {
    vi.stubEnv('DRIVER_QUALIFICATION_MODE', 'OFF');
    loadEnvLocal();
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3, connectionTimeoutMillis: 5000 });
    [dispatch, writer, observer] = await Promise.all([pool.connect(), pool.connect(), pool.connect()]);
    fixture.storage = new AsyncLocalStorage();
    fixture.schema = schema;
    await observer.query(`CREATE SCHEMA "${schema}"`);
    const { rows } = await observer.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    for (const { tablename } of rows) {
      if (!/^[a-z_][a-z0-9_]*$/.test(tablename)) throw new Error('Unsupported fixture table name.');
      // No copied defaults/triggers/FKs: explicit IDs never advance live sequences.
      await observer.query(`CREATE TABLE "${schema}"."${tablename}" (LIKE public."${tablename}" INCLUDING CONSTRAINTS)`);
    }
    await observer.query(`INSERT INTO "${schema}".vehicle_cargo_profiles(vehicle_id,supports_supply_delivery,handling_capabilities,updated_at,rated_payload_kg) VALUES(7,false,'{}',now(),1000)`);
  }, 60000);
  afterAll(async () => {
    for (const client of [dispatch, writer]) if (client) await client.query('ROLLBACK');
    if (observer && /^cargo_evidence_[a-f0-9]+$/.test(schema)) await observer.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    for (const client of [dispatch, writer, observer]) client?.release();
    await pool?.end(); vi.unstubAllEnvs();
  }, 30000);

  it('rejects a profile changed after preview before invoking the write', async () => {
    const before = await token();
    await writer.query(`UPDATE "${schema}".vehicle_cargo_profiles SET rated_payload_kg=900 WHERE vehicle_id=7`);
    const write = vi.fn();
    await expect(run(() => commitDispatchEvidence(before, write))).rejects.toMatchObject({ code: 'STALE_DISPATCH_EVIDENCE' });
    expect(write).not.toHaveBeenCalled();
  });

  it('invalidates pair and whole-queue evidence when a new source manifest appears', async () => {
    const before = await token(11), planBefore = await run(() => readPlanRevision());
    const snapshot = { source_ref: { system: 'PMS', organization_id: 'simulated:fixture', external_request_id: 'r11' }, service_code: 'HOTEL_SUPPLY_TRANSFER', lines: [{ line_id: 'oil' }] };
    await writer.query(`INSERT INTO "${schema}".request_cargo_manifest_revisions(request_cargo_manifest_revision_id,request_id,revision,manifest_hash,source_system,source_organization_id,source_external_request_id,source_event_id,manifest_snapshot,created_at)
      VALUES($1,11,1,$2,'PMS','simulated:fixture','r11','simulated:event',$3,now())`, [randomUUID(), 'a'.repeat(64), snapshot]);
    const write = vi.fn();
    await expect(run(() => commitDispatchEvidence(before, write))).rejects.toMatchObject({ code: 'STALE_DISPATCH_EVIDENCE' });
    expect(write).not.toHaveBeenCalled();
    expect(await run(() => readPlanRevision())).not.toBe(planBefore);
  });

  it('serializes the profile writer behind the final dispatch transaction', async () => {
    const before = await token();
    let dispatchPid;
    let entered, release;
    const enteredPromise = new Promise(resolve => { entered = resolve; });
    const releasePromise = new Promise(resolve => { release = resolve; });
    const commit = run(() => commitDispatchEvidence(before, async tx => {
      dispatchPid = (await tx.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      entered(); await releasePromise;
      return (await tx.query('SELECT rated_payload_kg FROM vehicle_cargo_profiles WHERE vehicle_id=7')).rows[0].rated_payload_kg;
    }));
    await enteredPromise;
    await writer.query('BEGIN');
    await writer.query(`SET LOCAL search_path TO "${schema}",pg_catalog`);
    await writer.query("SET LOCAL statement_timeout='12s'; SET LOCAL lock_timeout='8s'");
    const writerPid = (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    expect(dispatchPid).not.toBe(writerPid);
    let mutated = false;
    const update = (async () => {
      try {
        await writer.query('LOCK TABLE vehicles,vehicle_cargo_profiles IN SHARE ROW EXCLUSIVE MODE');
        await writer.query('UPDATE vehicle_cargo_profiles SET rated_payload_kg=800 WHERE vehicle_id=7');
        mutated = true; await writer.query('COMMIT');
      } catch (error) { await writer.query('ROLLBACK'); throw error; }
    })();
    try {
      let waiting = false;
      const deadline = Date.now() + 5000;
      while (!waiting && Date.now() < deadline) {
        waiting = (await observer.query('SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted) AS waiting', [writerPid])).rows[0].waiting;
      }
      expect(waiting).toBe(true); expect(mutated).toBe(false);
    } finally { release(); }
    expect(Number(await commit)).toBe(900);
    await update; expect(mutated).toBe(true);
  }, 20000);
});
