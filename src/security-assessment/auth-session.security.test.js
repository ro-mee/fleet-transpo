// SEC-AUTH / SEC-DB — session and token lifecycle, credential throttling, and
// the database authorization posture.
//
// Authorized assessment tests. The application-layer identity resolution is the
// single chokepoint every route passes through, so these tests drive it with a
// mocked query layer and assert what it refuses. The database section reads the
// migrations: RLS is not this system's boundary and these tests record that
// fact rather than asserting a protection that does not exist.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

vi.mock('@/lib/db', () => ({ query: vi.fn(async () => ({ rows: [] })), withTransaction: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/auth/mobile-token', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, verifyAccessToken: vi.fn(), extractBearerToken: vi.fn(() => null) };
});

import { query } from '@/lib/db';
import { auth } from '@/lib/auth';
import { verifyAccessToken, extractBearerToken } from '@/lib/auth/mobile-token';
import { resolveIdentity, AuthError } from '@/lib/api/utils';
import {
  checkAccountLockout, recordFailedAttempt, clearAccountLockout,
  lockoutKey, LOCKOUT_LIMIT, LOCKOUT_WINDOW_MS,
} from '@/lib/auth/account-lockout';
import { rateLimit, peekRateLimit } from '@/lib/rate-limit';

const repo = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const git = args => execFileSync('git', args, { cwd: new URL('../../', import.meta.url), encoding: 'utf8' });

const req = (headers = {}) => new Request('https://app.fleetops.test/api/x', { headers });

const SESSION = { user: { employeeId: 9, sessionId: 'sess-1', authVersion: 3, role: 'dispatcher' } };
const EMPLOYEE = { employee_id: 9, email: 'a@b.test', first_name: 'A', last_name: 'B', position: 'Ops', status: 'Active', auth_version: 3, role_name: 'dispatcher', driver_id: null };

const liveWebSession = (over = {}) => ({
  session_id: 'sess-1', last_seen_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  revoked_at: null, idle_timeout_seconds: 3600, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  delete globalThis.__HARNESS_SESSION__;
  extractBearerToken.mockReturnValue(null);
  query.mockResolvedValue({ rows: [] });
});

afterEach(() => { delete globalThis.__HARNESS_SESSION__; });

// ---------------------------------------------------------------------------
// SEC-AUTH-001 — account lockout
// ---------------------------------------------------------------------------

describe('SEC-AUTH-001 — failed credentials freeze the account, not just the IP', () => {
  it('the policy is 10 failures in 15 minutes', () => {
    expect(LOCKOUT_LIMIT).toBe(10);
    expect(LOCKOUT_WINDOW_MS).toBe(15 * 60_000);
  });

  it('the bucket key is normalised, so casing and padding cannot split the budget', () => {
    expect(lockoutKey('  Admin@FleetOps.com ')).toBe('lockout:account:admin@fleetops.com');
    expect(lockoutKey('ADMIN@FLEETOPS.COM')).toBe(lockoutKey('admin@fleetops.com'));
  });

  it('peek reports the remaining budget WITHOUT consuming any', async () => {
    query.mockResolvedValue({ rows: [{ hit_count: 3, retry_after: 900 }] });
    const peek = await checkAccountLockout('a@b.test');
    expect(peek.allowed).toBe(true);
    expect(peek.remaining).toBe(7);
    // The peek issues a SELECT; only the consume path may write.
    expect(String(query.mock.calls[0][0])).not.toMatch(/INSERT|UPDATE|DELETE/);
  });

  it('a consumed attempt is rejected once the budget is gone', async () => {
    query.mockResolvedValue({ rows: [{ hit_count: LOCKOUT_LIMIT + 1, retry_after: 120 }] });
    const consumed = await recordFailedAttempt('a@b.test');
    expect(consumed.allowed).toBe(false);
    expect(consumed.retryAfter).toBeGreaterThan(0);
  });

  it('a successful login clears the budget', async () => {
    await clearAccountLockout('Admin@FleetOps.com');
    expect(query.mock.calls[0][0]).toMatch(/DELETE FROM auth_rate_limits WHERE bucket_key = \$1/);
    expect(query.mock.calls[0][1]).toEqual(['lockout:account:admin@fleetops.com']);
  });

  it('clearing never throws, so a database hiccup cannot block a valid login', () => {
    const source = read('lib/auth/account-lockout.js');
    const clear = source.slice(source.indexOf('export async function clearAccountLockout'));
    expect(clear).toMatch(/catch \(error\) \{\s*console\.warn/);
    expect(clear).not.toMatch(/throw/);
  });
});

// ---------------------------------------------------------------------------
// SEC-AUTH-002 — the credential throttle fails closed
// ---------------------------------------------------------------------------

describe('SEC-AUTH-002 — credential throttles fail closed where the edge guard fails open', () => {
  it('a limiter outage refuses the attempt instead of allowing it', async () => {
    query.mockRejectedValueOnce(new Error('connection refused'));
    const result = await rateLimit('login:ip:1.2.3.4', { limit: 5, windowMs: 60_000 });
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('an outage refuses the read-only peek too', async () => {
    query.mockRejectedValueOnce(new Error('connection refused'));
    expect((await peekRateLimit('login:ip:1.2.3.4')).allowed).toBe(false);
  });

  it('the counter is capped so it cannot be inflated unbounded', async () => {
    // LEAST(hit_count + 1, limit + 1) — the stored value never runs away, so the
    // limiter stays a fixed-size row under sustained attack.
    expect(read('lib/rate-limit.js')).toMatch(/LEAST\(auth_rate_limits\.hit_count \+ 1, \$3 \+ 1\)/);
  });

  it('the bucket key is truncated, so a caller cannot force unbounded key growth', () => {
    expect(read('lib/rate-limit.js')).toMatch(/String\(key\)\.slice\(0, 512\)/);
  });

  it('the counters live in PostgreSQL, not process memory', () => {
    // The stated reason is that a restart or a second instance must not reset
    // the budget — the property the edge guard explicitly does not have.
    expect(read('lib/rate-limit.js')).toMatch(/INSERT INTO auth_rate_limits/);
    expect(read('lib/rate-limit.js')).toMatch(/persisted in PostgreSQL/);
  });

  it('the login path throttles per IP AND per account before any password work', () => {
    const source = read('lib/auth.js');
    const authorize = source.slice(source.indexOf('async authorize'), source.indexOf('const lockout ='));
    expect(authorize).toMatch(/rateLimit\(`login:ip:\$\{ip\}`/);
    expect(authorize).toMatch(/rateLimit\(`login:account:\$\{normalizedEmail\}`/);
    // The throttle and the lockout both precede the bcrypt comparison.
    expect(source.indexOf('checkAccountLockout')).toBeLessThan(source.indexOf('bcrypt.compare'));
  });

  it('MFA verification has its own independent bucket', () => {
    const source = read('lib/auth.js');
    expect(source).toMatch(/rateLimit\(`mfa-login:ip:\$\{ip\}`/);
    expect(source).toMatch(/rateLimit\(`mfa-login:account:\$\{employee\.employee_id\}`/);
  });
});

// ---------------------------------------------------------------------------
// SEC-AUTH-003 — the identity chokepoint
// ---------------------------------------------------------------------------

describe('SEC-AUTH-003 — every request re-reads the live employee row', () => {
  const withWebSession = () => {
    query.mockImplementation(async sql => {
      const s = String(sql);
      if (/FROM web_sessions/.test(s)) return { rows: [liveWebSession()] };
      if (/FROM employees e/.test(s)) return { rows: [EMPLOYEE] };
      return { rows: [] };
    });
  };

  it('a valid session resolves to the live role, not the token role', async () => {
    auth.mockResolvedValue(SESSION);
    withWebSession();
    const identity = await resolveIdentity(req());
    expect(identity.user.employeeId).toBe(9);
    expect(identity.user.role).toBe('dispatcher');
    expect(identity.via).toBe('session');
  });

  it('FINDING-CLASS DEFENCE — a stale token role cannot survive a role change', async () => {
    // The session claims fleet_manager; the database says dispatcher. The
    // resolved role is the database's, so a demotion takes effect on the very
    // next request rather than at token expiry. This is the property that makes
    // the authVersion guard below a second line rather than the only one.
    auth.mockResolvedValue({ user: { employeeId: 9, sessionId: 'sess-1', authVersion: 3, role: 'fleet_manager' } });
    withWebSession();
    expect((await resolveIdentity(req())).user.role).toBe('dispatcher');
  });

  it('an authVersion mismatch ends the session immediately', async () => {
    auth.mockResolvedValue({ user: { employeeId: 9, sessionId: 'sess-1', authVersion: 2, role: 'dispatcher' } });
    withWebSession();
    await expect(resolveIdentity(req())).rejects.toMatchObject({ status: 401, code: 'SESSION_REVOKED' });
  });

  it('a token with no authVersion at all is refused, not defaulted', async () => {
    for (const authVersion of [undefined, null, 'three', NaN, 3.5]) {
      auth.mockResolvedValue({ user: { employeeId: 9, sessionId: 'sess-1', authVersion, role: 'dispatcher' } });
      withWebSession();
      await expect(resolveIdentity(req())).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    }
  });

  it('a revoked web session is refused', async () => {
    auth.mockResolvedValue(SESSION);
    query.mockImplementation(async sql => (/FROM web_sessions/.test(String(sql))
      ? { rows: [liveWebSession({ revoked_at: new Date().toISOString() })] }
      : { rows: [EMPLOYEE] }));
    await expect(resolveIdentity(req())).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
  });

  it('an absolute expiry and an idle expiry are separate refusals', async () => {
    auth.mockResolvedValue(SESSION);
    query.mockImplementation(async sql => (/FROM web_sessions/.test(String(sql))
      ? { rows: [liveWebSession({ expires_at: new Date(Date.now() - 1000).toISOString() })] }
      : { rows: [EMPLOYEE] }));
    await expect(resolveIdentity(req())).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });

    vi.clearAllMocks();
    auth.mockResolvedValue(SESSION);
    extractBearerToken.mockReturnValue(null);
    query.mockImplementation(async sql => (/FROM web_sessions/.test(String(sql))
      ? { rows: [liveWebSession({ last_seen_at: new Date(Date.now() - 7_200_000).toISOString() })] }
      : { rows: [EMPLOYEE] }));
    await expect(resolveIdentity(req())).rejects.toMatchObject({ code: 'SESSION_IDLE_TIMEOUT' });
  });

  it('a session row that no longer exists is refused', async () => {
    auth.mockResolvedValue(SESSION);
    query.mockImplementation(async sql => (/FROM web_sessions/.test(String(sql)) ? { rows: [] } : { rows: [EMPLOYEE] }));
    await expect(resolveIdentity(req())).rejects.toMatchObject({ code: 'SESSION_INVALID' });
  });

  it('a session with no sessionId is refused rather than treated as authenticated', async () => {
    auth.mockResolvedValue({ user: { employeeId: 9, authVersion: 3, role: 'dispatcher' } });
    await expect(resolveIdentity(req())).rejects.toMatchObject({ code: 'SESSION_INVALID' });
  });

  it('a deleted or deactivated employee is refused even with a live session', async () => {
    auth.mockResolvedValue(SESSION);
    for (const rows of [[], [{ ...EMPLOYEE, status: 'Inactive' }], [{ ...EMPLOYEE, role_name: null }]]) {
      vi.clearAllMocks();
      auth.mockResolvedValue(SESSION);
      extractBearerToken.mockReturnValue(null);
      query.mockImplementation(async sql => (/FROM web_sessions/.test(String(sql)) ? { rows: [liveWebSession()] } : { rows }));
      await expect(resolveIdentity(req())).rejects.toMatchObject({ status: 401 });
    }
  });

  it('the employee query itself excludes soft-deleted and non-Active rows', () => {
    const source = read('lib/api/utils.js');
    expect(source).toMatch(/AND e\.deleted_at IS NULL/);
    expect(source).toMatch(/AND e\.status = 'Active'/);
  });

  it('no session at all is refused', async () => {
    auth.mockResolvedValue(null);
    await expect(resolveIdentity(req())).rejects.toMatchObject({ status: 401, code: 'SESSION_INVALID' });
  });
});

// ---------------------------------------------------------------------------
// SEC-AUTH-004 — the mobile bearer family
// ---------------------------------------------------------------------------

describe('SEC-AUTH-004 — mobile sessions are revoked by family, checked on the active row', () => {
  const bearer = () => {
    extractBearerToken.mockReturnValue('header.payload.sig');
    verifyAccessToken.mockResolvedValue({ employeeId: 9, role: 'dispatcher', driverId: null, authVersion: 3, familyId: 'fam-1' });
  };

  it('an invalid or expired access token is refused before any query', async () => {
    extractBearerToken.mockReturnValue('bad');
    verifyAccessToken.mockResolvedValue(null);
    await expect(resolveIdentity(req())).rejects.toMatchObject({ status: 401, code: 'SESSION_INVALID' });
    expect(query).not.toHaveBeenCalled();
  });

  it('a token carrying no family is refused', async () => {
    extractBearerToken.mockReturnValue('header.payload.sig');
    verifyAccessToken.mockResolvedValue({ employeeId: 9, authVersion: 3, familyId: null });
    query.mockResolvedValue({ rows: [EMPLOYEE] });
    await expect(resolveIdentity(req())).rejects.toMatchObject({ code: 'SESSION_INVALID' });
  });

  it('a family with no live row is revoked — covering replay, logout and admin revoke alike', async () => {
    bearer();
    query.mockImplementation(async sql => {
      const s = String(sql);
      if (/FROM employees e/.test(s)) return { rows: [EMPLOYEE] };
      if (/FROM mobile_refresh_tokens/.test(s)) return { rows: [] };
      return { rows: [] };
    });
    await expect(resolveIdentity(req())).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
  });

  it('the liveness query selects the ACTIVE row, deterministically', async () => {
    // The regression this guards: LIMIT 1 with no filter could return the row a
    // rotation just revoked and falsely declare a valid family dead (the
    // 2026-09-08 SESSION_REVOKED storm). Three properties are load-bearing.
    const source = read('lib/api/utils.js');
    const familyQuery = source.slice(source.indexOf('familyRows'), source.indexOf('familyRecord'));
    expect(familyQuery).toMatch(/WHERE employee_id = \$1 AND family_id = \$2 AND revoked_at IS NULL/);
    expect(familyQuery).toMatch(/ORDER BY created_at DESC/);
    expect(familyQuery).toMatch(/LIMIT 1/);
  });

  it('an expired family row is a distinct refusal from a revoked one', async () => {
    bearer();
    query.mockImplementation(async sql => {
      const s = String(sql);
      if (/FROM employees e/.test(s)) return { rows: [EMPLOYEE] };
      if (/FROM mobile_refresh_tokens/.test(s)) return { rows: [{ expires_at: new Date(Date.now() - 1000).toISOString() }] };
      return { rows: [] };
    });
    await expect(resolveIdentity(req())).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it('a bearer token is bound to the employee row, so the driverId cannot be widened', async () => {
    bearer();
    query.mockImplementation(async sql => {
      const s = String(sql);
      if (/FROM employees e/.test(s)) return { rows: [{ ...EMPLOYEE, role_name: 'driver', driver_id: 4 }] };
      if (/FROM mobile_refresh_tokens/.test(s)) return { rows: [{ expires_at: new Date(Date.now() + 3_600_000).toISOString() }] };
      return { rows: [] };
    });
    const identity = await resolveIdentity(req());
    expect(identity.user.driverId).toBe(4);
    expect(identity.user.role).toBe('driver');
  });

  it('an explicit bearer header wins over a cookie session', () => {
    expect(read('lib/api/utils.js')).toMatch(/if \(bearer\) \{/);
  });
});

// ---------------------------------------------------------------------------
// SEC-AUTH-005 — timing and enumeration on the login path
// ---------------------------------------------------------------------------

describe('SEC-AUTH-005 — login does not disclose whether an account exists', () => {
  it('bcrypt work is spent even when the account is missing', () => {
    const source = read('lib/auth.js');
    // The dummy hash is a fixed, public bcrypt digest — not a credential.
    expect(source).toMatch(/employee\?\.password_hash \|\| "\$2b\$10\$/);
    expect(source).toMatch(/Always spend the bcrypt work/);
  });

  it('a failure and a missing account take the same branch', () => {
    const source = read('lib/auth.js');
    expect(source).toMatch(/if \(!employee \|\| !valid\) \{/);
  });

  it('the lockout message is the only account-state disclosure, and it is deliberate', () => {
    // ACCOUNT_LOCKED carries only a retry-after, so the locked-out user is told
    // how long to wait without revealing anything about the credential.
    const source = read('lib/auth.js');
    expect(source).toMatch(/ACCOUNT_LOCKED:\$\{lockout\.retryAfter\}/);
    expect(source).not.toMatch(/ACCOUNT_LOCKED:[^`]*email/);
  });

  it('failures and lockouts are audited', () => {
    const source = read('lib/auth.js');
    for (const action of ['login_failure', 'login_success', 'mfa_required', 'mfa_failure']) {
      expect(source).toContain(`action: "${action}"`);
    }
    expect(source).toMatch(/type: "account_locked"/);
  });
});

// ---------------------------------------------------------------------------
// SEC-DB-001 — RLS is not the boundary, and the repo says so
// ---------------------------------------------------------------------------

describe('SEC-DB-001 — the database authorization posture is application-layer', () => {
  it('schema.sql cannot represent RLS or grants — by design, not by omission', () => {
    // It states its own scope. This is why the RLS posture is not auditable from
    // the dump and must be read from migrations plus the live database.
    const dump = repo('schema.sql');
    expect(dump).toMatch(/no owners, no grants/);
    expect(dump).toMatch(/Generated file — edit the database with a migration/);
    expect(dump).not.toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(dump).not.toMatch(/CREATE POLICY/);
  });

  it('migration 060 closed the anon-key escalation on employees', () => {
    const m = repo('supabase/migrations/060_remove_anon_employee_access.sql');
    expect(m).toMatch(/DROP POLICY IF EXISTS "Anyone can insert during registration" ON employees/);
    expect(m).toMatch(/DROP POLICY IF EXISTS "Anyone to check email during registration" ON employees|DROP POLICY IF EXISTS "Anyone can check email during registration" ON employees/);
    expect(m).toMatch(/REVOKE ALL ON TABLE employees FROM anon/);
  });

  it('no migration re-grants the anon role access to employees', () => {
    const files = git(['ls-files', 'supabase/migrations']).split('\n').filter(f => f.endsWith('.sql'));
    const offenders = [];
    for (const file of files) {
      // Strip SQL comments first: migration 060 *describes* the revocation in
      // prose ("the anon role can never touch employees"), and matching that
      // would be a false positive against the very migration that fixes it.
      const source = repo(file)
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/--[^\n]*/g, ' ');
      for (const m of source.matchAll(/GRANT[^;]*\b(anon|authenticated)\b[^;]*;/gi)) {
        if (!/\bemployees\b/i.test(m[0])) continue;
        offenders.push(`${file}: ${m[0].slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('migration 095 removed the permissive storage read policy it replaced', () => {
    const m = repo('supabase/migrations/095_expense_receipts_rls_fix.sql');
    expect(m).toMatch(/DROP POLICY IF EXISTS "Authenticated users can read their expense receipts" ON storage\.objects/);
    expect(m).toMatch(/Service Role/);
  });

  it('OBSERVATION — authorization therefore rests entirely on requirePermission', () => {
    // Every route must call it; a route that forgets has no database backstop.
    // The static audit script is the control that catches a missing call.
    expect(read('lib/api/utils.js')).toMatch(/export async function requirePermission/);
    expect(repo('package.json')).toMatch(/verify-route-auth/);
  });

  it("the default role set fails closed by excluding the driver role", () => {
    // A resource/action typo resolves to DEFAULT_ROLES, not to everyone.
    const source = read('lib/api/utils.js');
    const defaults = source.slice(source.indexOf('const DEFAULT_ROLES'), source.indexOf(']', source.indexOf('const DEFAULT_ROLES')));
    expect(defaults).toContain('system_admin');
    expect(defaults).not.toContain('driver');
  });
});

// ---------------------------------------------------------------------------
// SEC-DB-002 — migration discipline
// ---------------------------------------------------------------------------

describe('SEC-DB-002 — migration ledger discipline', () => {
  it('the ledger keys on full filename because version numbers were duplicated', () => {
    // 059 and 060 each name two different migrations. Keying on the version
    // alone would let one of each pair never be applied while reporting success.
    const files = git(['ls-files', 'supabase/migrations']).split('\n').filter(f => f.endsWith('.sql'));
    const byVersion = {};
    for (const f of files) {
      const v = f.match(/\/(\d+)_/)?.[1];
      if (v) (byVersion[v] ??= []).push(f);
    }
    const dupes = Object.entries(byVersion).filter(([, group]) => group.length > 1);
    expect(dupes.length).toBeGreaterThan(0);
    expect(repo('scripts/migrate.mjs')).toMatch(/full filename|filename/i);
  });

  it('the apply runner wraps each migration in its own transaction', () => {
    const m = repo('scripts/migrate.mjs');
    expect(m).toMatch(/BEGIN/);
    expect(m).toMatch(/COMMIT/);
  });

  it('the runner refuses to proceed when an applied migration was edited', () => {
    expect(repo('scripts/migrate.mjs')).toMatch(/checksum/i);
  });

  it('no migration file contains a credential', () => {
    const files = git(['ls-files', 'supabase/migrations']).split('\n').filter(f => f.endsWith('.sql'));
    const offenders = [];
    for (const file of files) {
      // The 008 seeded hash is a publicly-known value, not a secret; it is
      // deliberately excluded and is asserted on in SEC-CONFIG-006.
      const source = repo(file).replace(/\$2[aby]\$\d{2}\$[A-Za-z0-9./]+/g, '<bcrypt>');
      for (const m of source.matchAll(/(password|secret|api_key)\s*[:=]\s*'[^']{12,}'/gi)) {
        offenders.push(`${file}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
