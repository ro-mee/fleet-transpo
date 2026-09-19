// Backfill the legacy long-TTL media URLs in the durable columns to object keys.
//
// SEC-UPLOAD-003 closed at the write path on 2026-09-18 (nothing mints a ten-year
// signed URL any more, and every reader signs per view). This script closes the
// DATA half: the rows written before that change still hold a ten-year bearer
// token in a plain column, and a token in a column cannot be revoked.
//
// Run it with the repo's alias loader, because it imports the application's own
// recovery function rather than a second copy of it:
//
//   node --import ./scripts/alias-loader.mjs scripts/backfill-media-refs.mjs --dry-run
//   node --import ./scripts/alias-loader.mjs scripts/backfill-media-refs.mjs --apply
//   # or: npm run db:backfill-media -- --dry-run
//
// (`scripts/alias-loader.mjs` exists to resolve the `@/` alias for plain `node`
// runs — Next.js does it at build time. Without the loader the `@/` imports below
// fail to resolve. `scripts/verify-fuel-requests.mjs` uses the same mechanism.)
//
// WHY THIS IS NOT A MIGRATION. The obvious vehicle is `supabase/migrations/116_*.sql`
// and there is a precedent (`112_backfill_registration_expiry.sql`). But
// `canonicalStoredRef` recovers a key only when the URL's host passes the shared
// allow-list (`isSafeRemoteMediaUrl`, which reads NEXT_PUBLIC_SUPABASE_URL and
// NEXT_PUBLIC_APP_URL from the environment). SQL cannot read that, so a migration
// would have to hardcode a host into a versioned file — and a wrong hardcode would
// silently rewrite a FOREIGN-HOST row the application itself refuses to touch.
// Environment-derived allow-lists do not belong in SQL.
//
// DRY RUN IS THE DEFAULT. `--apply` is required to write anything, and `--apply`
// refuses to run at all if any candidate cannot be recovered — see below.
//
// Idempotent by construction: after one successful run no value in these columns
// matches `LIKE 'http%'`, so a re-run finds nothing and writes nothing.

import { loadEnvLocal } from "./load-env.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

loadEnvLocal();

// Dynamic, so the env above is loaded before these modules are evaluated.
const { canonicalStoredRef } = await import("@/lib/storage/object-refs");
const { parseStoredKey } = await import("@/lib/storage/key-format");
const { AVATAR_BUCKETS } = await import("@/lib/drivers/media");

const APPLY = process.argv.includes("--apply");

/**
 * The columns that can hold a stored media reference, and the buckets each may
 * legitimately name.
 *
 * `employees.avatar_url` is the one column that takes two buckets — the face-photo
 * route writes a face-capture into it and the licence mirror copies a licence key
 * in — so it uses the same candidate list `lib/auth.js` and `lib/drivers/media.js`
 * use rather than a hand-written copy.
 */
const TARGETS = [
  { table: "fuelrecords", column: "receipt_url", id: "fuel_record_id", buckets: ["fuel-receipts"] },
  { table: "fuelrequests", column: "gauge_photo_url", id: "fuel_request_id", buckets: ["fuel-receipts"] },
  { table: "drivers", column: "face_image_url", id: "driver_id", buckets: ["face-captures"] },
  { table: "employees", column: "avatar_url", id: "employee_id", buckets: AVATAR_BUCKETS },
  { table: "drivers", column: "license_image_url", id: "driver_id", buckets: ["driver-licenses"] },
  { table: "drivers", column: "license_back_image_url", id: "driver_id", buckets: ["driver-licenses"] },
];

/**
 * A signed URL's query string IS the bearer token. Never print it, never log it,
 * never put it in the manifest — the manifest is written to disk and a token in a
 * file is the exact defect this script exists to remove.
 */
function redact(value) {
  const s = String(value ?? "");
  const cut = s.indexOf("?");
  const head = cut === -1 ? s : `${s.slice(0, cut)}?<redacted>`;
  return head.length > 140 ? `${head.slice(0, 140)}…` : head;
}

/**
 * Decide what a candidate value should become.
 *
 * Pure composition of the app's own functions — there is deliberately no second
 * recovery implementation here, because a second one is a second thing to drift.
 *
 * @returns {{write: string}|{refuse: string}} `refuse` carries the reason.
 */
function decide(value, buckets) {
  // Recovers a key only from a storage URL whose host passes the shared
  // allow-list. Returns null for a foreign host, a non-storage URL, a `..`
  // traversal, or a percent-escaped key — every case that must stop and report.
  const recovered = canonicalStoredRef(value, buckets[0]);
  if (!recovered) {
    return { refuse: "not a recoverable storage reference for this column" };
  }
  // The bucket comes from the URL's own path, so it has to be checked against
  // what this column is allowed to hold — otherwise a row naming the wrong
  // bucket would be rewritten into a key for an object it never referenced.
  const bucket = parseStoredKey(recovered)?.bucket;
  if (!bucket || !buckets.includes(bucket)) {
    return { refuse: `names bucket "${bucket ?? "?"}", which this column must not hold` };
  }
  return { write: recovered };
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const plan = [];
const refusals = [];
let scanned = 0;

for (const target of TARGETS) {
  const { table, column, id, buckets } = target;
  // `LIKE 'http%'` and not "any non-empty value": `toStoredMediaRef` is
  // `canonicalStoredRef(value, bucket) ?? value`, so `employees.avatar_url` can
  // legitimately hold an ordinary external URL that must be left alone. A blanket
  // rewrite of every http value in that column would destroy one.
  const { rows } = await client.query(
    `SELECT ${id} AS id, ${column} AS value FROM ${table} WHERE ${column} LIKE 'http%' ORDER BY ${id}`
  );
  for (const row of rows) {
    scanned += 1;
    const verdict = decide(row.value, buckets);
    const entry = {
      table,
      column,
      id: row.id,
      from: redact(row.value),
      to: verdict.write ?? null,
    };
    if (verdict.write) plan.push({ ...entry, original: row.value });
    else refusals.push({ ...entry, reason: verdict.refuse });
  }
}

// ── Report ────────────────────────────────────────────────────────────────────

console.log(`\n=== media-ref backfill ${APPLY ? "(APPLY)" : "(DRY RUN)"} ===\n`);
console.log(`  candidates scanned : ${scanned}`);
console.log(`  recoverable        : ${plan.length}`);
console.log(`  refused            : ${refusals.length}`);

const byColumn = new Map();
for (const e of [...plan, ...refusals]) {
  const key = `${e.table}.${e.column}`;
  const n = byColumn.get(key) ?? { plan: 0, refuse: 0 };
  n[e.to ? "plan" : "refuse"] += 1;
  byColumn.set(key, n);
}
console.log("\n  per column:");
for (const [key, n] of byColumn) {
  console.log(`    ${key.padEnd(38)} recover=${n.plan} refuse=${n.refuse}`);
}

if (plan.length) {
  console.log("\n  would rewrite:");
  for (const e of plan) {
    console.log(`    ${e.table}.${e.column}[${e.id}]`);
    console.log(`      from: ${e.from}`);
    console.log(`      to:   ${e.to}`);
  }
}

if (refusals.length) {
  console.log("\n  REFUSED — these are reported, never passed through and never rewritten:");
  for (const e of refusals) {
    console.log(`    ${e.table}.${e.column}[${e.id}] — ${e.reason}`);
    console.log(`      value: ${e.from}`);
  }
}

// ── Manifest ─────────────────────────────────────────────────────────────────
// The review artifact. Written to scratch/ (untracked) because it records row
// ids and redacted values; it must not be committed.

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = resolve(process.cwd(), "scratch");
mkdirSync(dir, { recursive: true });
const manifestPath = resolve(dir, `backfill-media-refs-${stamp}.json`);
writeFileSync(
  manifestPath,
  JSON.stringify(
    {
      ranAt: new Date().toISOString(),
      mode: APPLY ? "apply" : "dry-run",
      project: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "http://unknown").host,
      scanned,
      recoverable: plan.length,
      refused: refusals.length,
      rewrites: plan.map(({ table, column, id, from, to }) => ({ table, column, id, from, to })),
      refusals: refusals.map(({ table, column, id, from, reason }) => ({ table, column, id, from, reason })),
    },
    null,
    2
  ),
  "utf8"
);
console.log(`\n  manifest: ${manifestPath}`);

// ── Apply ────────────────────────────────────────────────────────────────────

if (refusals.length) {
  console.log(
    `\n  STOP — ${refusals.length} value(s) could not be recovered. Nothing was written.\n` +
      "  Do not clean these by hand: an unrecoverable value is a finding, not a mess.\n"
  );
  await client.end();
  process.exit(1);
}

if (!APPLY) {
  console.log(`\n  DRY RUN — nothing written. Re-run with --apply to write ${plan.length} row(s).\n`);
  await client.end();
  process.exit(0);
}

if (!plan.length) {
  console.log("\n  Nothing to do — no column holds a legacy http value.\n");
  await client.end();
  process.exit(0);
}

// One transaction, all rows or none. The WHERE re-asserts the value we read, so a
// concurrent write between the SELECT and here is not clobbered — the row simply
// does not match and the count comes back short, which aborts.
try {
  await client.query("BEGIN");
  let updated = 0;
  for (const e of plan) {
    const res = await client.query(
      `UPDATE ${e.table} SET ${e.column} = $1 WHERE ${e.id} = $2 AND ${e.column} = $3`,
      [e.to, e.id, e.original]
    );
    updated += res.rowCount;
    if (res.rowCount !== 1) {
      throw new Error(
        `${e.table}.${e.column}[${e.id}] matched ${res.rowCount} rows, expected 1 — the value changed underneath this run`
      );
    }
  }
  await client.query("COMMIT");
  console.log(`\n  applied: ${updated} row(s) rewritten to object keys.\n`);
} catch (error) {
  await client.query("ROLLBACK");
  console.error(`\n  FAILED, rolled back: ${error.message}\n`);
  await client.end();
  process.exit(1);
}

await client.end();
