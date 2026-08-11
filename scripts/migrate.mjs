// Migration runner with a schema_migrations ledger.
//
// Replaces the nine one-off root scripts (apply029.js, run_migration_030.mjs,
// run_migration_031.mjs, run_sql.mjs, ...) that each applied exactly one file
// and recorded nothing. With no ledger, "has 027 been applied?" was only
// answerable by inspecting the schema by hand.
//
// The ledger is keyed on FILENAME, not version number, because the version
// numbers in this repo are not unique: 011, 013, 014, 017, 018 and 030 each
// appear twice and 019 appears three times, while 008 is missing entirely.
// A numeric key would silently treat 019_admin_role.sql and
// 019_service_interval_guards.sql as the same migration.
//
// Commands:
//   node scripts/migrate.mjs status     what is applied, pending, or changed
//   node scripts/migrate.mjs baseline   record every file as applied, run none
//   node scripts/migrate.mjs up         apply pending files in filename order
//
// Run `baseline` first on this project. The live database already contains the
// full schema, and most existing migrations are not idempotent — `up` against
// an empty ledger would try to replay 38 files over tables that already exist.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env.mjs";
import { Pool } from "pg";

loadEnvLocal();

const DIR = "supabase/migrations";

// 4-byte key for pg_advisory_lock, so two runners cannot interleave. Same
// mechanism migration 023 uses to close its TOCTOU window.
const LOCK_KEY = 947_112_003;

const LEDGER_DDL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    checksum   TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_by TEXT
  );
`;

const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

function discover() {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((filename) => {
      const sql = readFileSync(join(DIR, filename), "utf8");
      return { filename, sql, checksum: sha(sql) };
    });
}

async function readLedger(pool) {
  await pool.query(LEDGER_DDL);
  const { rows } = await pool.query(
    `SELECT filename, checksum, applied_at FROM schema_migrations`
  );
  return new Map(rows.map((r) => [r.filename, r]));
}

// Files are classified rather than just filtered, so `status` can surface the
// third case: applied, but the file on disk has changed since. That is the
// case a plain applied/pending split hides.
function classify(files, ledger) {
  const applied = [];
  const pending = [];
  const changed = [];
  for (const f of files) {
    const row = ledger.get(f.filename);
    if (!row) pending.push(f);
    else if (row.checksum !== f.checksum) changed.push({ ...f, was: row.checksum });
    else applied.push(f);
  }
  return { applied, pending, changed };
}
// __MIGRATE_RUNNER_PART_2__

async function cmdStatus(pool) {
  const files = discover();
  const ledger = await readLedger(pool);
  const { applied, pending, changed } = classify(files, ledger);

  console.log(`\n${DIR} — ${files.length} files\n`);
  console.log(`  applied  ${applied.length}`);
  console.log(`  pending  ${pending.length}`);
  console.log(`  changed  ${changed.length}   (applied, but the file differs now)`);

  if (pending.length) {
    console.log("\nPending:");
    for (const f of pending) console.log(`  + ${f.filename}`);
  }
  if (changed.length) {
    console.log("\nChanged since applied — the DB does NOT reflect these edits:");
    for (const f of changed) console.log(`  ! ${f.filename}  ${f.was} -> ${f.checksum}`);
  }
  // A ledger row with no file is a migration that was applied and then deleted;
  // a fresh replay would not reproduce this database.
  const orphans = [...ledger.keys()].filter(
    (k) => !files.some((f) => f.filename === k)
  );
  if (orphans.length) {
    console.log("\nIn the ledger but missing from disk:");
    for (const o of orphans) console.log(`  ? ${o}`);
  }
  console.log("");
}

async function cmdBaseline(pool) {
  const files = discover();
  const ledger = await readLedger(pool);
  const fresh = files.filter((f) => !ledger.has(f.filename));

  if (!fresh.length) {
    console.log("\nLedger already covers every file. Nothing to baseline.\n");
    return;
  }

  // ON CONFLICT DO NOTHING so a partially-baselined ledger can be topped up.
  for (const f of fresh) {
    await pool.query(
      `INSERT INTO schema_migrations (filename, checksum, applied_by)
       VALUES ($1, $2, $3) ON CONFLICT (filename) DO NOTHING`,
      [f.filename, f.checksum, "baseline"]
    );
  }
  console.log(`\nRecorded ${fresh.length} file(s) as already applied. No SQL was run.`);
  console.log("The live schema is now the declared baseline.\n");
}

async function cmdUp(pool) {
  const files = discover();
  const ledger = await readLedger(pool);
  const { pending, changed } = classify(files, ledger);

  if (changed.length) {
    console.error("\nRefusing to run: these applied migrations were edited after the fact.");
    for (const f of changed) console.error(`  ! ${f.filename}`);
    console.error("\nEditing an applied migration means the file no longer describes the");
    console.error("database. Write a new migration instead, or re-baseline deliberately.\n");
    process.exitCode = 1;
    return;
  }
  if (!pending.length) {
    console.log("\nNothing pending — the database is up to date.\n");
    return;
  }

  console.log(`\n${pending.length} pending migration(s):\n`);
  for (const f of pending) {
    // Each file is one simple-query batch, so its own BEGIN/COMMIT governs it:
    // any failing statement rolls that migration back whole. Unwrapped files
    // are still applied, but flagged, since they cannot roll back partially.
    const wrapped = /\bBEGIN\b/i.test(f.sql) && /\bCOMMIT\b/i.test(f.sql);
    process.stdout.write(`  ${f.filename}${wrapped ? "" : "  (not BEGIN/COMMIT wrapped)"} ... `);
    try {
      await pool.query(f.sql);
      await pool.query(
        `INSERT INTO schema_migrations (filename, checksum, applied_by) VALUES ($1, $2, $3)`,
        [f.filename, f.checksum, "up"]
      );
      console.log("ok");
    } catch (e) {
      console.log("FAILED");
      console.error(`\n  ${e.message}`);
      if (e.position) console.error(`  at character ${e.position}`);
      console.error("\nStopped. Later migrations were not attempted.\n");
      process.exitCode = 1;
      return;
    }
  }
  console.log("\nDone. Re-run scripts/dump-schema.mjs to refresh schema.sql.\n");
}

const COMMANDS = { status: cmdStatus, baseline: cmdBaseline, up: cmdUp };

const cmd = process.argv[2] ?? "status";
if (!COMMANDS[cmd]) {
  console.error(`Unknown command "${cmd}". Use: status | baseline | up`);
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (.env.local or .env).");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let locked = false;
try {
  await pool.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
  locked = true;
  await COMMANDS[cmd](pool);
} catch (e) {
  console.error(`\n${cmd} failed: ${e.message}\n`);
  process.exitCode = 1;
} finally {
  if (locked) await pool.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
  await pool.end();
}
