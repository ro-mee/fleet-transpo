import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadEnvLocal } from '../../scripts/load-env.mjs';

const connection = vi.hoisted(() => ({ client: null }));
vi.mock('@/lib/db', async original => ({
  ...await original(),
  query: (sql, values) => connection.client.query(sql, values),
  withTransaction: async fn => {
    await connection.client.query('SAVEPOINT qualification_write');
    try {
      const result = await fn(connection.client);
      await connection.client.query('RELEASE SAVEPOINT qualification_write');
      return result;
    } catch (error) {
      await connection.client.query('ROLLBACK TO SAVEPOINT qualification_write');
      throw error;
    }
  },
}));
import { getPool } from '@/lib/db';
import { loadDriverQualifications, setDriverQualification } from './driver-qualification.service';

describe.skipIf(process.env.FLEETOPS_REVIEW_DB_TEST !== '1')('qualification SQL in isolated PostgreSQL schema', () => {
  let pool;
  const session = { user: { employeeId: 21, role: 'super_admin' } };
  const input = { driverId: 7, group: 'CARGO', status: 'ACTIVE', policyVersion: 'review-v1', reason: 'Explicit reviewed test approval' };
  beforeAll(async () => {
    loadEnvLocal(['.env.local', '.env']);
    pool = getPool();
    connection.client = await pool.connect();
    await connection.client.query('BEGIN');
    await connection.client.query('CREATE SCHEMA qualification_review_fixture');
    await connection.client.query('SET LOCAL search_path = qualification_review_fixture, pg_catalog');
    await connection.client.query(`CREATE TABLE employees(employee_id integer PRIMARY KEY);
      CREATE TABLE drivers(driver_id integer PRIMARY KEY, deleted_at timestamptz);
      INSERT INTO employees VALUES(21); INSERT INTO drivers(driver_id) VALUES(7);
      CREATE TABLE audit_logs(log_id integer GENERATED ALWAYS AS IDENTITY, employee_id integer, action text, resource text, resource_id integer, old_values jsonb, new_values jsonb, ip_address text, user_agent text, event_key uuid);
      CREATE UNIQUE INDEX audit_event_unique ON audit_logs(event_key) WHERE event_key IS NOT NULL`);
    const migration = readFileSync('supabase/migrations/156_driver_service_qualifications.sql', 'utf8');
    await connection.client.query(migration);
    await connection.client.query(migration);
  }, 60000);
  beforeEach(async () => {
    vi.stubEnv('DRIVER_QUALIFICATION_POLICY_VERSION', 'review-v1');
    await connection.client.query('SAVEPOINT qualification_case');
  });
  afterEach(async () => { await connection.client.query('ROLLBACK TO SAVEPOINT qualification_case'); });
  afterAll(async () => {
    vi.unstubAllEnvs();
    if (connection.client) { await connection.client.query('ROLLBACK'); connection.client.release(); connection.client = null; }
    if (pool) { await pool.end(); delete globalThis.postgresPool; }
  });
  it('starts empty; approval and suspension append history and audit without qualifying the other group', async () => {
    expect((await loadDriverQualifications([7])).get(7)).toEqual([]);
    const approved = await setDriverQualification(input, session);
    expect(approved).toMatchObject({ group: 'CARGO', status: 'ACTIVE', verified_by: 21, policy_version: 'review-v1', version: 1 });
    expect(approved.verified_at).toBeTruthy();
    const suspended = await setDriverQualification({ ...input, status: 'SUSPENDED' }, session);
    expect(suspended.version).toBe(2);
    const records = await loadDriverQualifications([7, 7]);
    expect(records.get(7)).toHaveLength(1);
    expect(records.get(7)[0].status).toBe('SUSPENDED');
    expect((await connection.client.query('SELECT old_status,new_status,actor_id FROM driver_service_qualification_events ORDER BY version')).rows).toEqual([
      { old_status: null, new_status: 'ACTIVE', actor_id: 21 }, { old_status: 'ACTIVE', new_status: 'SUSPENDED', actor_id: 21 },
    ]);
    expect((await connection.client.query('SELECT count(*)::int AS n FROM audit_logs')).rows[0].n).toBe(2);
  });
  it('requires configured policy and authenticated authority before writing', async () => {
    vi.stubEnv('DRIVER_QUALIFICATION_POLICY_VERSION', '');
    await expect(setDriverQualification(input, session)).rejects.toMatchObject({ status: 503 });
    vi.stubEnv('DRIVER_QUALIFICATION_POLICY_VERSION', 'different');
    await expect(setDriverQualification(input, session)).rejects.toMatchObject({ status: 503 });
    await expect(setDriverQualification(input, { user: { employeeId: 21, role: 'driver' } })).rejects.toMatchObject({ status: 403 });
    await expect(setDriverQualification(input, { user: { role: 'super_admin' } })).rejects.toMatchObject({ status: 403 });
  });
  it('rejects a stale edit instead of overwriting a newer review', async () => {
    await setDriverQualification({ ...input, expectedVersion: 0 }, session);
    await setDriverQualification({ ...input, status: 'SUSPENDED', expectedVersion: 1 }, session);
    await expect(setDriverQualification({ ...input, expectedVersion: 1 }, session)).rejects.toMatchObject({ status: 409, code: 'QUALIFICATION_STALE' });
    expect((await loadDriverQualifications([7])).get(7)[0]).toMatchObject({ status: 'SUSPENDED', version: 2 });
    expect((await connection.client.query('SELECT count(*)::int AS n FROM driver_service_qualification_events')).rows[0].n).toBe(2);
  });
  it('cannot load or review a soft-deleted driver', async () => {
    await setDriverQualification(input, session);
    await connection.client.query('UPDATE drivers SET deleted_at=NOW() WHERE driver_id=7');
    try {
      expect((await loadDriverQualifications([7])).get(7)).toEqual([]);
      await expect(setDriverQualification(input, session)).rejects.toMatchObject({ status: 404 });
    } finally { await connection.client.query('UPDATE drivers SET deleted_at=NULL WHERE driver_id=7'); }
  });
  it('rolls back approval and history when required audit fails', async () => {
    await setDriverQualification(input, session);
    await connection.client.query("ALTER TABLE audit_logs ADD CONSTRAINT reject_review_audit CHECK(action <> 'qualification_update') NOT VALID");
    await expect(setDriverQualification({ ...input, group: 'PASSENGER' }, session)).rejects.toThrow();
    expect((await connection.client.query("SELECT count(*)::int AS n FROM driver_service_qualifications WHERE qualification_group='PASSENGER'")).rows[0].n).toBe(0);
    expect((await connection.client.query('SELECT count(*)::int AS n FROM driver_service_qualification_events')).rows[0].n).toBe(1);
    await connection.client.query('ALTER TABLE audit_logs DROP CONSTRAINT reject_review_audit');
  });
  it.each([
    "status='ACTIVE',verified_by=NULL", "status='ACTIVE',verified_at=NULL", "status='ACTIVE',policy_version=' '",
    "qualification_group='HOTEL'", "status='DRAFT'", 'version=0',
  ])('database rejects invalid record %s', async changes => {
    await setDriverQualification(input, session);
    await connection.client.query('SAVEPOINT invalid_record');
    try { await expect(connection.client.query(`UPDATE driver_service_qualifications SET ${changes}`)).rejects.toThrow(); }
    finally { await connection.client.query('ROLLBACK TO SAVEPOINT invalid_record'); }
  });
  it('protects append-only history even from application-role updates and deletes', async () => {
    await setDriverQualification(input, session);
    for (const sql of ['UPDATE driver_service_qualification_events SET reason=\'changed\'', 'DELETE FROM driver_service_qualification_events', 'TRUNCATE driver_service_qualification_events']) {
      await connection.client.query('SAVEPOINT invalid_history');
      try { await expect(connection.client.query(sql)).rejects.toThrow(); }
      finally { await connection.client.query('ROLLBACK TO SAVEPOINT invalid_history'); }
    }
  });
  it('enables RLS and denies all anon/authenticated privileges', async () => {
    const { rows } = await connection.client.query("SELECT relname,relrowsecurity FROM pg_class WHERE relnamespace='qualification_review_fixture'::regnamespace AND relname IN('driver_service_qualifications','driver_service_qualification_events') ORDER BY relname");
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.relrowsecurity)).toBe(true);
    for (const role of ['anon', 'authenticated']) for (const table of rows) for (const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) {
      const result = await connection.client.query('SELECT has_table_privilege($1,$2,$3) AS granted', [role, `qualification_review_fixture.${table.relname}`, privilege]);
      expect(result.rows[0].granted).toBe(false);
    }
  });
});
