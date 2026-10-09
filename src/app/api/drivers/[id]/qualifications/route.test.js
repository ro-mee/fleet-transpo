import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rolesFor } from '@/lib/auth/permissions';

const state = vi.hoisted(() => ({ role: 'admin', actor: 17 }));
vi.mock('@/lib/api/utils', () => {
  class AuthError extends Error {
    constructor(message, status, code) { super(message); this.status = status; this.code = code; }
  }
  return {
    AuthError,
    requirePermission: async (_req, resource, action) => {
      const { rolesFor } = await import('@/lib/auth/permissions');
      if (!rolesFor(resource, action).includes(state.role)) throw new AuthError('Forbidden', 403, 'FORBIDDEN');
      return { user: { role: state.role, employeeId: state.actor } };
    },
    parseBody: req => req.json(),
    ok: data => Response.json(data),
    handleError: error => Response.json({ error: error.message, code: error.code }, { status: error.status || 500 }),
  };
});
vi.mock('@/lib/db', () => ({ query: vi.fn() }));
vi.mock('@/services/driver-qualification.service', () => ({ setDriverQualification: vi.fn() }));
import { query } from '@/lib/db';
import { setDriverQualification } from '@/services/driver-qualification.service';
import { GET, PUT } from './route';

const context = { params: Promise.resolve({ id: '87' }) };
const payload = { group: 'CARGO', status: 'ACTIVE', policy_version: 'reviewed-v1', reason: 'Reviewed training.', expected_version: 0 };
const request = body => new Request('http://localhost/api/drivers/87/qualifications', { method: 'PUT', body: JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  state.role = 'admin';
  query.mockResolvedValue({ rows: [{ qualifications: [], history: [] }] });
  setDriverQualification.mockResolvedValue({ group: 'CARGO', status: 'ACTIVE', version: 1 });
});

describe('driver qualification permissions', () => {
  it.each(['driver', 'dispatcher', 'fleet_manager', 'management', 'mechanic'])('%s cannot approve', async role => {
    state.role = role;
    expect((await PUT(request(payload), context)).status).toBe(403);
    expect(setDriverQualification).not.toHaveBeenCalled();
  });
  it('uses a dedicated conservative manage grant', () => {
    expect(rolesFor('driver_qualifications', 'manage')).toEqual(['super_admin', 'admin']);
  });
  it.each(['admin', 'super_admin', 'fleet_manager', 'dispatcher', 'management'])('%s may read both groups and history', async role => {
    state.role = role;
    const res = await GET(new Request('http://localhost'), context);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.groups.map(row => [row.group, row.status])).toEqual([['PASSENGER', 'NOT_APPROVED'], ['CARGO', 'NOT_APPROVED']]);
    expect(data.history).toEqual([]);
    expect(data.can_manage).toBe(['admin', 'super_admin'].includes(role));
  });
  it.each(['driver', 'mechanic'])('%s cannot inspect other driver reviews', async role => {
    state.role = role;
    expect((await GET(new Request('http://localhost'), context)).status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('qualification route boundary', () => {
  it.each([{ group: 'HOTEL' }, { expected_version: undefined }, { expected_version: -1 }, { reason: ' ' }, { verified_by: 99 }, { verified_at: '2026-10-09' }, { status: 'PENDING' }])('rejects invalid or spoofed input %j', async override => {
    expect((await PUT(request({ ...payload, ...override }), context)).status).toBe(400);
    expect(setDriverQualification).not.toHaveBeenCalled();
  });
  it('takes the reviewer from the authenticated session and passes the expected version', async () => {
    const res = await PUT(request(payload), context);
    expect(res.status).toBe(200);
    expect(setDriverQualification).toHaveBeenCalledWith({ driverId: 87, group: 'CARGO', status: 'ACTIVE', policyVersion: 'reviewed-v1', reason: 'Reviewed training.', expectedVersion: 0 }, { user: { role: 'admin', employeeId: 17 } });
    expect((await res.json()).data.version).toBe(1);
  });
  it.each([[409, 'QUALIFICATION_STALE'], [404, 'QUALIFICATION_DRIVER_NOT_FOUND'], [503, 'QUALIFICATION_POLICY_DISABLED']])('preserves expected service refusal %s', async (status, code) => {
    setDriverQualification.mockRejectedValueOnce(Object.assign(new Error('Review refused.'), { status, code }));
    const res = await PUT(request(payload), context);
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
  });
  it('returns 404 for missing or archived drivers', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect((await GET(new Request('http://localhost'), context)).status).toBe(404);
  });
  it('refuses a missing driver before attempting any policy-dependent write', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = await PUT(request(payload), context);
    expect(res.status).toBe(404);
    expect(setDriverQualification).not.toHaveBeenCalled();
  });
  it.each(['0', '-1', '87junk', '2147483648'])('rejects malformed driver id %s', async id => {
    expect((await GET(new Request('http://localhost'), { params: Promise.resolve({ id }) })).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
  it('returns stored reviews and actor history without replacing them with placeholders', async () => {
    query.mockResolvedValueOnce({ rows: [{ qualifications: [{ group: 'CARGO', status: 'REVOKED', version: 4 }], history: [{ event_id: 1, actor_name: 'Reviewer', new_group: 'CARGO' }] }] });
    const { data } = await (await GET(new Request('http://localhost'), context)).json();
    expect(data.groups[1]).toEqual({ group: 'CARGO', status: 'REVOKED', version: 4 });
    expect(data.history[0].actor_name).toBe('Reviewer');
  });
});

it.skipIf(process.env.FLEETOPS_REVIEW_DB_TEST !== '1')('reads reviews and history with the real PostgreSQL join columns in a rollback-only fixture', async () => {
  const { loadEnvLocal } = await import('../../../../../../scripts/load-env.mjs');
  const { readFileSync } = await import('node:fs');
  const { default: pg } = await import('pg');
  loadEnvLocal();
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query('CREATE SCHEMA qualification_profile_fixture');
    await client.query('SET LOCAL search_path = qualification_profile_fixture, pg_catalog');
    await client.query(`CREATE TABLE employees(employee_id integer PRIMARY KEY, first_name text, last_name text, status text);
      CREATE TABLE drivers(driver_id integer PRIMARY KEY, deleted_at timestamptz);
      INSERT INTO employees VALUES(17,'Alex','Reviewer','Active');
      INSERT INTO drivers VALUES(87,NULL),(88,NOW())`);
    await client.query(readFileSync('supabase/migrations/156_driver_service_qualifications.sql', 'utf8'));
    await client.query(`WITH q AS (
      INSERT INTO driver_service_qualifications(driver_id,qualification_group,status,policy_version,verified_by,verified_at,reason)
      VALUES(87,'CARGO','ACTIVE','fixture-policy',17,NOW(),'Fixture training reviewed') RETURNING qualification_id
    ) INSERT INTO driver_service_qualification_events(qualification_id,driver_id,actor_id,new_group,new_status,reason,policy_version,version)
      SELECT qualification_id,87,17,'CARGO','ACTIVE','Fixture training reviewed','fixture-policy',1 FROM q`);
    query.mockImplementation((sql, values) => client.query(sql, values));
    const response = await GET(new Request('http://localhost'), context);
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.groups.map(row => [row.group, row.status])).toEqual([['PASSENGER', 'NOT_APPROVED'], ['CARGO', 'ACTIVE']]);
    expect(data.groups[1].reviewer_name).toBe('Alex Reviewer');
    expect(data.history[0]).toMatchObject({ actor_name: 'Alex Reviewer', new_group: 'CARGO', new_status: 'ACTIVE', version: 1 });
    expect(Number.isFinite(new Date(data.history[0].occurred_at).getTime())).toBe(true);
    for (const id of ['88', '99']) {
      const inaccessible = { params: Promise.resolve({ id }) };
      expect((await GET(new Request('http://localhost'), inaccessible)).status).toBe(404);
      expect((await PUT(request(payload), inaccessible)).status).toBe(404);
    }
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
}, 60000);
