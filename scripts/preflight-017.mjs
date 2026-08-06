// Read-only pre-flight for migration 017_driver_vehicle_assignments.sql.
//
// The static conflict analysis says 017 is purely additive and its names are new.
// This confirms that against the LIVE database rather than against the migration
// files, because the two can drift (016's history has duplicate numbers, and
// anything applied by hand would not appear in supabase/migrations/).
//
// Runs SELECTs only. Nothing here writes.
//
// Run: node scripts/preflight-017.mjs
import { loadEnvLocal } from "./load-env.mjs";
import { Pool } from "pg";

loadEnvLocal();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = (text, params = []) => pool.query(text, params);

let blockers = 0;
const line = (ok, label, detail) =>
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
const must = (ok, label, detail) => {
  if (!ok) blockers++;
  line(ok, label, detail);
};

try {
  // ── 1. Names 017 intends to create must be free ────────────────────────────
  console.log("\n1. Names 017 creates are not already taken");

  const { rows: tbl } = await q(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'driver_vehicle_assignments'`
  );
  must(tbl.length === 0, "table driver_vehicle_assignments is free",
    tbl.length ? "ALREADY EXISTS — 017 would be a no-op via IF NOT EXISTS" : "");

  const INDEX_NAMES = [
    "uq_dva_active_driver",
    "uq_dva_active_vehicle",
    "idx_dva_driver_history",
    "idx_dva_vehicle_history",
  ];
  const { rows: idx } = await q(
    `SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = ANY($1)`,
    [INDEX_NAMES]
  );
  must(idx.length === 0, `index names free (${INDEX_NAMES.join(", ")})`,
    idx.map((r) => r.indexname).join(", "));

  const { rows: con } = await q(
    `SELECT conname FROM pg_constraint WHERE conname = 'chk_dva_interval'`
  );
  must(con.length === 0, "constraint chk_dva_interval is free",
    con.map((r) => r.conname).join(", "));

  // ── 2. FK targets and the policy helper must exist ─────────────────────────
  console.log("\n2. Everything 017 references already exists");

  for (const [table, col] of [
    ["drivers", "driver_id"],
    ["vehicles", "vehicle_id"],
    ["employees", "employee_id"],
  ]) {
    const { rows } = await q(
      `SELECT a.attname, t.typname
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_type t  ON t.oid = a.atttypid
        WHERE c.relname = $1 AND a.attname = $2 AND a.attnum > 0`,
      [table, col]
    );
    must(rows.length === 1, `FK target ${table}(${col}) exists`,
      rows.length ? `type ${rows[0].typname}` : "NOT FOUND");
    // An INT FK against a BIGINT PK would still work but is worth knowing about.
    if (rows.length === 1 && rows[0].typname !== "int4") {
      line(false, `  note: ${table}.${col} is ${rows[0].typname}, not int4 — match the FK type`);
    }
  }

  const { rows: fn } = await q(
    `SELECT proname FROM pg_proc WHERE proname = 'has_role'`
  );
  must(fn.length > 0, "has_role() exists (used by the RLS policies)",
    fn.length ? `${fn.length} overload(s)` : "NOT FOUND — the CREATE POLICY would fail");

  // ── 3. Context: is there data to pair, and any prior pairing notion? ───────
  console.log("\n3. Context (informational, not blocking)");

  const { rows: counts } = await q(
    `SELECT
       (SELECT COUNT(*) FROM drivers  WHERE deleted_at IS NULL) AS drivers,
       (SELECT COUNT(*) FROM vehicles WHERE deleted_at IS NULL) AS vehicles`
  );
  line(true, `active drivers: ${counts[0].drivers}, active vehicles: ${counts[0].vehicles}`);

  // If some other table already models a standing pairing, 017 would duplicate it.
  const { rows: lookalike } = await q(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND (table_name LIKE '%assignment%' OR table_name LIKE '%custodian%')
      ORDER BY table_name`
  );
  line(true, `existing assignment-ish tables: ${lookalike.length ? lookalike.map((r) => r.table_name).join(", ") : "(none)"}`);

  const { rows: dcols } = await q(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'drivers'
        AND column_name LIKE '%vehicle%'`
  );
  line(true, `drivers columns mentioning vehicle: ${dcols.length ? dcols.map((r) => r.column_name).join(", ") : "(none)"}`);

  const { rows: migs } = await q(
    `SELECT to_regclass('public.driver_vehicle_assignments') IS NOT NULL AS present`
  );
  line(true, `to_regclass check agrees table absent: ${migs[0].present === false}`);
} finally {
  await pool.end();
}

console.log(
  blockers === 0
    ? "\nPre-flight clear: 017 can be applied.\n"
    : `\n${blockers} blocker(s) — do NOT apply 017 until resolved.\n`
);
process.exit(blockers ? 1 : 0);
