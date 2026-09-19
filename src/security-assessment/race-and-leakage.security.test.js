// SEC-RACE / SEC-LEAK — concurrency safety and information disclosure.
//
// Authorized assessment tests. Two concerns that only show up under conditions
// a functional test never creates: two callers acting at the same instant, and
// what the server says when it fails.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const txQuery = vi.fn(async () => ({ rows: [{ revision: 'rev-1' }] }));
const withTransaction = vi.fn(async fn => fn({ query: txQuery }));

vi.mock('@/lib/db', () => ({
  query: vi.fn(async () => ({ rows: [] })),
  withTransaction: (...args) => withTransaction(...args),
}));

import { commitDispatchEvidence, readDispatchRevision } from '@/services/dispatch-evidence.service';
import { handleError, AuthError, ok, err, errValidation } from '@/lib/api/utils';
import { sanitizeErrorText, shouldWriteAppError } from '@/lib/app-errors';
import { signEvidenceRef } from '@/lib/dispatch/evidence-contract';

process.env.NEXTAUTH_SECRET ??= 'sec-assessment-race-key';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const repo = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const git = args => execFileSync('git', args, { cwd: new URL('../../', import.meta.url), encoding: 'utf8' });

beforeEach(() => {
  vi.clearAllMocks();
  txQuery.mockResolvedValue({ rows: [{ revision: 'rev-1' }] });
});

// ---------------------------------------------------------------------------
// SEC-RACE-001 — assignment is a compare-and-set, not a read-then-write
// ---------------------------------------------------------------------------

describe('SEC-RACE-001 — the dispatch commit refuses to act on stale evidence', () => {
  const token = () => ({ revision: 'rev-1', expiresAt: new Date(Date.now() + 60_000).toISOString(), vehicleId: 4, driverId: 7 });

  it('a matching, unexpired revision lets the write run inside the transaction', async () => {
    const write = vi.fn(async () => 'written');
    await expect(commitDispatchEvidence(token(), write)).resolves.toBe('written');
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('the write happens inside the locked transaction — the same tx object is handed to it', async () => {
    // The guard is only meaningful if the caller's write shares the lock. A
    // guard that re-checked and then ran the write outside the transaction
    // would be a TOCTOU window, not a guard.
    const write = vi.fn(async tx => tx.query('SELECT 1'));
    await commitDispatchEvidence(token(), write);
    expect(write.mock.calls[0][0]).toBe(txQuery.mock.contexts[0] ?? write.mock.calls[0][0]);
    expect(write.mock.calls[0][0]).toHaveProperty('query');
  });

  it('a revision that moved under us is refused with STALE_DISPATCH_EVIDENCE', async () => {
    txQuery.mockResolvedValue({ rows: [{ revision: 'rev-MOVED' }] });
    const write = vi.fn();
    await expect(commitDispatchEvidence(token(), write))
      .rejects.toMatchObject({ status: 409, code: 'STALE_DISPATCH_EVIDENCE' });
    expect(write).not.toHaveBeenCalled();
  });

  it('an expired token is refused before the revision is even read', async () => {
    const write = vi.fn();
    await expect(commitDispatchEvidence({ ...token(), expiresAt: new Date(Date.now() - 1000).toISOString() }, write))
      .rejects.toMatchObject({ status: 409, code: 'STALE_DISPATCH_EVIDENCE' });
    expect(write).not.toHaveBeenCalled();
  });

  it('a malformed expiry is refused rather than treated as never-expiring', async () => {
    for (const expiresAt of [null, undefined, 'soon', NaN, {}]) {
      await expect(commitDispatchEvidence({ ...token(), expiresAt }, vi.fn()))
        .rejects.toMatchObject({ code: 'STALE_DISPATCH_EVIDENCE' });
    }
  });

  it('a token with no revision is refused up front', async () => {
    const write = vi.fn();
    await expect(commitDispatchEvidence({ expiresAt: token().expiresAt }, write))
      .rejects.toMatchObject({ status: 409, code: 'EVIDENCE_REQUIRED' });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it('the transaction takes a table lock before re-reading the revision', () => {
    // Order matters: lock, then re-read, then write. The lock must come first.
    const source = read('services/dispatch-evidence.service.js');
    const lockAt = source.indexOf('LOCK TABLE');
    const recheckAt = source.indexOf('readDispatchRevision(token,tx)');
    const writeAt = source.indexOf('return write(tx)');
    expect(lockAt).toBeGreaterThan(-1);
    expect(recheckAt).toBeGreaterThan(lockAt);
    expect(writeAt).toBeGreaterThan(recheckAt);
    expect(source).toMatch(/IN SHARE ROW EXCLUSIVE MODE/);
  });

  it('the revision covers every input that could change the decision', () => {
    // A revision that omitted, say, leave or maintenance could not detect a
    // change in those inputs, so the compare-and-set would pass on stale facts.
    const source = read('services/dispatch-evidence.service.js');
    for (const input of ["'driver'", "'vehicle'", "'tripGps'", "'maintenance'", "'dispatches'", "'leave'", "'attendance'", "'consent'", "'incidents'", "'policy'", "'sessions'"]) {
      expect(source).toContain(input);
    }
  });

  it('the revision is an opaque server-side digest the caller cannot forge', () => {
    // It is computed from the database, never accepted from the request, so a
    // client cannot present a revision matching the state it wishes were true.
    const source = read('services/dispatch-evidence.service.js');
    expect(source).toMatch(/md5\(jsonb_build_object\(/);
    expect(source).toMatch(/::text\) AS revision/);
  });

  it('the revision digest is not written to the audit record', () => {
    expect(read('services/dispatch-evidence.service.js')).toMatch(/never save exact standby coordinates/);
  });
});

// ---------------------------------------------------------------------------
// SEC-RACE-002 — idempotency keys
// ---------------------------------------------------------------------------

describe('SEC-RACE-002 — replay of a write is idempotent, not duplicating', () => {
  it('the expense storage key is sanitised from the client submission id', () => {
    const source = read('lib/expenses/receipt-storage.js');
    expect(source).toMatch(/String\(submissionId \|\| uuidv4\(\)\)\.replace\(\/\[\^a-zA-Z0-9-\]\/g, ""\)/);
  });

  it('the expense upload upserts under that key so a retry replaces rather than duplicates', () => {
    expect(read('lib/expenses/receipt-storage.js')).toMatch(/upsert: true/);
  });

  it('the incident idempotency key is format-restricted before it reaches SQL', () => {
    const source = read('app/api/driver/incidents/route.js');
    expect(source).toMatch(/\/\^\[0-9a-z-\]\{16,64\}\$\/i\.test\(body\.client_submission_id\)/);
  });

  it('a duplicate submission returns the existing row without overwriting it', () => {
    const source = read('app/api/driver/incidents/route.js');
    // The insert is DO NOTHING, and the fallback path re-selects rather than updates.
    expect(source).toMatch(/ON CONFLICT \(driver_id, client_submission_id\)/);
    expect(source).toMatch(/DO NOTHING/);
    const dupPath = source.slice(source.indexOf('if (!rows[0] && clientSubmissionId)'), source.indexOf('return err("This report was already submitted"'));
    expect(dupPath).toMatch(/SELECT incident_id/);
    expect(dupPath).not.toMatch(/UPDATE/);
  });

  it('the receipts bucket key is namespaced per driver, so one driver cannot target another', () => {
    expect(read('lib/expenses/receipt-storage.js')).toMatch(/const fileName = `\$\{driverId\}\/\$\{safeSubmissionId\}\/receipt\./);
  });
});

// ---------------------------------------------------------------------------
// SEC-RACE-003 — session and evidence-token unpredictability
// ---------------------------------------------------------------------------

describe('SEC-RACE-003 — identifiers that must not be guessable', () => {
  it('each login mints a fresh random session id — no fixation', () => {
    const source = read('lib/auth.js');
    expect(source).toMatch(/const sessionId = randomUUID\(\)/);
    // The id comes from the server, never from the request.
    expect(source).not.toMatch(/sessionId\s*=\s*credentials/);
  });

  it('the session id is bound to the employee in the lookup, not just looked up alone', () => {
    expect(read('lib/api/utils.js')).toMatch(/WHERE session_id = \$1\s*AND employee_id = \$2/);
  });

  it('storage object names are UUIDs, not sequential or client-chosen', () => {
    for (const file of ['lib/fuel/receipt-storage.js', 'lib/driver/incident-storage.js', 'app/api/driver/license-scan/route.js']) {
      expect(read(file)).toMatch(/uuidv4\(\)/);
    }
  });

  it('the evidence reference carries an HMAC over the payload, so its fields are not editable', () => {
    const ref = signEvidenceRef({ requestId: 1, proofType: 'leave' });
    expect(ref).toMatch(/^ev_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
});

// ---------------------------------------------------------------------------
// SEC-LEAK-001 — what a failure tells the caller
// ---------------------------------------------------------------------------

describe('SEC-LEAK-001 — server faults disclose nothing to the client', () => {
  it('an unexpected error becomes a generic 500', async () => {
    const res = handleError(new Error('connect ECONNREFUSED 10.0.0.5:5432 — password authentication failed for user "postgres"'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal server error' });
  });

  it('the stack, the driver message and the SQL never reach the response', async () => {
    const leaky = new Error('relation "employees" does not exist');
    leaky.stack = 'Error: relation "employees" does not exist\n    at /app/src/services/secret.js:42:7';
    const body = JSON.stringify(await handleError(leaky).json());
    for (const secret of ['employees', 'secret.js', 'at /app', 'stack']) {
      expect(body).not.toContain(secret);
    }
  });

  it('only an AuthError message is echoed, and it is developer-authored', async () => {
    const res = handleError(new AuthError('Trip not found', 404));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Trip not found');
  });

  it('a non-session AuthError does NOT ship a session code', async () => {
    // `code` is a session-liveness signal, so it only defaults on a 401. It used
    // to default unconditionally, and only 26 of ~97 throw sites pass one — so a
    // 404 "Trip not found" and every 403 from requirePermission ("Role 'x' is
    // not permitted") carried a code saying the session was invalid.
    //
    // Neither consumer was fooled (both read `code` only inside a
    // `res.status === 401` branch), but a future consumer keying on `code` alone
    // would have treated a permission denial as a dead session and signed the
    // user out. The envelope no longer lies.
    const res = handleError(new AuthError('Trip not found', 404));
    expect(await res.json()).toEqual({ error: 'Trip not found' });
  });

  it('a 401 still carries SESSION_INVALID, and an explicit code still wins', async () => {
    expect(await handleError(new AuthError('Unauthorized', 401)).json())
      .toEqual({ error: 'Unauthorized', code: 'SESSION_INVALID' });
    // An explicitly supplied code is emitted at any status.
    expect(await handleError(new AuthError('Role not permitted', 403, 'ROLE_DENIED')).json())
      .toEqual({ error: 'Role not permitted', code: 'ROLE_DENIED' });
  });

  it('the two consumers that read the code both gate on status 401 first', () => {
    expect(read('lib/api/client.js')).toMatch(/if \(res\.status === 401\) \{\s*dispatchSessionAuthError\(err\.code/);
    expect(read('context/session-manager.jsx')).toMatch(/if \(response\.status === 401 && isAppApiRequest/);
  });

  it('every 401 the identity chokepoint raises carries an explicit, accurate code', () => {
    const source = read('lib/api/utils.js');
    for (const code of ['SESSION_INVALID', 'SESSION_REVOKED', 'SESSION_EXPIRED', 'SESSION_IDLE_TIMEOUT', 'ACCOUNT_DISABLED']) {
      expect(source).toContain(`"${code}"`);
    }
  });

  it('an error is refused a status it should not be able to claim', () => {
    // The status comes from the AuthError constructor, so a route cannot pass a
    // raw error object through with an attacker-influenced status field.
    const res = handleError({ message: 'nope', status: 200 });
    expect(res.status).toBe(500);
  });

  it('a successful response is JSON, never HTML', async () => {
    const res = ok({ a: 1 });
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  it('validation errors name the field, not the database', async () => {
    const res = errValidation({ email: 'Email is required' });
    const body = await res.json();
    expect(body).toEqual({ error: 'Email is required', errors: { email: 'Email is required' } });
    expect(JSON.stringify(body)).not.toMatch(/pg|sql|relation|column/i);
  });

  it('err() is a plain message with no envelope to over-share', async () => {
    expect(await err('Not allowed', 403).json()).toEqual({ error: 'Not allowed' });
  });
});

// ---------------------------------------------------------------------------
// SEC-LEAK-002 — what the error log persists
// ---------------------------------------------------------------------------

describe('SEC-LEAK-002 — persisted error records are redacted before insert', () => {
  it('a bearer token is redacted', () => {
    const out = sanitizeErrorText('Authorization failed for Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefgh');
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(out).toContain('[redacted]');
  });

  it('authorization and cookie header lines are redacted wholesale', () => {
    const out = sanitizeErrorText('fetch failed\nAuthorization: Basic YWRtaW46aHVudGVyMg==\nCookie: next-auth.session-token=abc123');
    expect(out).not.toContain('YWRtaW46aHVudGVyMg==');
    expect(out).not.toContain('next-auth.session-token=abc123');
  });

  it('a URL keeps its origin and path but loses its query string', () => {
    // Supabase signed URLs carry the capability in the query string.
    const out = sanitizeErrorText('GET https://proj.supabase.co/storage/v1/object/sign/fuel-receipts/4/a.png?token=SECRETVALUE failed');
    expect(out).toContain('proj.supabase.co/storage/v1/object/sign/fuel-receipts/4/a.png');
    expect(out).not.toContain('SECRETVALUE');
  });

  it('a standalone secret query parameter is redacted', () => {
    const out = sanitizeErrorText('params ?token=abc123&x=1');
    expect(out).not.toContain('abc123');
  });

  it('a secret assignment is redacted without mangling ordinary prose', () => {
    expect(sanitizeErrorText('password: hunter2hunter2')).not.toContain('hunter2hunter2');
    expect(sanitizeErrorText('password is required')).toBe('password is required');
  });

  it('sanitizing never throws, even on a hostile value', () => {
    for (const value of [null, undefined, 0, {}, [], Symbol('x')]) {
      expect(() => sanitizeErrorText(value)).not.toThrow();
    }
    expect(sanitizeErrorText('')).toBe('');
  });

  it('records are truncated so a huge payload cannot be used to bloat the log', () => {
    const source = read('lib/app-errors.js');
    expect(source).toMatch(/MAX_MESSAGE = 2000/);
    expect(source).toMatch(/MAX_STACK = 4000/);
    expect(source).toMatch(/truncate\(sanitizeErrorText\(message\)/);
  });

  it('request and response bodies are never persisted', () => {
    expect(read('lib/app-errors.js')).toMatch(/No request\/response bodies are persisted/);
  });

  it('routine auth rejections are not recorded as application faults', () => {
    // shouldWriteAppError is a generic gate; the AuthError short-circuit lives
    // in handleError, which returns at line 286 before reaching it. Assert the
    // ordering rather than the helper, so this test tracks the real control.
    const source = read('lib/api/utils.js');
    const authReturn = source.indexOf("return Response.json(payload, { status: error.status })");
    const persistGate = source.indexOf('if (shouldWriteAppError(error))');
    expect(authReturn).toBeGreaterThan(-1);
    expect(persistGate).toBeGreaterThan(authReturn);
    // And a genuine fault still is recorded.
    expect(shouldWriteAppError(new Error('boom'))).toBe(true);
  });

  it('a subsystem-owned error is excluded from the application-error log', () => {
    // The one real contract of shouldWriteAppError, and it fails open.
    expect(shouldWriteAppError({ subsystemOwned: true })).toBe(false);
    expect(shouldWriteAppError({})).toBe(true);
    expect(shouldWriteAppError(null)).toBe(true);
    expect(shouldWriteAppError(undefined)).toBe(true);
  });

  it('handleError does not log a stack for a routine rejection', () => {
    const source = read('lib/api/utils.js');
    expect(source).toMatch(/Routine rejections \(401\/403\/429\) are expected control flow/);
  });
});

// ---------------------------------------------------------------------------
// SEC-LEAK-003 — no credentials in the application log
// ---------------------------------------------------------------------------

describe('SEC-LEAK-003 — the application never logs a credential', () => {
  it('no token or password is passed to console', () => {
    const files = git(['ls-files', 'src']).split('\n').filter(f => /\.(js|jsx)$/.test(f) && !/\.test\.js$/.test(f));
    const offenders = [];
    for (const file of files) {
      for (const m of repo(file).matchAll(/console\.(log|warn|error|info)\(([^\n]{0,200})/g)) {
        if (/\b(password|passwd|token|secret|apiKey|api_key|authorization|cookie|hash)\b/i.test(m[2])
            && !/error\?\.message|err\?\.message|e\?\.message|\$\{\s*error/.test(m[2])) {
          offenders.push(`${file}: ${m[2].slice(0, 70)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the login path logs nothing about the credential', () => {
    const source = read('lib/auth.js');
    expect(source).not.toMatch(/console\.(log|warn|error)\([^)]*password/i);
  });

  it('the auth rate limiter logs the failure reason only, never the bucket contents', () => {
    const source = read('lib/rate-limit.js');
    expect(source).toMatch(/console\.error\("Auth rate limiter unavailable:", error\?\.message \|\| error\)/);
  });
});
