// SEC-UPLOAD — upload validation, storage-key construction and media-URL trust.
//
// Authorized assessment tests. The file-upload surface is where an
// under-privileged caller (a driver) gets to hand a server-privileged writer
// (the service-role Supabase client) a name and a byte stream. These tests
// assert what the server decides for itself and what it lets the caller decide.
//
// Findings in this file are labelled FINDING, not PASS, wherever the attack
// reproduces. A green suite asserts behaviour; it does not certify safety.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://proj.supabase.co';

const uploadMock = vi.fn(async () => ({ error: null }));
const createSignedUrlMock = vi.fn(async (path, ttl) => ({ data: { signedUrl: `https://proj.supabase.co/storage/v1/object/sign/${path}?token=t`, ttl }, error: null }));
const getPublicUrlMock = vi.fn(path => ({ data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/driver-licenses/${path}` } }));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    storage: {
      from: bucket => ({
        upload: (path, body, opts) => uploadMock(bucket, path, body, opts),
        createSignedUrl: (path, ttl) => createSignedUrlMock(`${bucket}/${path}`, ttl),
        getPublicUrl: path => getPublicUrlMock(path),
      }),
    },
  }),
}));

vi.mock('@/lib/db', () => ({ query: vi.fn(async () => ({ rows: [] })), withTransaction: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/services/push.service', () => ({ sendPush: vi.fn(async () => {}) }));
vi.mock('@/lib/api/utils', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    requireDriver: vi.fn(async () => ({ user: { role: 'driver', employeeId: 2, driverId: 4 } })),
    // SEC-UPLOAD-008 exercises the admin driver routes, which authorize with
    // requirePermission instead. Granting it here is what lets the test reach
    // validateBody — the point is that the 400 comes from validation, not auth.
    requirePermission: vi.fn(async () => ({ user: { role: 'super_admin', employeeId: 1, employee_id: 1 } })),
  };
});

import { query } from '@/lib/db';
import { validateImage, validateBase64Image } from '@/lib/uploads/validator';
import { storeFuelReceipt, isOwnedFuelImageUrl, isOwnedFuelReceiptUrl, signFuelReceipt, toStoredReceiptRef, resolveFuelImageUrl, FUEL_RECEIPT_TTL_SECONDS } from '@/lib/fuel/receipt-storage';
import { storeExpenseReceipt } from '@/lib/expenses/receipt-storage';
import { storeIncidentPhoto, getIncidentPhotoUrls } from '@/lib/driver/incident-storage';
import { POST as createIncident } from '@/app/api/driver/incidents/route';
import { POST as uploadFacePhoto } from '@/app/api/driver/face-photo/route';
import { POST as createDriver } from '@/app/api/drivers/route';
import { PUT as updateDriver } from '@/app/api/drivers/[id]/route';
import { isAllowedStoredImageRef, isBase64DataUrl } from '@/lib/validation';
import { validateBody } from '@/lib/validation/helpers';
import { signedUrlFor, signRefs, canonicalStoredRef, objectKeyFromStorageUrl } from '@/lib/storage/object-refs';
import { parseStoredKey } from '@/lib/storage/key-format';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const repo = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10];

/** A File-shaped object good enough for the validator and the storages. */
const fakeFile = (name, type, bytes) => ({
  name, type, size: bytes.length,
  arrayBuffer: async () => new Uint8Array(bytes).buffer,
});

beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue({ rows: [] });
});

// ---------------------------------------------------------------------------
// SEC-UPLOAD-001 — the magic-byte check is conditional on the caller
// ---------------------------------------------------------------------------

describe('SEC-UPLOAD-001 — content-type is trusted unless the caller supplies bytes', () => {
  it('the byte array is now REQUIRED, so the signature check cannot be skipped', () => {
    const anything = { name: 'payload.png', type: 'image/png', size: 4096 };
    // Omitting the bytes used to downgrade the check to "whatever Content-Type
    // the caller chose". It is now a caller error, not a silent weakening.
    expect(() => validateImage(anything)).toThrow(/Uint8Array/);
    expect(() => validateImage(anything, null)).toThrow(/Uint8Array/);
    expect(() => validateImage(anything, new ArrayBuffer(4))).toThrow(/Uint8Array/);
    // A well-formed call still reports normally.
    expect(validateImage(anything, new Uint8Array(PNG))).toEqual({ contentType: 'image/png', extension: 'png' });
  });

  it('with a byte array the signature is enforced in both directions', () => {
    const f = fakeFile('a.png', 'image/png', PNG);
    expect(validateImage(f, new Uint8Array(JPEG))).toMatchObject({ error: expect.stringMatching(/does not match/) });
    expect(validateImage(f, new Uint8Array(PNG))).toMatchObject({ contentType: 'image/png', extension: 'png' });

    const j = fakeFile('a.jpg', 'image/jpeg', JPEG);
    expect(validateImage(j, new Uint8Array(PNG))).toMatchObject({ error: expect.stringMatching(/does not match/) });
    expect(validateImage(j, new Uint8Array(JPEG))).toMatchObject({ contentType: 'image/jpeg', extension: 'jpg' });
  });

  it('size and non-image MIME types are refused regardless of the byte argument', () => {
    for (const type of ['image/svg+xml', 'text/html', 'application/pdf', '', undefined]) {
      expect(validateImage({ type, size: 10 }, new Uint8Array(PNG))).toHaveProperty('error');
    }
    expect(validateImage({ type: 'image/png', size: 0 }, new Uint8Array(PNG))).toHaveProperty('error');
    expect(validateImage({ type: 'image/png', size: 5 * 1024 * 1024 + 1 }, new Uint8Array(PNG))).toHaveProperty('error');
  });

  it('every production caller passes bytes — as it must now', () => {
    const callers = [
      'app/api/vehicles/[id]/image/route.js',
      'lib/driver/incident-storage.js',
      'lib/expenses/receipt-storage.js',
      'lib/fuel/receipt-storage.js',
    ];
    for (const file of callers) {
      expect(read(file), `${file} must pass a byte array`).toMatch(/validateImage\(\s*file,\s*(new Uint8Array\(|uint8Array)/);
    }
  });

  it('the legacy base64 path is unconditional — it has the bytes in hand', () => {
    // validateBase64Image checks magic bytes with no opt-out, which is the
    // behaviour validateImage should have had.
    const ok = `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`;
    const bad = `data:image/png;base64,${Buffer.from('<html>').toString('base64')}`;
    expect(validateBase64Image(ok)).toMatchObject({ contentType: 'image/png', extension: 'png' });
    expect(validateBase64Image(bad)).toMatchObject({ error: expect.stringMatching(/does not match/) });
    expect(validateBase64Image(`data:image/svg+xml;base64,PHN2Zz4=`)).toHaveProperty('error');
    expect(validateBase64Image('not-a-data-uri')).toHaveProperty('error');
    expect(validateBase64Image(null)).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------------------
// SEC-UPLOAD-002 — the storage key takes its extension from the client
// ---------------------------------------------------------------------------

describe('SEC-UPLOAD-002 — the stored object extension is server-derived', () => {
  it('a client filename can no longer choose the stored extension', async () => {
    await storeFuelReceipt(fakeFile('receipt.html', 'image/png', PNG), 4);
    const [, path, , opts] = uploadMock.mock.calls[0];
    expect(path).toMatch(/^4\/[0-9a-f-]{36}\.png$/);   // uuid + VALIDATED extension
    expect(path.endsWith('.html')).toBe(false);
    // The stored extension and Content-Type now agree, so a content sniffer has
    // nothing to disagree with.
    expect(opts.contentType).toBe('image/png');
  });

  it('the same holds for expense receipts', async () => {
    await storeExpenseReceipt(fakeFile('r.svg', 'image/png', PNG), 4, 'abc-123');
    const [, path] = uploadMock.mock.calls[0];
    expect(path).toBe('4/abc-123/receipt.png');
  });

  it('the extension is the validated format whether or not the client named the file', async () => {
    await storeFuelReceipt({ type: 'image/png', size: PNG.length, arrayBuffer: async () => new Uint8Array(PNG).buffer }, 4);
    expect(uploadMock.mock.calls[0][1]).toMatch(/^4\/[0-9a-f-]{36}\.png$/);
  });

  it('the vehicle-image route is the pattern every other bucket now follows', () => {
    expect(read('app/api/vehicles/[id]/image/route.js')).toMatch(/uuidv4\(\)\}\.\$\{validation\.extension\}/);
    expect(read('lib/driver/incident-storage.js')).toMatch(/uuidv4\(\)\}\.\$\{fallbackExt\}/);
    expect(read('lib/fuel/receipt-storage.js')).toMatch(/uuidv4\(\)\}\.\$\{validation\.extension\}/);
    expect(read('lib/expenses/receipt-storage.js')).toMatch(/receipt\.\$\{fallbackExt\}/);
    // …and no receipt path takes an extension from the client any more.
    expect(read('lib/fuel/receipt-storage.js')).not.toMatch(/file\.name\?\.split/);
    expect(read('lib/expenses/receipt-storage.js')).not.toMatch(/file\.name\?\.split/);
  });

  it('a path-traversal filename cannot escape the driver prefix', async () => {
    // The extension is taken from after the last dot and paths contain no dot,
    // so "../../other" collapses to the segment after the final dot.
    await storeFuelReceipt(fakeFile('a.../../../evil.png', 'image/png', PNG), 4);
    const key = uploadMock.mock.calls[0][1];
    expect(key.startsWith('4/')).toBe(true);
    expect(key).not.toContain('..');
  });
});

// ---------------------------------------------------------------------------
// SEC-UPLOAD-003 — signed-URL lifetimes
// ---------------------------------------------------------------------------

describe('SEC-UPLOAD-003 — no code path mints an effectively-permanent bearer URL', () => {
  // REWRITTEN 2026-09-18 (Phase B). This block previously asserted the DEFECT:
  // that storeFuelReceipt and the face-photo route both signed for ten years and
  // wrote the result into a durable column. Per the standing rule a finding's
  // tests are rewritten to the new contract, never deleted or relaxed — the
  // finding itself stays legible in Bugs.md and in git history.
  //
  // What is closed is the CODE. What is NOT closed is the DATA: rows written
  // before this change still hold ten-year tokens. That residual is measured and
  // recorded in the block after this one, not implied away by it.
  const TEN_YEARS = 60 * 60 * 24 * 365 * 10; // 315_360_000

  it('a fuel receipt URL is signed for one hour, not ten years', async () => {
    const { receiptPath, receiptUrl } = await storeFuelReceipt(fakeFile('r.png', 'image/png', PNG), 4);
    expect(createSignedUrlMock.mock.calls[0][1]).toBe(3600);
    expect(createSignedUrlMock.mock.calls[0][1]).not.toBe(TEN_YEARS);
    // The KEY is the value a caller persists; the URL is a response value only.
    expect(receiptPath).toBe(createSignedUrlMock.mock.calls[0][0]);
    expect(receiptPath).toMatch(/^fuel-receipts\/4\/[0-9a-f-]{36}\.png$/);
    expect(receiptUrl).toContain(`/object/sign/fuel-receipts/4/`);
  });

  it('the face-photo route signs for one hour and STORES THE KEY', async () => {
    const dataUrl = `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`;
    const res = await uploadFacePhoto({ json: async () => ({ file_url: dataUrl }) });
    expect(res.status).toBe(201);

    expect(createSignedUrlMock.mock.calls[0][1]).toBe(3600);
    expect(createSignedUrlMock.mock.calls[0][1]).not.toBe(TEN_YEARS);

    // The value written to both columns is the key, never the signed URL. This
    // is the assertion that actually pins the finding: reading the source for
    // the absence of a constant would still pass if the route stored the URL.
    const writes = query.mock.calls.filter(([sql]) => /UPDATE (drivers|employees)/.test(sql));
    expect(writes.length).toBeGreaterThan(0);
    for (const [, params] of writes) {
      expect(params[0]).toMatch(/^face-captures\/4\/[0-9a-f-]{36}\.png$/);
      expect(params[0]).not.toMatch(/^https?:/);
    }
    // …and the caller is still handed something renderable.
    const body = await res.json();
    expect(body.face_image_url).toContain('/object/sign/face-captures/4/');
  });

  it('both fuel write paths canonicalise, so an echoed URL is not persisted', () => {
    // The column holds a key; the client echoes back the short-lived URL it was
    // handed. Without this, every submit would re-create the finding at a
    // one-hour clock instead of a ten-year one.
    for (const file of ['app/api/mobile/fuel/route.js', 'app/api/mobile/fuel/[id]/route.js']) {
      expect(read(file), `${file} must canonicalise receipt_url`).toMatch(
        /body\.receipt_url = toStoredReceiptRef\(body\.receipt_url\)/
      );
    }
    expect(read('app/api/fuel/requests/route.js')).toMatch(
      /body\.gauge_photo_url = toStoredReceiptRef\(body\.gauge_photo_url\)/
    );
    // Canonicalising can fail, and a failure must not fall through to a write.
    expect(read('app/api/mobile/fuel/route.js')).toMatch(
      /if \(!body\.receipt_url\) return err\(/
    );
  });

  it('every reader of the two fuel columns re-signs them', () => {
    // The columns hold keys now, so a reader that returns the raw column hands
    // the UI something unrenderable. One place per route that serializes a row.
    for (const [file, fn] of [
      ['app/api/fuel/route.js', 'signFuelReceiptList'],
      ['app/api/fuel/[id]/route.js', 'signFuelReceipt'],
      ['app/api/fuel/requests/route.js', 'signFuelReceiptList'],
      ['app/api/admin/analytics/fuel/route.js', 'signFuelReceipt'],
      ['app/api/mobile/fuel/[id]/route.js', 'signFuelReceipt'],
      ['app/api/mobile/fuel/route.js', 'signFuelReceipt'],
    ]) {
      expect(read(file), `${file} must re-sign before responding`).toContain(fn);
    }
    // The scan endpoints fetch the value, so a key has to be resolved first.
    for (const file of ['app/api/mobile/fuel/scan/route.js', 'app/api/mobile/fuel/gauge-scan/route.js']) {
      expect(read(file), `${file} must resolve before fetching`).toMatch(/resolveFuelImageUrl\(/);
      expect(read(file), `${file} must not fetch the client string`).not.toMatch(/fetch\((receiptUrl|gaugeUrl)\)/);
    }
  });

  it('the other sensitive buckets keep their short, per-request lifetimes', () => {
    // The contrast used to be the finding. It is now the regression guard: these
    // were already correct and must not drift while the other two are brought in line.
    expect(read('lib/expenses/receipt-storage.js')).toMatch(/createSignedUrl\(storageKey, 3600\)/);
    expect(read('lib/driver/incident-storage.js')).toMatch(/createSignedUrl\(fileName, 60 \* 60\)/);
    expect(read('lib/fuel/receipt-storage.js')).toMatch(/FUEL_RECEIPT_TTL_SECONDS = 60 \* 60/);
    expect(read('app/api/driver/face-photo/route.js')).toMatch(/FACE_URL_TTL_SECONDS = 60 \* 60;/);
  });

  it('no ten-year constant survives anywhere in the storage code', () => {
    for (const file of [
      'lib/fuel/receipt-storage.js',
      'app/api/driver/face-photo/route.js',
      'lib/expenses/receipt-storage.js',
      'lib/driver/incident-storage.js',
    ]) {
      expect(read(file), `${file} still mints a ten-year URL`).not.toMatch(/60 \* 60 \* 24 \* 365 \* 10/);
    }
  });
});

describe('SEC-UPLOAD-003 (data residual) — the code is closed, the rows are not', () => {
  // A green suite here does NOT mean the tokens are gone. Applying the fix stops
  // new ones being minted; it does not revoke the ones already sitting in the
  // database, and those are live bearer credentials to anyone who can read a row.
  //
  // Live census, READ-ONLY, against dnxuphhxlzidvwtdqqkq on 2026-09-18
  // (scratch/census-media-refs.mjs, scratch/probe-legacy-token-liveness.mjs):
  //
  //   fuelrecords.receipt_url      7 legacy 10-year values — 1 object still
  //                                present, 6 whose object has since been deleted
  //   fuelrequests.gauge_photo_url 1 legacy 10-year value  — object still present
  //   drivers.face_image_url       1 legacy 10-year value  — object still present
  //   employees.avatar_url         1 legacy 10-year value  — same object as above
  //
  // So SEC-UPLOAD-003 was PARTIALLY CLOSED: code closed, data residual open.
  // `gauge_photo_url` was NOT in the approved plan's census — it is a second
  // writer of the same defect, found while implementing.
  //
  // Clearing the residual is `scripts/backfill-media-refs.mjs` — it rewrites those
  // rows to object keys, which is what makes the verdict CLOSED. It deliberately
  // does NOT revoke the tokens those rows already carried: a token copied into a
  // backup, a dump or a log line stays valid until 2036, and rewriting the row
  // does not reach out and take the copy back. That is a separate, named residual
  // exposure, and the tests below pin the decision rule the backfill uses.
  //
  // Rotating the storage key is NOT the alternative it looks like: Supabase signed
  // URLs are JWTs signed with the project JWT secret, and the `anon` and
  // `service_role` keys are signed with the same secret. Rotating it to kill four
  // tokens would invalidate both API keys — and the anon key ships inside
  // already-installed mobile builds, which cannot be updated remotely. The real
  // alternative is re-keying the object itself, so the old token 404s.

  const LEGACY = 'https://proj.supabase.co/storage/v1/object/sign/fuel-receipts/4/r.jpg?token=legacy-ten-year';

  it('a legacy ten-year fuel URL is RE-SIGNED on read, never returned as stored', async () => {
    const row = await signFuelReceipt({ fuel_record_id: 1, receipt_url: LEGACY });
    expect(row.receipt_url).not.toBe(LEGACY);
    expect(row.receipt_url).toContain('/object/sign/fuel-receipts/4/r.jpg');
    expect(createSignedUrlMock.mock.calls[0][1]).toBe(3600);
  });

  it('the same holds for a legacy gauge photo', async () => {
    const row = await signFuelReceipt({ fuel_request_id: 1, gauge_photo_url: LEGACY });
    expect(row.gauge_photo_url).not.toBe(LEGACY);
    expect(createSignedUrlMock.mock.calls[0][1]).toBe(3600);
  });

  it('a reference whose object is gone reads as nothing, not as a broken link', async () => {
    // Six of the seven residual fuel rows name objects that no longer exist.
    // Serving the stored URL would render a broken image; signing fails instead,
    // and the reader reports it rather than passing the dead link through.
    createSignedUrlMock.mockResolvedValueOnce({ data: null, error: { message: 'Object not found' } });
    const row = await signFuelReceipt({ fuel_record_id: 117, receipt_url: LEGACY });
    expect(row.receipt_url).toBeNull();
  });

  it('an absent column stays absent — the shape of the payload does not change', async () => {
    const row = await signFuelReceipt({ fuel_record_id: 1, amount: 100 });
    expect(row).not.toHaveProperty('receipt_url');
    expect(row).not.toHaveProperty('gauge_photo_url');
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SEC-UPLOAD-003 (data residual) — the backfill's decision rule
// ---------------------------------------------------------------------------

// `scripts/backfill-media-refs.mjs` decides per row whether to rewrite a stored
// value to an object key. These tests pin that decision, because the rule is what
// stands between "the residual is cleared" and "a value that could not be read was
// quietly turned into something else".
//
// The script uses the SAME functions asserted here — `canonicalStoredRef` to
// recover, `parseStoredKey` to read back the bucket — so a change to either cannot
// silently change what gets written without failing here first.
describe('SEC-UPLOAD-003 (backfill) — a value is rewritten only when it is recoverable AND the right bucket', () => {
  /**
   * The script's decision, restated. Kept in the test as the specification; the
   * last test below asserts the script itself composes exactly these two calls
   * rather than carrying its own copy of the recovery.
   */
  function decide(value, buckets) {
    const recovered = canonicalStoredRef(value, buckets[0]);
    if (!recovered) return { refuse: true };
    const bucket = parseStoredKey(recovered)?.bucket;
    if (!bucket || !buckets.includes(bucket)) return { refuse: true };
    return { write: recovered };
  }

  it('recovers a legacy ten-year fuel URL to a bucket-qualified key', () => {
    const decision = decide(
      'https://proj.supabase.co/storage/v1/object/sign/fuel-receipts/4/r.jpg?token=legacy-ten-year',
      ['fuel-receipts']
    );
    expect(decision.write).toBe('fuel-receipts/4/r.jpg');
    expect(parseStoredKey(decision.write).bucket).toBe('fuel-receipts');
    // The written value carries no token, no host and no expiry — that is the
    // whole difference between a key and the credential it replaced.
    expect(decision.write).not.toContain('http');
    expect(decision.write).not.toContain('token');
  });

  it('recovers a getPublicUrl value the same way — its path encodes the key too', () => {
    const decision = decide(
      'https://proj.supabase.co/storage/v1/object/public/driver-licenses/12/scan.jpg',
      ['driver-licenses']
    );
    expect(decision.write).toBe('driver-licenses/12/scan.jpg');
  });

  it('REFUSES when the URL names a bucket the column must not hold', () => {
    // The bucket comes from the URL's own path, so without this check a
    // fuelrecords row naming a face-capture would be rewritten into a key for an
    // object it never referenced — a silent repoint, not a repair.
    const decision = decide(
      'https://proj.supabase.co/storage/v1/object/sign/face-captures/4/r.jpg?token=x',
      ['fuel-receipts']
    );
    expect(decision.refuse).toBe(true);
    expect(decision.write).toBeUndefined();
  });

  it('REFUSES a foreign host shaped exactly like a storage URL', () => {
    const decision = decide(
      'https://evil.example/storage/v1/object/sign/fuel-receipts/4/r.jpg?token=x',
      ['fuel-receipts']
    );
    expect(decision.refuse).toBe(true);
  });

  it('REFUSES a traversal in the key', () => {
    for (const value of [
      'https://proj.supabase.co/storage/v1/object/sign/fuel-receipts/4/%2e%2e%2f9/r.jpg?token=x',
      'https://proj.supabase.co/storage/v1/object/sign/fuel-receipts/../../9/r.jpg?token=x',
    ]) {
      expect(decide(value, ['fuel-receipts']).refuse).toBe(true);
    }
  });

  it('REFUSES an ordinary external URL — the case that rules out a blanket http rewrite', () => {
    // `toStoredMediaRef` is `canonicalStoredRef(value, bucket) ?? value`, so
    // `employees.avatar_url` can legitimately hold an external URL that is not a
    // storage reference at all. A migration doing `WHERE avatar_url LIKE 'http%'`
    // would destroy it. This is why the backfill is a script that asks the
    // application's own recovery function, and not a SQL UPDATE.
    for (const value of [
      'https://cdn.example.com/avatars/12.jpg',
      'https://proj.supabase.co/not-a-storage-path',
    ]) {
      const decision = decide(value, ['face-captures', 'driver-licenses']);
      expect(decision.refuse).toBe(true);
      expect(decision.write).toBeUndefined();
    }
  });

  it('an already-migrated value is not a candidate at all', () => {
    // The script's SELECT is `WHERE col LIKE 'http%'`, so a key is never fed to
    // the recovery in the first place — that is what makes a re-run a no-op.
    expect('fuel-receipts/4/r.jpg'.startsWith('http')).toBe(false);
    expect(canonicalStoredRef('fuel-receipts/4/r.jpg', 'fuel-receipts')).toBe(
      'fuel-receipts/4/r.jpg'
    );
  });

  it('the script defaults to dry run, requires --apply, and carries no second recovery', () => {
    const source = repo('scripts/backfill-media-refs.mjs');
    // Dry run is the default: writing requires the explicit flag, and every write
    // is guarded by it.
    expect(source).toMatch(/const APPLY = process\.argv\.includes\("--apply"\)/);
    expect(source).toMatch(/if \(!APPLY\)/);
    // It composes the application's own functions rather than reimplementing the
    // recovery — a second implementation is a second thing to drift.
    expect(source).toMatch(/await import\("@\/lib\/storage\/object-refs"\)/);
    expect(source).toMatch(/canonicalStoredRef\(value, buckets\[0\]\)/);
    expect(source).toMatch(/await import\("@\/lib\/storage\/key-format"\)/);
    // It refuses to write anything at all when any value could not be recovered.
    expect(source).toMatch(/if \(refusals\.length\) \{[\s\S]*?process\.exit\(1\)/);
    // A token must never reach the manifest or the log.
    expect(source).toMatch(/function redact\(/);
    expect(source).not.toMatch(/console\.log\([^)]*\boriginal\b/);
  });
});

// ---------------------------------------------------------------------------
// SEC-UPLOAD-004 — the receipt-URL ownership predicate
// ---------------------------------------------------------------------------

describe('SEC-UPLOAD-004 — receipt-URL ownership is a substring match on a decoded path', () => {
  const driverPath = '/storage/v1/object/sign/fuel-receipts/4/';

  it('accepts a genuine signed URL for the driver', () => {
    expect(isOwnedFuelImageUrl(`https://proj.supabase.co${driverPath}${'a'.repeat(36)}.png?token=abc`, 4)).toBe(true);
    expect(isOwnedFuelReceiptUrl(`https://proj.supabase.co${driverPath}${'a'.repeat(36)}.png?token=abc`, 4)).toBe(true);
  });

  it('rejects a foreign host, a foreign driver and a token-less URL', () => {
    const tail = `${'a'.repeat(36)}.png?token=abc`;
    expect(isOwnedFuelImageUrl(`https://evil.example${driverPath}${tail}`, 4)).toBe(false);
    expect(isOwnedFuelImageUrl(`https://proj.supabase.co/storage/v1/object/sign/fuel-receipts/9/${tail}`, 4)).toBe(false);
    expect(isOwnedFuelImageUrl(`https://proj.supabase.co${driverPath}${'a'.repeat(36)}.png`, 4)).toBe(false);
    expect(isOwnedFuelImageUrl('not-a-url', 4)).toBe(false);
    expect(isOwnedFuelImageUrl(null, 4)).toBe(false);
  });

  it('the match is a raw path PREFIX, not a substring', () => {
    // `/…/sign/other-bucket/storage/v1/object/sign/fuel-receipts/4/x.png` used to
    // satisfy `includes` even though the object is not in this driver's folder.
    const smuggled = `https://proj.supabase.co/storage/v1/object/sign/other-bucket${driverPath}${'b'.repeat(36)}.png?token=abc`;
    expect(isOwnedFuelImageUrl(smuggled, 4)).toBe(false);
  });

  it('the raw path is compared, so an encoded separator is not decoded into a match', () => {
    const encoded = `https://proj.supabase.co/storage/v1/object/sign/fuel-receipts%2F4%2F${'c'.repeat(36)}.png?token=abc`;
    expect(isOwnedFuelImageUrl(encoded, 4)).toBe(false);
  });

  it('a folder parameter is honoured as whole segments', () => {
    const tail = `${'d'.repeat(36)}.png?token=abc`;
    expect(isOwnedFuelImageUrl(`https://proj.supabase.co/storage/v1/object/sign/fuel-receipts/4/trips/2026/${tail}`, 4, 'trips/2026')).toBe(true);
    // A sibling folder is not the watched one.
    expect(isOwnedFuelImageUrl(`https://proj.supabase.co/storage/v1/object/sign/fuel-receipts/4/trips/2025/${tail}`, 4, 'trips/2026')).toBe(false);
    // …and a folder the path never reaches is not a match.
    expect(isOwnedFuelImageUrl(`https://proj.supabase.co/storage/v1/object/sign/fuel-receipts/4/${tail}`, 4, 'trips/2026')).toBe(false);
  });

  it('an object KEY is accepted, and confined to the same prefix as the URL shape', () => {
    // The upload route hands the client `receipt_path` now, and the submit
    // endpoints accept it. Accepting a key is not a loosening: a key is not
    // fetchable, and the prefix still confines it to the driver's own folder —
    // the two shapes must not disagree about ownership.
    const uuid = `${'e'.repeat(36)}.png`;
    expect(isOwnedFuelReceiptUrl(`fuel-receipts/4/${uuid}`, 4)).toBe(true);
    expect(isOwnedFuelReceiptUrl(`4/${uuid}`, 4)).toBe(true);
    // The folder parameter belongs to the gauge variant, which is the only
    // caller that has one (`isOwnedFuelReceiptUrl` is deliberately 2-arg).
    expect(isOwnedFuelImageUrl(`fuel-receipts/4/gauge/${uuid}`, 4, 'gauge')).toBe(true);
    expect(isOwnedFuelImageUrl(`4/gauge/${uuid}`, 4, 'gauge')).toBe(true);

    // Another driver's folder, another bucket, and the folder itself.
    expect(isOwnedFuelReceiptUrl(`fuel-receipts/9/${uuid}`, 4)).toBe(false);
    expect(isOwnedFuelReceiptUrl(`face-captures/4/${uuid}`, 4)).toBe(false);
    expect(isOwnedFuelReceiptUrl('fuel-receipts/4', 4)).toBe(false);
    expect(isOwnedFuelReceiptUrl('4', 4)).toBe(false);
    // A sibling folder is not the watched one, in key form either.
    expect(isOwnedFuelImageUrl(`fuel-receipts/4/trips/2025/${uuid}`, 4, 'trips/2026')).toBe(false);
    expect(isOwnedFuelImageUrl(`fuel-receipts/4/trips/2026/${uuid}`, 4, 'trips/2026')).toBe(true);
    // …and a key the folder never reaches is not a match.
    expect(isOwnedFuelImageUrl(`fuel-receipts/4/${uuid}`, 4, 'trips/2026')).toBe(false);
    // Traversal, at either decoding.
    expect(isOwnedFuelReceiptUrl(`fuel-receipts/4/../../9/${uuid}`, 4)).toBe(false);
    expect(isOwnedFuelReceiptUrl(`fuel-receipts/4/%2e%2e/%2e%2e/9/${uuid}`, 4)).toBe(false);
  });

  it('a key that resolves to nothing fails closed rather than being stored raw', async () => {
    // The write paths canonicalise; if that yields nothing the request is
    // refused, because the alternative is writing an unreadable value into a
    // column the readers will try to sign.
    expect(toStoredReceiptRef('fuel-receipts/4/x.png')).toBe('fuel-receipts/4/x.png');
    expect(toStoredReceiptRef('4/x.png')).toBe('fuel-receipts/4/x.png');
    expect(toStoredReceiptRef('https://proj.supabase.co/storage/v1/object/sign/fuel-receipts/4/x.png?token=t')).toBe('fuel-receipts/4/x.png');
    expect(toStoredReceiptRef('https://evil.example/x.png')).toBeNull();
    expect(toStoredReceiptRef('face-captures/4/x.png')).toBe('face-captures/4/x.png');
    expect(toStoredReceiptRef(null)).toBeNull();
  });

  it('the scan endpoints sign the reference themselves instead of fetching it raw', async () => {
    // A key is not fetchable. Resolving it here also means the server fetches a
    // URL it minted rather than a string the caller chose.
    await resolveFuelImageUrl('fuel-receipts/4/x.png');
    expect(createSignedUrlMock.mock.calls[0]).toEqual(['fuel-receipts/4/x.png', FUEL_RECEIPT_TTL_SECONDS]);
    // An unresolvable reference returns null so the caller can fail closed.
    expect(await resolveFuelImageUrl('https://evil.example/x.png')).toBeNull();
    expect(await resolveFuelImageUrl('not a key or a url')).toBeNull();
  });

  it('IMPACT IS BOUNDED — the predicate is not the access boundary', () => {
    // Supabase validates the `token` against the object it names, so a URL that
    // passes this predicate but names someone else's object still fails at the
    // storage layer. The predicate decides which URLs the application is
    // willing to persist and re-serve; it does not grant the read. Reported LOW
    // for that reason — a false positive in a filter, not cross-driver access.
    const src = read('lib/fuel/receipt-storage.js');
    expect(src).toMatch(/url\.host === storageUrl\.host/);
    expect(src).toMatch(/Boolean\(url\.searchParams\.get\("token"\)\)/);
    // …and the containment test is a raw-path prefix, with no decode step that
    // could manufacture a match the real path never had.
    expect(src).not.toMatch(/decodeURIComponent\(url\.pathname\)/);
    expect(src).toMatch(/url\.pathname\.startsWith\(/);
  });
});

// ---------------------------------------------------------------------------
// SEC-UPLOAD-005 — incident photo references are accepted from any host
// ---------------------------------------------------------------------------

describe('SEC-UPLOAD-005 — incident evidence must point at fleet storage', () => {
  const driverRow = {
    driver_id: 4, first_name: 'Marco', last_name: 'Santos',
    employee_id: 2, assigned_vehicle_id: null,
  };

  const postIncident = photoUrls => createIncident(new Request('http://localhost/api/driver/incidents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      incident_type: 'Vehicle Damage', description: 'Scratch on the rear bumper.',
      severity: 'Minor', photo_urls: photoUrls, client_submission_id: 'a'.repeat(20),
    }),
  }));

  const insertedPhotos = () => {
    const insert = query.mock.calls.find(([sql]) => /INSERT INTO driverincidents/.test(String(sql)));
    return insert ? insert[1][14] : null;
  };

  beforeEach(() => {
    query.mockImplementation(async sql => {
      const s = String(sql);
      if (/FROM employees e/.test(s)) return { rows: [driverRow] };
      if (/INSERT INTO driverincidents/.test(s)) return { rows: [{ incident_id: 1, incident_type: 'Vehicle Damage', severity: 'Minor', status: 'Reported', vehicle_id: null, trip_id: null }] };
      return { rows: [] };
    });
  });

  it('a legitimate object path for this driver is accepted', async () => {
    const res = await postIncident([`4/${'a'.repeat(36)}.png`]);
    expect(res.status).not.toBe(400);
  });

  it('a legitimate signed URL on the fleet storage host is accepted', async () => {
    const own = `https://proj.supabase.co/storage/v1/object/sign/incident-evidence/4/${'a'.repeat(36)}.png?token=t`;
    expect((await postIncident([own])).status).not.toBe(400);
    expect(insertedPhotos()).toEqual([own]);
  });

  it("a path for another driver is refused", async () => {
    const res = await postIncident([`9/${'a'.repeat(36)}.png`]);
    expect(res.status).toBe(400);
    expect((await res.json()).details ?? (await Promise.resolve({}))).toBeTruthy();
  });

  it('a foreign-host URL is refused even though its path carries the driver prefix', async () => {
    // The stored value is bound to <img src> on the staff incident page and the
    // incident map, so accepting it made every reviewing staff browser call the
    // attacker's host — which also confirms to the attacker that an incident is
    // being reviewed, and when.
    const res = await postIncident(['https://evil.example/storage/v1/object/sign/incident-evidence/4/steal.png']);
    expect(res.status).toBe(400);
    expect(query.mock.calls.some(([sql]) => /INSERT INTO driverincidents/.test(String(sql)))).toBe(false);
  });

  it('credentialed, plain-tracker and metadata-service URLs are all refused', async () => {
    for (const bad of [
      'https://user:pass@evil.example/storage/v1/object/sign/incident-evidence/4/x.png',
      'https://evil.example/track.png',
      'http://169.254.169.254/storage/v1/object/sign/incident-evidence/4/x.png',
      'https://proj.supabase.co/storage/v1/object/sign/incident-evidence/9/x.png',
    ]) {
      expect((await postIncident([bad])).status, bad).toBe(400);
    }
  });

  it('the staff read path re-checks legacy absolute URLs instead of forwarding them', async () => {
    // Rows written before the write path was fixed can hold any URL. Both staff
    // viewers bind whatever comes back to an image source, so the allowlist has
    // to be applied on the way out too — a foreign reference is dropped, not
    // returned.
    const urls = await getIncidentPhotoUrls([
      'https://evil.example/tracker.gif',
      'http://169.254.169.254/latest/meta-data/',
      '4/real-object.png',
    ]);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('incident-evidence/4/real-object.png');
    expect(read('lib/driver/incident-storage.js')).toMatch(/isSafeRemoteMediaUrl\(ref\)/);
  });

  it('the write path uses the shared allowlist the sibling endpoints already use', () => {
    for (const file of ['app/api/ai/scan-document/route.js', 'app/api/driver/face-photo/route.js', 'app/api/driver/license-scan/route.js']) {
      expect(read(file)).toMatch(/isSafeRemoteMediaUrl\(/);
    }
    expect(read('lib/driver/incident-storage.js')).toMatch(/isSafeRemoteMediaUrl/);
    expect(read('app/api/driver/incidents/route.js')).toMatch(/isSafeRemoteMediaUrl\(value\)/);
  });

  it('the stored URL is still rendered as an image by every staff viewer', () => {
    // The renderers are unchanged and deliberately so — the validator is the
    // boundary. This asserts the boundary is real, not that the render is safe.
    const page = read('app/(dashboard)/incidents/page.js');
    expect(page).toMatch(/<img src=\{url\}/);
    expect(page).toMatch(/setFullScreenImage\(url\)/);
    const map = read('components/maps/incident-map.jsx');
    expect(map).toMatch(/<img src=\{url\}/);
    expect(map).toMatch(/setFullScreenImage\(url\)/);
  });
});

// ---------------------------------------------------------------------------
// SEC-UPLOAD-006 — a government ID is stored via a public-URL helper
// ---------------------------------------------------------------------------

describe('SEC-UPLOAD-006 — the license scan writes a public-style URL for a private bucket', () => {
  const scan = () => read('app/api/driver/license-scan/route.js');

  it('CLOSED — the scan stores the object key, and no getPublicUrl call remains', () => {
    // REWRITTEN 2026-09-18. This test previously asserted the DEFECT, pinning
    // `getPublicUrl(fileName)` and `not.toMatch(/createSignedUrl/)` as its
    // evidence. Per the standing rule a finding's test is rewritten to assert the
    // new contract, never deleted or relaxed — so it now asserts what replaced
    // it. The historical note above the code still names getPublicUrl(); the
    // assertion is on the CALL (`.getPublicUrl(`), which is what was removed.
    expect(scan()).toMatch(/\.from\("driver-licenses"\)/);
    expect(scan()).not.toMatch(/\.getPublicUrl\(/);
    // What is persisted is the key, bucket-qualified.
    expect(scan()).toMatch(/canonicalStoredRef\(fileName, "driver-licenses"\)/);
    expect(scan()).toMatch(/UPDATE drivers SET \$\{setClauses\.join\(", "\)\}/);
    const drivers = read('app/api/drivers/route.js');
    // The mirror to the employee avatar still exists — that is this finding's
    // point. The value mirrored is now the canonical STORED form, so the guard
    // moved with the variable it guards. REWRITTEN 2026-09-18 (SEC-UPLOAD-008):
    // this assertion previously pinned the weak form,
    // `license_image_url.startsWith("http")`, which admitted any host; it is now
    // the shared allow-list.
    expect(drivers).toMatch(/avatar_url: \(storedLicenceFront && .*isAllowedStoredImageRef\(storedLicenceFront\)/);
  });

  it('every reader of the licence columns signs them, so the UI needs no change', () => {
    // The key is not renderable, so each route that serializes a driver resolves
    // it at the API boundary. Missing one would leave that surface binding a
    // bare key to an <img src>.
    expect(read('app/api/drivers/route.js')).toMatch(/signDriverMediaList\(filtered\)/);
    expect(read('app/api/drivers/route.js')).toMatch(/return ok\(await signDriverMedia\(rows\[0\]\), 201\)/);
    expect(read('app/api/drivers/[id]/route.js')).toMatch(/await signDriverMedia\(\{/);
    expect(read('app/api/auth/profile/route.js')).toMatch(/await signDriverMedia\(raw\)/);
    expect(read('app/api/driver/me/route.js')).toMatch(/await signDriverMedia\(driver\)/);
  });

  it('the write paths canonicalise, so a signed URL echoed back is not persisted', () => {
    // The readers hand the admin form and the driver a short-lived signed URL
    // and both submit it back on the next save. Storing that would make the
    // image rot when the URL expires — the SEC-UPLOAD-003 defect, re-created
    // through the read path this finding's fix introduced.
    expect(read('app/api/drivers/route.js')).toMatch(/toStoredMediaRef\(license_image_url, "driver-licenses"\)/);
    expect(read('app/api/drivers/[id]/route.js')).toMatch(/toStoredMediaRef\(license_image_url, "driver-licenses"\)/);
    expect(read('app/api/driver/me/route.js')).toMatch(/toStoredMediaRef\(body\.face_image_url, "face-captures"\)/);
  });

  it('the bucket migration declares it private, so the helper is also simply wrong', () => {
    // getPublicUrl builds a /object/public/ URL without contacting storage. On a
    // private bucket that URL does not authorize: the desk-facing "license
    // image" is a 400. So as the repository stands the defect is functional.
    const migration = readFileSync(new URL('../../supabase/migrations/070_driver_licenses_bucket.sql', import.meta.url), 'utf8');
    expect(migration).toMatch(/VALUES \('driver-licenses', 'driver-licenses', false\)/);
  });

  it('RESOLVED AGAINST LIVE — the bucket flag was read, and it is private', () => {
    // This test previously read NEEDS VERIFICATION: exposure ranged from LOW
    // (bucket private — a dead link) to MEDIUM/HIGH (bucket public — an
    // unauthenticated permanent link to a photograph of a government ID), and
    // only the live project could settle which.
    //
    // Step 0 of the remediation read `SELECT id, public FROM storage.buckets;`
    // against the live project (dnxuphhxlzidvwtdqqkq) on 2026-09-18:
    // `driver-licenses` is PRIVATE. So the public-style URL never authorized —
    // the defect was a functional bug, not an exposure, and the live-database
    // census agrees: `drivers.license_image_url` and `license_back_image_url`
    // held ZERO non-empty values across 40 rows, so no stored value was ever
    // affected. Severity LOW, now closed at the write path.
    expect(scan()).toMatch(/driver-licenses/);
  });
});

// ---------------------------------------------------------------------------
// SEC-UPLOAD-006 (reader) — the compatibility path for already-stored URLs
//
// The columns written before this change hold URLs, and the approved
// remediation deliberately does not rewrite them. So the reader has to resolve
// both shapes — and it does it by RECOVERING the object key from the URL's own
// path, never by trusting the URL.
//
// That distinction is the whole of acceptance condition 2. A host allow-list
// cannot substitute for it: the getPublicUrl value SEC-UPLOAD-006 wrote has an
// allow-listed host, so a pass-through would wave it straight through — serving
// a dead image AND perpetuating a public-style reference to a government ID,
// which is the finding itself. The assertions below are written so that an
// implementation which merely returns its input FAILS them.
// ---------------------------------------------------------------------------

describe('SEC-UPLOAD-006 (reader) — a legacy URL is recovered, not passed through', () => {
  const publicStyle = (bucket, key) => `https://proj.supabase.co/storage/v1/object/public/${bucket}/${key}`;
  const signedStyle = (bucket, key) => `https://proj.supabase.co/storage/v1/object/sign/${bucket}/${key}?token=legacy-ten-year-token`;

  it('a stored object key is signed bucket-qualified, for one hour', async () => {
    const url = await signedUrlFor('driver-licenses', 'driver-licenses/12/scan.jpg');
    expect(createSignedUrlMock).toHaveBeenCalledWith('driver-licenses/12/scan.jpg', 3600);
    expect(url).toContain('/object/sign/driver-licenses/12/scan.jpg');
  });

  it('a BARE key is signed against the column it came from', async () => {
    // Older readers and the `employees.avatar_url` mirror can hand over a key
    // with no bucket prefix; the column decides.
    await signedUrlFor('driver-licenses', '12/scan.jpg');
    expect(createSignedUrlMock).toHaveBeenCalledWith('driver-licenses/12/scan.jpg', 3600);
  });

  it('a qualified key wins over the column, so a copied value stays resolvable', async () => {
    // employees.avatar_url receives both face-capture and licence keys, so the
    // value itself has to be authoritative.
    await signedUrlFor(['face-captures', 'driver-licenses'], 'driver-licenses/12/scan.jpg');
    expect(createSignedUrlMock).toHaveBeenCalledWith('driver-licenses/12/scan.jpg', 3600);
  });

  it('ACCEPTANCE 2 — a legacy getPublicUrl value is recovered and re-signed, never returned', async () => {
    const legacy = publicStyle('driver-licenses', '12/scan.jpg');
    const url = await signedUrlFor('driver-licenses', legacy);

    // Each of these fails against a pass-through implementation — which is the
    // design this replaced, and the reason the condition was imposed.
    expect(url).not.toBe(legacy);
    expect(url).not.toContain('/object/public/');
    expect(url).toContain('/object/sign/driver-licenses/12/scan.jpg');
    // The key came out of the path, so the object really is the one named.
    expect(createSignedUrlMock).toHaveBeenCalledWith('driver-licenses/12/scan.jpg', 3600);
  });

  it('a legacy ten-year signed URL is re-signed short, so the stored token does not ship', async () => {
    const legacy = signedStyle('driver-licenses', '12/scan.jpg');
    const url = await signedUrlFor('driver-licenses', legacy);
    expect(url).not.toBe(legacy);
    expect(url).not.toContain('legacy-ten-year-token');
    expect(createSignedUrlMock).toHaveBeenCalledWith('driver-licenses/12/scan.jpg', 3600);
  });

  it('an unrecoverable reference fails closed and signs nothing', async () => {
    const bad = [
      // A host outside the fleet allow-list, even with a matching path.
      'https://evil.example/storage/v1/object/public/driver-licenses/12/scan.jpg',
      'http://169.254.169.254/storage/v1/object/sign/driver-licenses/12/x.png?token=t',
      'https://user:pass@proj.supabase.co/storage/v1/object/public/driver-licenses/12/x.png',
      // A path naming a DIFFERENT bucket than the column owns.
      publicStyle('fuel-receipts', '12/scan.jpg'),
      // Traversal, in both the plain and the percent-encoded form.
      '../../other-bucket/scan.jpg',
      'https://proj.supabase.co/storage/v1/object/public/driver-licenses/12/%2e%2e%2f9/scan.jpg',
      // Allow-listed host, but not a storage URL at all.
      'https://proj.supabase.co/not-a-storage-path',
    ];
    for (const ref of bad) {
      expect(await signedUrlFor('driver-licenses', ref), ref).toBeNull();
    }
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it('an inline data: image passes through; a malformed one does not', async () => {
    const inline = 'data:image/png;base64,iVBORw0KGgo=';
    expect(await signedUrlFor('driver-licenses', inline)).toBe(inline);
    // isSafeRemoteMediaUrl alone returns true for any `data:image/` prefix
    // (remote-url.js:34), which would admit this.
    expect(await signedUrlFor('driver-licenses', 'data:image/svg+xml,<svg onload=alert(1)>')).toBeNull();
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it('the array form drops unresolvable entries rather than forwarding them', async () => {
    const urls = await signRefs('incident-evidence', [
      'https://evil.example/tracker.gif',
      '4/real-object.png',
      'https://proj.supabase.co/storage/v1/object/public/incident-evidence/4/legacy.png',
    ]);
    expect(urls).toHaveLength(2);
    expect(urls.some((u) => u.includes('evil.example'))).toBe(false);
    expect(urls.every((u) => u.includes('/object/sign/incident-evidence/4/'))).toBe(true);
  });

  it('canonicalStoredRef reduces an echoed URL back to the key it was signed from', async () => {
    // This is what stops the admin edit form persisting the short-lived URL the
    // reader just minted, on every unrelated save.
    expect(canonicalStoredRef(publicStyle('driver-licenses', '12/scan.jpg'), 'driver-licenses')).toBe('driver-licenses/12/scan.jpg');
    expect(canonicalStoredRef(signedStyle('driver-licenses', '12/scan.jpg'), 'driver-licenses')).toBe('driver-licenses/12/scan.jpg');
    expect(canonicalStoredRef('12/scan.jpg', 'driver-licenses')).toBe('driver-licenses/12/scan.jpg');
    expect(canonicalStoredRef('driver-licenses/12/scan.jpg', 'driver-licenses')).toBe('driver-licenses/12/scan.jpg');
    // A value the reader cannot resolve is not reduced to anything, so the
    // caller keeps what it had — and validateBody has already refused it.
    expect(canonicalStoredRef('https://evil.example/x.png', 'driver-licenses')).toBeNull();
    expect(canonicalStoredRef('javascript:alert(1)', 'driver-licenses')).toBeNull();
    expect(canonicalStoredRef('12/scan.jpg', 'vehicle-images')).toBeNull();
  });

  it('objectKeyFromStorageUrl is the recovery primitive, and it is exact', () => {
    // A key is recovered from the path of a URL that names THIS bucket, and from
    // nothing else.
    expect(objectKeyFromStorageUrl(publicStyle('driver-licenses', '12/scan.jpg'), 'driver-licenses')).toBe('12/scan.jpg');
    // A dot segment is a traversal, not a filename — decode-then-match must not
    // manufacture a key the real path never had.
    expect(objectKeyFromStorageUrl(publicStyle('driver-licenses', '../../9/scan.jpg'), 'driver-licenses')).toBeNull();
    expect(objectKeyFromStorageUrl(publicStyle('driver-licenses', '12/..'), 'driver-licenses')).toBeNull();
    // A bucket that holds personal media is addressed by exactly one path.
    expect(objectKeyFromStorageUrl(publicStyle('driver-licenses', '12/scan.jpg'), 'fuel-receipts')).toBeNull();
    expect(objectKeyFromStorageUrl(publicStyle('driver-licenses', '12/scan.jpg'), null)).toBeNull();
    expect(objectKeyFromStorageUrl(null, 'driver-licenses')).toBeNull();
    // The segment charset is a whitelist covering what this repo mints
    // (<digits>, uuid, validated extension, folder slug) — so a key carrying
    // anything else is refused rather than guessed at. No producer emits one.
    expect(objectKeyFromStorageUrl(publicStyle('driver-licenses', '12/a b.jpg'), 'driver-licenses')).toBeNull();
  });

  it('a value with no scheme separator is not mistaken for an object key', () => {
    // `javascript:alert(1)` has no "://", so it splits into ONE well-formed
    // segment. Without a charset rule on the segment it parsed as a bare object
    // key, and isAllowedStoredImageRef then accepted it as a storable image
    // reference — the shape of input a media column is most likely to be
    // attacked with. Found by the SEC-UPLOAD-008 suite during implementation.
    expect(isAllowedStoredImageRef('javascript:alert(1)')).toBe(false);
    expect(isAllowedStoredImageRef('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isAllowedStoredImageRef('12/scan.jpg')).toBe(true);
    expect(isAllowedStoredImageRef('driver-licenses/12/scan.jpg')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SEC-UPLOAD-007 — bucket visibility matrix (regression freeze)
// ---------------------------------------------------------------------------

describe('SEC-UPLOAD-007 — bucket visibility as declared by the migrations', () => {
  const migration = n => repo(`supabase/migrations/${n}`);

  it('every bucket holding personal media is declared private', () => {
    expect(migration('006_driver_attendance_face.sql')).toMatch(/VALUES \('face-captures', 'face-captures', false\)/);
    expect(migration('039_fuel_receipts_bucket.sql')).toMatch(/VALUES \('fuel-receipts', 'fuel-receipts', false\)/);
    expect(migration('065_incident_photos.sql')).toMatch(/VALUES \('incident-evidence', 'incident-evidence', false\)/);
    expect(migration('070_driver_licenses_bucket.sql')).toMatch(/VALUES \('driver-licenses', 'driver-licenses', false\)/);
    expect(migration('092_expense_records.sql')).toMatch(/VALUES \('expense-receipts', 'expense-receipts', false\)/);
  });

  it('the one public bucket is vehicle photography only', () => {
    expect(migration('050_vehicle_images_bucket.sql')).toMatch(/VALUES \('vehicle-images', 'vehicle-images', true\)/);
    expect(repo('scripts/create-bucket.mjs')).toMatch(/createBucket\('vehicle-images', \{ public: true \}\)/);
  });

  it('no migration declares a bucket public that is then used for personal media', () => {
    // Guards against a future edit quietly making a sensitive bucket public.
    for (const n of ['006_driver_attendance_face.sql', '039_fuel_receipts_bucket.sql', '065_incident_photos.sql', '070_driver_licenses_bucket.sql', '092_expense_records.sql']) {
      expect(migration(n), `${n} must not declare its bucket public`).not.toMatch(/storage\.buckets[^;]*true\s*\)\s*ON CONFLICT/s);
    }
  });
});

// ---------------------------------------------------------------------------
// SEC-UPLOAD-008 — the admin driver routes persisted an unvalidated media ref
//
// MEDIUM. POST /api/drivers and PUT /api/drivers/[id] destructured
// license_image_url / license_back_image_url from the request body and wrote
// them straight to the row, with the field absent from validateBody entirely.
// The value crosses a trust boundary: it binds to an <img src> for OTHER staff
// (drivers/[id]/page.js:121, and employees.avatar_url through the copies at
// route.js:339 / [id]/route.js:228), which render in the global chrome
// (app-shell.jsx:348, user-dropdown.jsx:52). A foreign host there is a
// beacon that reports each viewer's IP, and CSP img-src narrowing was the only
// control behind it.
//
// Bounded deliberately, and the bound is the reason this is MEDIUM and not
// HIGH: the writer must already hold drivers:create / drivers:update, so this
// is not privilege escalation, not an auth bypass, and not stored XSS (<img>
// does not execute script). The driver self-service route was already strict.
//
// Live-data note (2026-09-18 census): drivers.license_image_url and
// license_back_image_url hold ZERO non-empty values across 40 rows, so this
// finding never manifested in stored data — it is a live defect in the WRITE
// PATH, not an exposure of existing records.
// ---------------------------------------------------------------------------

describe('SEC-UPLOAD-008 — an unvalidated media reference reached a durable column', () => {
  const container = { params: Promise.resolve({ id: '1' }) };

  const post = body => createDriver(new Request('http://localhost/api/drivers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      first_name: 'Marco', last_name: 'Santos', license_number: 'N01-23-456789', ...body,
    }),
  }));

  const put = body => updateDriver(new Request('http://localhost/api/drivers/1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), container);

  const wroteRow = () => query.mock.calls.some(([sql]) => /INSERT INTO|UPDATE drivers/i.test(String(sql)));

  beforeEach(() => {
    query.mockResolvedValue({ rows: [] });
  });

  it('FINDING — a foreign host is refused on create, and nothing is written', async () => {
    const res = await post({ license_image_url: 'https://attacker.example/beacon.png' });
    // The assertion that fails against the pre-fix code: it returned 200 and
    // the insert carried the foreign URL.
    expect(res.status).toBe(400);
    const payload = await res.json();
    expect(JSON.stringify(payload)).toMatch(/fleet storage/i);
    expect(wroteRow(), 'no row may be written for a rejected reference').toBe(false);
  });

  it('FINDING — the back scan and the update route are guarded the same way', async () => {
    const created = await post({ license_back_image_url: 'https://attacker.example/beacon.png' });
    expect(created.status).toBe(400);

    const updated = await put({ license_back_image_url: 'https://attacker.example/beacon.png' });
    expect(updated.status).toBe(400);

    const front = await put({ license_image_url: 'https://attacker.example/beacon.png' });
    expect(front.status).toBe(400);
  });

  it('other schemes and smuggled credentials do not slip through either', async () => {
    for (const value of [
      'javascript:alert(1)',
      '//attacker.example/x.png',
      'http://169.254.169.254/latest/meta-data/',
      'data:image/svg+xml,<svg onload=alert(1)>',
    ]) {
      const res = await post({ license_image_url: value });
      expect(res.status, `${value} must be refused`).toBe(400);
    }
  });

  it('the rule accepts every shape this repo actually produces — the over-tightening guard', () => {
    // Cached hosts are read lazily on first call (remote-url.js:10-25), so this
    // file's env assignment at the top has already landed by the time any test
    // runs. Build the URL from env rather than hardcoding a host.
    const supabaseHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host;

    // license-scan/route.js mints this via getPublicUrl.
    expect(isAllowedStoredImageRef(`https://${supabaseHost}/storage/v1/object/public/driver-licenses/4/a.png`)).toBe(true);
    // The admin forms send FileReader.readAsDataURL / canvas.toDataURL output.
    expect(isAllowedStoredImageRef('data:image/jpeg;base64,/9j/4AAQSkZJRg==')).toBe(true);
    expect(isAllowedStoredImageRef('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    // Empty stays empty: validateField short-circuits before the rule is reached
    // (helpers.js:130), so clearing the field is not a validation failure.
    expect(isAllowedStoredImageRef('')).toBe(false);
    expect(isAllowedStoredImageRef(null)).toBe(false);
  });

  it('the strict data: branch is deliberate — the guard alone would be looser', () => {
    // isSafeRemoteMediaUrl returns true for ANY data:image/ prefix
    // (remote-url.js:34). isAllowedStoredImageRef routes data: to the strict
    // base64 check instead, so a malformed payload is not accepted just because
    // it starts with the right characters.
    expect(isAllowedStoredImageRef('data:image/svg+xml,<svg onload=alert(1)>')).toBe(false);
    expect(isBase64DataUrl('data:image/svg+xml,<svg onload=alert(1)>')).toBe(false);
  });

  it('every site is wired to the shared rule, and the weak prefix test is gone', () => {
    const drivers = read('app/api/drivers/route.js');
    const edit = read('app/api/drivers/[id]/route.js');

    for (const [name, src] of [['drivers/route.js', drivers], ['drivers/[id]/route.js', edit]]) {
      expect(src, `${name} must validate the front scan`).toMatch(/license_image_url:\s*\{\s*type:\s*"mediaUrl"/);
      expect(src, `${name} must validate the back scan`).toMatch(/license_back_image_url:\s*\{\s*type:\s*"mediaUrl"/);
      // REWRITTEN 2026-09-18 (SEC-UPLOAD-006): the guard now sits on the
      // canonicalised value, so the identifier it names moved from the request
      // field to the stored form. The contract is unchanged — the avatar copy
      // still routes through the shared allow-list.
      expect(src, `${name} must route the avatar copy through the allow-list`).toMatch(/isAllowedStoredImageRef\(storedLicenceFront\)/);
      expect(src, `${name} must not keep the startsWith("http") prefix test`).not.toMatch(/license_image_url\.startsWith\("http"\)/);
    }
  });

  it('an absent, null or cleared field is not a failure — partial updates survive', () => {
    // validateField short-circuits for undefined/null/"" BEFORE the type map
    // (helpers.js:130), so editing an unrelated field never 400s on the image
    // columns. This is the regression that would break the whole admin edit
    // form, and the reason the field needed no `optional` flag: the edit form
    // always sends the column (edit/page.js:295), as a value or as null.
    const schema = {
      driver_status: { maxLength: 30, label: 'Driver status' },
      license_image_url: { type: 'mediaUrl', label: 'License front scan' },
    };
    expect(validateBody({ driver_status: 'Available' }, schema)).toEqual({});
    expect(validateBody({ license_image_url: null }, schema)).toEqual({});
    expect(validateBody({ license_image_url: '' }, schema)).toEqual({});
    expect(validateBody({ license_image_url: 'https://attacker.example/x.png' }, schema)).not.toEqual({});
  });

  it('the driver self-service route stays stricter, not looser', () => {
    // Regression guard: /api/driver/me was already strict, and closing the admin
    // routes must not be read as licence to relax it.
    const me = read('app/api/driver/me/route.js');
    expect(me).toMatch(/license_image_url:\s*\{\s*type:\s*"base64Url"/);
    expect(me).toMatch(/isBase64DataUrl\(body\.license_image_url\)/);
  });
});
