// SEC-CONFIG — edge request handling, transport security, credential hygiene.
//
// Authorized assessment tests. Covers the two request-path controls that sit in
// front of every API route (origin policy and the edge flood guard), the
// response security headers, and the repository's credential hygiene — both the
// live tree and what git history still carries.
//
// Nothing here contacts a network, a database, or the deployed project. Where a
// conclusion needs the live environment it is labelled as such.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
// The explicit .js is required: this Next version's ESM resolution does not map
// the extensionless "next/constants" specifier (the CJS require() form does).
import { PHASE_PRODUCTION_BUILD, PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

process.env.NEXT_PUBLIC_APP_URL ??= 'https://app.fleetops.test';
process.env.NEXTAUTH_URL ??= 'https://app.fleetops.test';

import { proxy, config } from '@/proxy';
import { checkEdgeThrottle, EDGE_LIMIT, EDGE_WINDOW_MS } from '@/lib/edge-throttle';
import { clientIp } from '@/lib/rate-limit';

const repo = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const git = args => execFileSync('git', args, { cwd: new URL('../../', import.meta.url), encoding: 'utf8' });

// `git ls-files` reports the INDEX, so a path deleted in the working tree but not
// yet staged is still listed and then cannot be read off disk. A pending deletion
// is tracked state in its own right — it shows in `git status` and lands in the
// commit — and a scan that reads file *contents* has nothing to read for it.
// Everything else must read, so a file that vanishes without git noticing still
// throws rather than being skipped silently.
const pendingDeletions = new Set(git(['ls-files', '--deleted']).split('\n').filter(Boolean));
const trackedFiles = (...paths) =>
  git(['ls-files', ...paths]).split('\n').filter(f => f && !pendingDeletions.has(f));

// next.config.mjs exports a function of `phase` — the documented Next.js idiom.
// Accepting a plain object as well keeps these assertions about *behaviour* (what
// the CSP says, whether the build guard fires) rather than about the export's
// shape, so running them against the older object export reports the missing
// guard rather than "default is not a function".
const loadNextConfig = async (phase) => {
  vi.resetModules();
  const { default: exported } = await import('../../next.config.mjs');
  return typeof exported === 'function' ? exported(phase) : exported;
};

const req = (url, { method = 'GET', headers = {} } = {}) => new Request(url, { method, headers });

// ---------------------------------------------------------------------------
// SEC-CONFIG-001 — origin policy
// ---------------------------------------------------------------------------

describe('SEC-CONFIG-001 — the API answers only its own origin, fail-closed', () => {
  it('the middleware matcher covers every API route', () => {
    expect(config.matcher).toEqual('/api/:path*');
  });

  it('a same-origin request (no Origin header) passes through', async () => {
    const res = await proxy(req('https://app.fleetops.test/api/vehicles'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('a configured origin is echoed back, with Vary so caches cannot cross-pollute', async () => {
    const res = await proxy(req('https://app.fleetops.test/api/vehicles', { headers: { origin: 'https://app.fleetops.test' } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.fleetops.test');
    expect(res.headers.get('Vary')).toContain('Origin');
  });

  it('an unknown origin is refused on the simple request and on the preflight', async () => {
    const simple = await proxy(req('https://app.fleetops.test/api/vehicles', { headers: { origin: 'https://evil.example' } }));
    expect(simple.status).toBe(403);
    expect(simple.headers.get('Access-Control-Allow-Origin')).toBeNull();

    const preflight = await proxy(req('https://app.fleetops.test/api/vehicles', {
      method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    }));
    expect(preflight.status).toBe(403);
  });

  it('NEVER sets Access-Control-Allow-Credentials — cookies cannot ride a cross-origin call', () => {
    // This is the property that makes the origin checks meaningful. Without it a
    // browser will not attach the session cookie to a cross-origin request, so
    // an origin-policy gap cannot be cashed in as an authenticated action.
    expect(read('proxy.js')).not.toMatch(/Access-Control-Allow-Credentials/i);
  });

  it('a preflight without an Origin header is refused as malformed', async () => {
    const res = await proxy(req('https://app.fleetops.test/api/vehicles', { method: 'OPTIONS' }));
    expect(res.status).toBe(400);
  });

  it('the allowed header list is an explicit allowlist, not a reflection', async () => {
    const res = await proxy(req('https://app.fleetops.test/api/x', {
      method: 'OPTIONS', headers: { origin: 'https://app.fleetops.test', 'access-control-request-headers': 'x-evil, authorization' },
    }));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Authorization');
  });

  it('OBSERVATION — the origin check can be satisfied from request headers, which no browser controls', () => {
    // Branch 4 derives the expected origin from x-forwarded-host / host, so a
    // non-browser client can make origin and expected-origin agree by sending a
    // matching Host. Browsers set Host themselves, so this is not weaponisable
    // as CSRF; it does mean the CORS layer is not an authentication boundary and
    // must not be treated as one. Every actual control is the route's own
    // requireAuth/requirePermission, which these tests confirm elsewhere.
    const res = read('proxy.js');
    expect(res).toMatch(/x-forwarded-host"\) \|\| request\.headers\?\.get\?\.\("host"\)/);
    expect(res).toMatch(/origin === detectedOrigin/);
  });

  it('development loopback/LAN origins are admitted only outside production', () => {
    const source = read('proxy.js');
    expect(source).toMatch(/process\.env\.NODE_ENV !== "production"/);
    // The whole dev branch is gated on the configured app URL being loopback.
    expect(source).toMatch(/configuredAppUrl\.includes\("localhost"\) \|\| configuredAppUrl\.includes\("127\.0\.0\.1"\)/);
  });
});

// ---------------------------------------------------------------------------
// SEC-CONFIG-002 — the edge flood guard
// ---------------------------------------------------------------------------

describe('SEC-CONFIG-002 — the edge throttle blunts a single-source flood', () => {
  const ip = n => `203.0.113.${n}`;

  it('admits up to the limit inside a window, then answers 429 with a Retry-After', () => {
    const t = 1_000_000;
    for (let i = 0; i < EDGE_LIMIT; i++) {
      expect(checkEdgeThrottle(ip(10), t).allowed).toBe(true);
    }
    const blocked = checkEdgeThrottle(ip(10), t);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(blocked.retryAfter).toBeLessThanOrEqual(EDGE_WINDOW_MS / 1000);
  });

  it('the window rolls over', () => {
    const t = 2_000_000;
    for (let i = 0; i < EDGE_LIMIT + 1; i++) checkEdgeThrottle(ip(11), t);
    expect(checkEdgeThrottle(ip(11), t).allowed).toBe(false);
    expect(checkEdgeThrottle(ip(11), t + EDGE_WINDOW_MS + 1).allowed).toBe(true);
  });

  it('buckets are per-source, so one flooding IP does not block another', () => {
    const t = 3_000_000;
    for (let i = 0; i < EDGE_LIMIT + 5; i++) checkEdgeThrottle(ip(12), t);
    expect(checkEdgeThrottle(ip(12), t).allowed).toBe(false);
    expect(checkEdgeThrottle(ip(13), t).allowed).toBe(true);
  });

  it('KNOWN LIMIT — the guard is per-process memory, so N instances tolerate ~N x the cap', () => {
    // Stated by the module itself. It is an availability blunting control, not a
    // security boundary, and it does not coordinate across instances.
    const source = read('lib/edge-throttle.js');
    expect(source).toMatch(/Per-instance memory/);
    expect(EDGE_LIMIT).toBe(600);
    expect(EDGE_WINDOW_MS).toBe(60_000);
  });

  it('KNOWN LIMIT — the guard FAILS OPEN on an internal error, deliberately', () => {
    const source = read('lib/edge-throttle.js');
    expect(source).toMatch(/FAIL-OPEN/);
    expect(source).toMatch(/catch \{\s*return \{ allowed: true, retryAfter: 0 \};\s*\}/);
  });

  it('KNOWN LIMIT — an absent source address shares one bucket named "unknown"', () => {
    // All such callers are pooled into a single allowance, so a deployment that
    // does not populate either header throttles everyone together.
    const t = 4_000_000;
    for (let i = 0; i < EDGE_LIMIT + 1; i++) checkEdgeThrottle(undefined, t);
    expect(checkEdgeThrottle(null, t).allowed).toBe(false);
    expect(checkEdgeThrottle('unknown', t).allowed).toBe(false);
  });

  it('the bucket map is bounded, so a spoofed-source flood cannot exhaust memory', () => {
    const source = read('lib/edge-throttle.js');
    expect(source).toMatch(/MAX_BUCKETS = 5_000/);
    expect(source).toMatch(/buckets\.size >= MAX_BUCKETS/);
  });
});

// ---------------------------------------------------------------------------
// SEC-CONFIG-003 — source-address resolution
// ---------------------------------------------------------------------------

describe('SEC-CONFIG-003 — the client address is taken from the nearest hop', () => {
  it('takes the rightmost x-forwarded-for entry, not the leftmost the client controls', () => {
    const headers = { get: k => (k === 'x-forwarded-for' ? '6.6.6.6, 203.0.113.7' : null) };
    expect(clientIp({ headers })).toBe('203.0.113.7');
  });

  it('strips a port from the nearest hop', () => {
    const headers = { get: k => (k === 'x-forwarded-for' ? '203.0.113.8:51234' : null) };
    expect(clientIp({ headers })).toBe('203.0.113.8');
  });

  it('falls back to x-real-ip, and to "unknown" when nothing usable is present', () => {
    expect(clientIp({ headers: { get: k => (k === 'x-real-ip' ? '203.0.113.9' : null) } })).toBe('203.0.113.9');
    expect(clientIp({ headers: { get: () => null } })).toBe('unknown');
    expect(clientIp({ headers: { get: () => 'not-an-ip' } })).toBe('unknown');
  });

  it('OBSERVATION — a rightmost hop is only trustworthy when a proxy appends it', () => {
    // Both proxy.js and clientIp read the LAST entry, which is correct when the
    // platform edge appends the observed address. If the app is ever exposed
    // without such an edge, the last entry is whatever the client sent, and both
    // throttles become bypassable by rotating the header. This depends on the
    // deployment topology, not on the code — verify against the live edge.
    const proxySource = read('proxy.js');
    expect(proxySource).toMatch(/forwarded\.split\(","\)\.pop\(\)\.trim\(\)/);
    expect(read('lib/rate-limit.js')).toMatch(/hops\[hops\.length - 1\]/);
  });
});

// ---------------------------------------------------------------------------
// SEC-CONFIG-004 — response security headers
// ---------------------------------------------------------------------------

describe('SEC-CONFIG-004 — transport and framing headers', () => {
  const config = () => repo('next.config.mjs');

  it('every response carries the core hardening headers', () => {
    const source = config();
    expect(source).toMatch(/Content-Security-Policy/);
    expect(source).toMatch(/Referrer-Policy", value: "strict-origin-when-cross-origin"/);
    expect(source).toMatch(/X-Content-Type-Options", value: "nosniff"/);
    expect(source).toMatch(/X-Frame-Options", value: "DENY"/);
    expect(source).toMatch(/Permissions-Policy", value: "camera=\(\), microphone=\(\), geolocation=\(self\)"/);
    expect(source).toMatch(/Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload"/);
  });

  it('the header block applies to every path', () => {
    expect(config()).toMatch(/source: "\/:path\*"/);
  });

  it('the banner header is suppressed', () => {
    expect(config()).toMatch(/poweredByHeader: false/);
  });

  it('the CSP pins framing, base, form-action and object-src to none/self', () => {
    const source = config();
    for (const directive of ["default-src 'self'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'", "object-src 'none'"]) {
      expect(source).toContain(directive);
    }
  });

  it("KNOWN WEAKNESS — script-src allows 'unsafe-inline' in production", () => {
    // No nonce and no 'strict-dynamic', so the inline-script allowance is
    // unconditional in production too. It does not by itself create an
    // injection, but it removes the CSP as a second line of defence should an
    // HTML-injection sink ever appear. 'unsafe-eval' is correctly dev-only.
    const source = config();
    expect(source).toMatch(/script-src 'self' 'unsafe-inline'\$\{isDev \? " 'unsafe-eval'" : ""\}/);
  });

  it('img-src admits only the fleet origins, not every https host', async () => {
    // SEC-UPLOAD-005's second line. A bare scheme-source (`https:`) is a
    // wildcard over the whole internet, so a stored evidence URL pointing
    // anywhere at all would still be fetched by the reviewing staff browser even
    // once the write path refuses it. This evaluates the real config rather than
    // grepping its source, so it fails if the derivation is ever broken — not
    // merely if the string changes shape.
    vi.resetModules();
    const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fleetstorage.supabase.co';
    try {
      const nextConfig = await loadNextConfig(PHASE_PRODUCTION_BUILD);
      const headerBlock = await nextConfig.headers();
      const csp = headerBlock[0].headers.find(h => h.key === 'Content-Security-Policy').value;
      const imgSrc = csp.split('; ').find(d => d.startsWith('img-src'));

      expect(imgSrc).not.toMatch(/(^|\s)https:(\s|$)/);
      expect(imgSrc).not.toMatch(/(^|\s)\*(\s|$)/);
      // The storage host is what every receipt, avatar, vehicle photo and
      // incident photo is served from; losing it breaks the whole UI.
      expect(imgSrc).toContain('https://fleetstorage.supabase.co');
      expect(imgSrc).toContain("'self'");
      expect(imgSrc).toContain('data:');
      expect(imgSrc).toContain('blob:');
      // Leaflet base layers and the TomTom overlays — narrowing this directive
      // must not blank the dispatch radar, incident map or live-locations map.
      for (const host of ['https://api.tomtom.com', 'https://*.basemaps.cartocdn.com', 'https://server.arcgisonline.com']) {
        expect(imgSrc).toContain(host);
      }
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
      vi.resetModules();
    }
  });

  it('img-src is derived from the same env vars as the server-side media allowlist', async () => {
    // Two independent copies of "which hosts are ours" drift apart; one source
    // cannot. remote-url.js is the server-side half of the same boundary.
    const remoteUrl = read('lib/security/remote-url.js');
    for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_APP_URL']) {
      expect(remoteUrl).toContain(key);
      expect(config()).toContain(key);
    }
  });

  it('OBSERVATION — these headers protect the app origin, not Supabase storage objects', () => {
    // Bucket objects are served from the storage host with that host's headers.
    // A storage object whose stored extension disagrees with its Content-Type is
    // therefore not covered by this nosniff — see SEC-UPLOAD-002.
    expect(config()).toMatch(/nosniff/);
    expect(read('lib/fuel/receipt-storage.js')).toMatch(/supabase\.storage/);
  });

  it('a production build without NEXT_PUBLIC_SUPABASE_URL fails loudly', async () => {
    // The CSP above is computed at BUILD time. Without the Supabase URL the
    // policy is emitted without the storage origin, and the failure surfaces only
    // as a CSP refusal in each user's console — every receipt, licence, face photo
    // and piece of incident evidence silently stops loading. The build must refuse.
    vi.resetModules();
    const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    try {
      await expect(loadNextConfig(PHASE_PRODUCTION_BUILD)).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    } finally {
      if (previous !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
      vi.resetModules();
    }
  });

  it('the build guard does not fire in development, where the URL may be absent', async () => {
    // next.config.mjs is also loaded by `next start` (NODE_ENV=production) and by
    // `next dev`. NEXT_PUBLIC_* values are inlined at build time, so a production
    // *runtime* is not required to have them — scoping the guard to the build
    // phase is what keeps a deployed container from crashing on boot.
    vi.resetModules();
    const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    try {
      await expect(loadNextConfig(PHASE_DEVELOPMENT_SERVER)).resolves.toBeTruthy();
    } finally {
      if (previous !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
      vi.resetModules();
    }
  });
});

// ---------------------------------------------------------------------------
// SEC-CONFIG-005 — credential hygiene in the working tree
// ---------------------------------------------------------------------------

describe('SEC-CONFIG-005 — no credential material is tracked', () => {
  it('git tracks no env, key, or credential file', () => {
    const tracked = git(['ls-files']).split('\n');
    const suspect = tracked.filter(f => /(^|\/)\.env|\.pem$|\.p12$|\.pfx$|(^|\/)id_rsa|credential|\.keystore$/i.test(f));
    expect(suspect).toEqual([]);
  });

  it('.gitignore excludes env files', () => {
    expect(repo('.gitignore')).toMatch(/^\.env\*/m);
  });

  it('OBSERVATION — the ignore rule also excludes the template that is meant to be shared', () => {
    // `.env*` swallows `.env.local.example`, so a fresh clone has no template to
    // copy. The template is what a developer edits to add a real secret, which
    // is adjacent to the finding below.
    expect(repo('.gitignore')).toMatch(/^\.env\*$/m);
  });

  it('no tracked source file hardcodes a credential-shaped literal', () => {
    // Test files are excluded: a suite is expected to contain fake secrets, and
    // flagging them would drown the signal. Scripts are included.
    const files = trackedFiles('src', 'scripts')
      .filter(f => /\.(js|jsx|mjs)$/.test(f) && !/\.test\.js$/.test(f));
    // No reviewed-benign exclusions: the register-account probe dropped its
    // password literal when Add User moved to temp-password invites, so the
    // allowlist that used to cover it is gone rather than left to grow.
    const offenders = [];
    for (const file of files) {
      const source = repo(file);
      for (const m of source.matchAll(/(password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["']([^"']{16,})["']/gi)) {
        if (/process\.env|your-|change-me|placeholder|example|test|mock|\$\{/i.test(m[2])) continue;
        offenders.push(`${file}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the one reviewed script fixture really is a throwaway local probe', () => {
    // Guard the exclusion above so it cannot silently cover a real credential.
    const source = repo('scripts/verify-register-account.mjs');
    expect(source).toMatch(/harness-adduser-probe@local\.invalid/);
    expect(source).toMatch(/finally \{\s*await cleanup\(\)/);
  });

  it('no NEXT_PUBLIC_ variable exposes a secret-shaped value', () => {
    // An allowlist of permitted names would need editing on every innocuous
    // addition, which is how a test like this gets whitelisted into uselessness.
    // Test the actual risk instead: a NEXT_PUBLIC_ variable is inlined into the
    // browser bundle, so its NAME must never look like credential material.
    // Two reviewed exceptions, both deliberate browser-side keys:
    //   NEXT_PUBLIC_SUPABASE_ANON_KEY — public by design; RLS is its boundary.
    //   NEXT_PUBLIC_TOMTOM_API_KEY    — domain-restricted tile key; the server
    //                                   routing key is the separate TOMTOM_API_KEY.
    const REVIEWED_PUBLIC = new Set(['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_TOMTOM_API_KEY']);
    const SECRET_SHAPED = /(SERVICE_ROLE|SECRET|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|ACCESS_TOKEN|REFRESH_TOKEN|_KEY$)/i;
    const files = trackedFiles('src', 'scripts').filter(f => /\.(js|jsx|mjs)$/.test(f));
    const offenders = [];
    for (const file of files) {
      for (const m of repo(file).matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) {
        if (REVIEWED_PUBLIC.has(m[0])) continue;
        if (SECRET_SHAPED.test(m[0])) offenders.push(`${file}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the two reviewed public keys are the only credential-shaped NEXT_PUBLIC_ names', () => {
    const files = trackedFiles('src', 'scripts').filter(f => /\.(js|jsx|mjs)$/.test(f));
    const names = new Set();
    for (const file of files) for (const m of repo(file).matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) names.add(m[0]);
    // Naming them lets this test fail loudly if a third one is ever introduced.
    expect([...names].filter(n => /_KEY$/.test(n)).sort())
      .toEqual(['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_TOMTOM_API_KEY'].sort());
  });

  it('that mode selector carries no credential', () => {
    expect(read('app/(dashboard)/reservations/new/page.js')).toMatch(/NEXT_PUBLIC_BOOKING_GATEWAY \|\| "mock"/);
  });

  it('the service-role key is only ever read server-side', () => {
    // A NEXT_PUBLIC_ prefix would inline it into the client bundle.
    expect(read('lib/supabase/admin.js')).toMatch(/process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
    expect(read('lib/supabase/admin.js')).not.toMatch(/NEXT_PUBLIC_SUPABASE_SERVICE/);
  });
});

// ---------------------------------------------------------------------------
// SEC-CONFIG-006 — what git history still carries, and what closes it
// ---------------------------------------------------------------------------

describe('SEC-CONFIG-006 — historical credential material', () => {
  it('FINDING (historical, redacted) — a hardcoded account-creation password was committed', () => {
    // Commit afb5239 ("fix system") added src/app/api/auth/fix-account/route.js
    // with a literal default password used when auto-creating a login for a
    // System Admin profile. The file is gone from HEAD, so this is a
    // git-history exposure, not a live backdoor — but the credential string is
    // still recoverable by anyone with the repository. It is not reproduced
    // here; the value is redacted in this report per the assessment rules.
    const history = git(['log', '--all', '--oneline', '-S', 'Password123!']);
    expect(history.trim().length).toBeGreaterThan(0);
    const files = git(['show', '--name-only', '--format=', 'afb5239']).split('\n');
    expect(files).toContain('src/app/api/auth/fix-account/route.js');
    // The pickaxe above searches every commit's diff, so it costs whatever the
    // repository's history costs. That is ~1.3s on an idle checkout but crosses
    // vitest's 5s default when the whole suite runs in parallel, which is a
    // failing gate for a reason that has nothing to do with the assertion.
  }, 30_000);

  it('that route is absent from the working tree', () => {
    expect(git(['ls-files'])).not.toMatch(/fix-account/);
  });

  it('the seeded-admin hash is a publicly-known value, and migration 061 blanks it', () => {
    // S2 in the project's own audit. The plaintext and its bcrypt hash are both
    // public, so the hash in migration 008 is not a secret — it identifies which
    // credential must never authenticate. 061 exists to make that so.
    const seed = repo('supabase/migrations/008_auth_migration.sql');
    expect(seed).toMatch(/admin@fleetops\.com/);
    expect(seed).toMatch(/password_hash IS NULL/);

    const kill = repo('supabase/migrations/061_invalidate_seeded_admin_hash.sql');
    expect(kill).toMatch(/SET password_hash = NULL/);
    expect(kill).toMatch(/WHERE email = 'admin@fleetops\.com'/);
    // The two must name the same hash, or 061 no-ops and the seed survives.
    const hashOf = s => (s.match(/\$2[aby]\$\d{2}\$[A-Za-z0-9./]+/) ?? [null])[0];
    expect(hashOf(kill)).toBeTruthy();
    expect(hashOf(kill)).toBe(hashOf(seed));
  });

  it('NEEDS VERIFICATION — the remediation is an ordered-migration dependency', () => {
    // 008 SETS the known hash where it is NULL; 061 NULLs it where it matches.
    // A database built by running migrations in order ends correctly (NULL). A
    // database where 061 is skipped or reverted, or where the ops rotation was
    // never performed, still authenticates the public credential. Whether the
    // live project has the rotated hash cannot be determined from this
    // repository — it requires SELECT password_hash FROM employees WHERE
    // email='admin@fleetops.com' (never the value, only whether it matches the
    // 008 hash) against the live database.
    const seed = repo('supabase/migrations/008_auth_migration.sql');
    expect(seed).toMatch(/UPDATE employees SET password_hash = '\$2a\$10\$/);
    expect(repo('Capstone/01 - System/Security Audit.md')).toMatch(/S2/);
  });

  it('OBSERVATION — history cannot be un-shipped, only rotated past', () => {
    // Both items above are addressed by rotating the credential, not by an
    // edit: the strings remain in history for anyone who clones. This is why the
    // project's remediation for S2 is described as a live rotation.
    expect(repo('Capstone/01 - System/Security Audit.md')).toMatch(/live password rotated/);
  });
});
