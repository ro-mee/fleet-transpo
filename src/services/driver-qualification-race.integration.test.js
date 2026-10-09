import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { loadEnvLocal } from '../../scripts/load-env.mjs';
const routing = vi.hoisted(() => ({ storage: null, schema: null, pids: {}, parentGate: null }));
vi.mock('@/lib/db', async original => ({
  ...await original(),
  query: (sql, values) => routing.storage.getStore().client.query(sql, values),
  withTransaction: async write => {
    const { client, outer, label } = routing.storage.getStore();
    await client.query(outer ? 'SAVEPOINT boundary_write' : 'BEGIN');
    await client.query(`SET LOCAL search_path=${routing.schema},pg_catalog`);
    await client.query(`SET LOCAL application_name='${routing.schema}_${label}'`);
    await client.query('SET LOCAL statement_timeout=15000');
    routing.pids[label] = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    try {
      const tx = { query: async (sql, values) => {
        const result = await client.query(sql, values);
        if (label === 'dispatch' && routing.parentGate && sql.startsWith('SELECT driver_id FROM drivers')) {
          const gate = routing.parentGate; routing.parentGate = null;
          gate.entered(); await gate.release;
        }
        return result;
      } };
      const result = await write(tx);
      await client.query(outer ? 'RELEASE SAVEPOINT boundary_write' : 'COMMIT');
      return result;
    } catch (error) {
      await client.query(outer ? 'ROLLBACK TO SAVEPOINT boundary_write' : 'ROLLBACK');
      throw error;
    }
  },
}));
import { getPool } from '@/lib/db';
import { setDriverQualification } from './driver-qualification.service';
import { commitDispatchEvidence, readDispatchRevision } from './dispatch-evidence.service';

describe.skipIf(process.env.FLEETOPS_REVIEW_DB_TEST !== '1')('two PostgreSQL sessions serialize qualification review and dispatch', () => {
  let pool, dispatch, reviewer, schema;
  const run = (client, write, outer = false) => routing.storage.run({ client, outer, label: client === dispatch ? 'dispatch' : 'reviewer' }, write);
  const review = status => setDriverQualification({ driverId: 7, group: 'CARGO', status,
    policyVersion: 'fixture-v1', reason: 'Isolated concurrency fixture' }, { user: { employeeId: 8, role: 'admin' } });
  const token = async () => {
    const identity = { driverId: 7, vehicleId: 2, requestId: 3 };
    await dispatch.query('BEGIN');
    await dispatch.query(`SET LOCAL search_path=${schema},pg_catalog`);
    const revision = await run(dispatch, () => readDispatchRevision(identity));
    await dispatch.query('COMMIT');
    return { ...identity, revision, expiresAt: new Date(Date.now() + 60000).toISOString() };
  };
  beforeAll(async () => {
    loadEnvLocal(['.env.local', '.env']);
    routing.storage = new AsyncLocalStorage();
    vi.stubEnv('DRIVER_QUALIFICATION_MODE', 'ENFORCE');
    vi.stubEnv('DRIVER_QUALIFICATION_POLICY_VERSION', 'fixture-v1');
    vi.stubEnv('DRIVER_QUALIFICATION_ROSTER_REVIEW', 'fixture-review');
    vi.stubEnv('DRIVER_QUALIFICATION_EXISTING_TRIPS', 'RECHECK');
    pool = getPool(); dispatch = await pool.connect(); reviewer = await pool.connect();
    schema = `qualification_race_${randomUUID().replaceAll('-', '')}`;
    routing.schema = schema;
    await dispatch.query('BEGIN');
    await dispatch.query(`CREATE SCHEMA ${schema}`);
    const { rows } = await dispatch.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    for (const { tablename } of rows) {
      if (!/^[a-z_][a-z0-9_]*$/.test(tablename)) throw new Error('Invalid fixture table name');
      await dispatch.query(`CREATE TABLE ${schema}."${tablename}" (LIKE public."${tablename}" INCLUDING CONSTRAINTS)`);
    }
    await dispatch.query(`SET LOCAL search_path=${schema},pg_catalog`);
    await dispatch.query(`CREATE UNIQUE INDEX fixture_qualification_pair ON driver_service_qualifications(driver_id,qualification_group);
      ALTER TABLE driver_service_qualifications ALTER COLUMN qualification_id SET DEFAULT gen_random_uuid();
      ALTER TABLE driver_service_qualifications ALTER COLUMN version SET DEFAULT 1;
      ALTER TABLE driver_service_qualifications ALTER COLUMN created_at SET DEFAULT NOW();
      ALTER TABLE driver_service_qualifications ALTER COLUMN updated_at SET DEFAULT NOW();
      ALTER TABLE driver_service_qualification_events ALTER COLUMN event_id SET DEFAULT gen_random_uuid();
      ALTER TABLE driver_service_qualification_events ALTER COLUMN occurred_at SET DEFAULT NOW();
      CREATE SEQUENCE fixture_audit_seq;
      ALTER TABLE audit_logs ALTER COLUMN log_id SET DEFAULT nextval('fixture_audit_seq');
      CREATE UNIQUE INDEX fixture_audit_event ON audit_logs(event_key) WHERE event_key IS NOT NULL;
      CREATE TABLE race_commits(id integer);
      INSERT INTO employees(employee_id,first_name,last_name,email,status,auth_version,must_change_password) VALUES(8,'Fixture','Driver','fixture@example.invalid','Active',1,false);
      INSERT INTO drivers(driver_id,employee_id,license_number,license_type,license_class,license_expiry,driver_status,standby_tracking_enabled) VALUES(7,8,'N04-19-013583','Professional','B','2099-01-01','Available',false);
      INSERT INTO service_types(service_type_id,service_name,service_code,default_load_type,status) VALUES(1,'Fixture cargo','HOTEL_SUPPLY_TRANSFER','Cargo','Active');
      INSERT INTO transportation_requests(request_id,source_system,pickup_location,dropoff_location,pickup_datetime,priority,fleet_status,is_vip,is_emergency,service_type_id,load_type,cargo_weight_kg,cargo_description)
      VALUES(3,'POS','Fixture pickup','Fixture dropoff',NOW(),'Low','Pending',false,false,1,'Cargo',100,'Fixture cargo')`);
    await dispatch.query('COMMIT');
    await run(reviewer, () => review('ACTIVE'));
  }, 60000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    for (const client of [dispatch, reviewer]) if (client) { await client.query('ROLLBACK'); await client.query('RESET search_path'); }
    if (dispatch && schema) await dispatch.query(`DROP SCHEMA ${schema} CASCADE`);
    dispatch?.release(); reviewer?.release();
    if (pool) { await pool.end(); delete globalThis.postgresPool; }
  });
  it('rejects a preview after a concurrent revocation commits, without invoking its write', async () => {
    const preview = await token();
    await reviewer.query('BEGIN');
    await run(reviewer, () => review('REVOKED'), true);
    let wrote = false;
    routing.pids.dispatch = null;
    const pending = run(dispatch, () => commitDispatchEvidence(preview, async tx => {
      wrote = true; return tx.query('INSERT INTO race_commits VALUES(1)');
    })).then(() => null, error => error);
    let waiting = false;
    for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
      if (!routing.pids.dispatch) { await new Promise(resolve=>setTimeout(resolve,20)); continue; }
      waiting = (await reviewer.query('SELECT cardinality(pg_blocking_pids($1))>0 AS waiting', [routing.pids.dispatch])).rows[0].waiting;
    }
    await reviewer.query('COMMIT');
    expect(waiting).toBe(true);
    expect(await pending).toMatchObject({ code: 'STALE_DISPATCH_EVIDENCE' });
    expect(wrote).toBe(false);
  }, 30000);
  it('holds approval through the final dispatch write and lets revocation proceed after commit', async () => {
    await run(reviewer, () => review('ACTIVE'));
    const preview = await token();
    let entered, release;
    const writing = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const assigned = run(dispatch, () => commitDispatchEvidence(preview, async tx => {
      entered(); await gate; return tx.query('INSERT INTO race_commits VALUES(2)');
    }));
    await writing;
    routing.pids.reviewer = null;
    const revoked = run(reviewer, () => review('REVOKED')).then(value => ({ value }), error => ({ error }));
    let waiting = false;
    try {
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        if (!routing.pids.reviewer) { await new Promise(resolve=>setTimeout(resolve,20)); continue; }
        waiting = (await dispatch.query('SELECT cardinality(pg_blocking_pids($1))>0 AS waiting', [routing.pids.reviewer])).rows[0].waiting;
      }
      expect(waiting).toBe(true);
    } finally { release(); }
    await assigned; expect((await revoked).error).toBeUndefined();
    expect((await dispatch.query(`SELECT * FROM ${schema}.race_commits`)).rows).toEqual([{ id: 2 }]);
    expect((await dispatch.query(`SELECT status FROM ${schema}.driver_service_qualifications`)).rows[0].status).toBe('REVOKED');
  }, 30000);
  it('serializes an ordinary driver UPDATE without a table-row upgrade deadlock', async () => {
    await run(reviewer, () => review('ACTIVE'));
    const preview = await token();
    let entered, release;
    const parentLocked = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    routing.parentGate = { entered, release: gate };
    const assigned = run(dispatch, () => commitDispatchEvidence(preview, tx => tx.query('INSERT INTO race_commits VALUES(3)')))
      .then(() => null, error => error);
    await parentLocked;
    await reviewer.query('BEGIN');
    await reviewer.query(`SET LOCAL search_path=${schema},pg_catalog`);
    await reviewer.query('SET LOCAL statement_timeout=15000');
    const pid = (await reviewer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const updated = reviewer.query("UPDATE drivers SET driver_status='On Trip' WHERE driver_id=7")
      .then(async () => { await reviewer.query('COMMIT'); return null; }, async error => { await reviewer.query('ROLLBACK'); return error; });
    let waiting = false;
    try {
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        waiting = (await dispatch.query('SELECT cardinality(pg_blocking_pids($1))>0 AS waiting', [pid])).rows[0].waiting;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
    } finally { release(); }
    const results = await Promise.all([assigned, updated]);
    expect(results.map(error => error?.code ?? null)).toEqual([null, null]);
    expect((await dispatch.query(`SELECT driver_status FROM ${schema}.drivers WHERE driver_id=7`)).rows[0].driver_status).toBe('On Trip');
    expect((await dispatch.query(`SELECT id FROM ${schema}.race_commits WHERE id=3`)).rows).toEqual([{ id: 3 }]);
  }, 30000);
});
