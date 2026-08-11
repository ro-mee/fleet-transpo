// Dump the live database's structure to schema.sql.
//
// Why this exists: the migration files in supabase/migrations/ cannot be
// replayed to reproduce this database. They have duplicate numbers (011, 013,
// 014, 017, 018, 019, 030 each appear twice or three times), 008 is missing,
// several tables were created at runtime and never declared in a migration at
// all, and at least one live CHECK constraint (chk_dispatch_status) accepts
// more values than the migration that supposedly defines it. Until that is
// reconciled, the only trustworthy description of the schema is the database
// itself — so this reads it and writes it down.
//
// This is a structural dump, not pg_dump: no data, no ownership, no grants. It
// is meant to be committed and diffed, so ordering is deterministic
// (alphabetical everywhere) and no timestamp is written into the file. A diff
// in git is then a real schema change, not dump noise.
//
// Run: node scripts/dump-schema.mjs [--out schema.sql]

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvLocal } from "./load-env.mjs";
import pg from "pg";

loadEnvLocal();

const outArgIndex = process.argv.indexOf("--out");
const OUT = outArgIndex !== -1 ? process.argv[outArgIndex + 1] : "schema.sql";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (.env.local or .env).");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

/** Quote an identifier only when Postgres would need it. */
const q = (name) => (/^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name}"`);

/** Render one column's DDL fragment from information_schema. */
function columnDdl(c) {
  let type = c.data_type;
  if (type === "character varying" && c.character_maximum_length)
    type = `varchar(${c.character_maximum_length})`;
  else if (type === "character varying") type = "varchar";
  else if (type === "character" && c.character_maximum_length)
    type = `char(${c.character_maximum_length})`;
  else if (type === "numeric" && c.numeric_precision !== null)
    type = `numeric(${c.numeric_precision},${c.numeric_scale ?? 0})`;
  else if (type === "ARRAY") type = `${c.udt_name.replace(/^_/, "")}[]`;
  else if (type === "USER-DEFINED") type = c.udt_name;
  else if (type === "timestamp without time zone") type = "timestamp";
  else if (type === "timestamp with time zone") type = "timestamptz";
  else if (type === "time without time zone") type = "time";
  else if (type === "double precision") type = "double precision";

  let line = `  ${q(c.column_name)} ${type}`;
  if (c.is_identity === "YES") line += ` GENERATED ${c.identity_generation} AS IDENTITY`;
  if (c.column_default !== null && c.is_identity !== "YES")
    line += ` DEFAULT ${c.column_default}`;
  if (c.is_nullable === "NO") line += " NOT NULL";
  return line;
}

async function main() {
  await client.connect();

  const out = [];
  out.push("-- Structure of the live database, dumped by scripts/dump-schema.mjs.");
  out.push("-- Generated file — edit the database with a migration, then re-dump.");
  out.push("-- Structure only: no data, no owners, no grants, no timestamp (so");
  out.push("-- that a git diff of this file is always a real schema change).");
  out.push("");

  // ---- Tables and columns -------------------------------------------------
  const { rows: tables } = await client.query(`
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  `);

  const { rows: columns } = await client.query(`
    SELECT table_name, column_name, data_type, udt_name,
           character_maximum_length, numeric_precision, numeric_scale,
           column_default, is_nullable, is_identity, identity_generation
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);

  const colsByTable = new Map();
  for (const c of columns) {
    if (!colsByTable.has(c.table_name)) colsByTable.set(c.table_name, []);
    colsByTable.get(c.table_name).push(c);
  }

  // Constraints, rendered from pg_get_constraintdef so the text matches what
  // Postgres actually enforces rather than a reconstruction of it.
  const { rows: constraints } = await client.query(`
    SELECT rel.relname AS table_name, con.conname AS name,
           pg_get_constraintdef(con.oid) AS def, con.contype
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    WHERE n.nspname = 'public'
    ORDER BY rel.relname, con.contype, con.conname
  `);

  const consByTable = new Map();
  for (const c of constraints) {
    if (!consByTable.has(c.table_name)) consByTable.set(c.table_name, []);
    consByTable.get(c.table_name).push(c);
  }

  out.push("-- ============================ TABLES ============================");
  for (const t of tables) {
    const cols = colsByTable.get(t.name) ?? [];
    const cons = consByTable.get(t.name) ?? [];
    out.push("");
    out.push(`CREATE TABLE ${q(t.name)} (`);
    const parts = cols.map(columnDdl);
    // Inline everything except FKs, which are emitted separately below so the
    // file can be replayed top-to-bottom without ordering the tables by
    // dependency.
    for (const c of cons.filter((c) => c.contype !== "f"))
      parts.push(`  CONSTRAINT ${q(c.name)} ${c.def}`);
    out.push(parts.join(",\n"));
    out.push(");");
  }

  // ---- Foreign keys -------------------------------------------------------
  out.push("");
  out.push("-- ========================= FOREIGN KEYS =========================");
  out.push("-- Separate so the tables above can be created in any order.");
  out.push("");
  const fks = constraints.filter((c) => c.contype === "f");
  for (const c of fks)
    out.push(
      `ALTER TABLE ${q(c.table_name)} ADD CONSTRAINT ${q(c.name)} ${c.def};`
    );

  // ---- Indexes ------------------------------------------------------------
  // Constraint-backed indexes are skipped: the constraint above already
  // creates them, and emitting both would fail on replay.
  const { rows: indexes } = await client.query(`
    SELECT i.indexname AS name, i.indexdef AS def
    FROM pg_indexes i
    WHERE i.schemaname = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint con
        JOIN pg_class ic ON ic.oid = con.conindid
        WHERE ic.relname = i.indexname
      )
    ORDER BY i.indexname
  `);
  out.push("");
  out.push("-- ============================ INDEXES ===========================");
  out.push("-- Constraint-backed indexes omitted: the constraints create them.");
  out.push("");
  for (const i of indexes) out.push(`${i.def};`);

  // ---- Views --------------------------------------------------------------
  const { rows: views } = await client.query(`
    SELECT table_name AS name, view_definition AS def
    FROM information_schema.views
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  out.push("");
  out.push("-- ============================= VIEWS ============================");
  for (const v of views) {
    out.push("");
    out.push(`CREATE OR REPLACE VIEW ${q(v.name)} AS`);
    out.push(`${(v.def ?? "").trim()}`);
  }

  // ---- Functions and triggers --------------------------------------------
  const { rows: functions } = await client.query(`
    SELECT p.proname AS name, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
    ORDER BY p.proname
  `);
  out.push("");
  out.push("-- =========================== FUNCTIONS ==========================");
  for (const f of functions) {
    out.push("");
    out.push(`${f.def};`);
  }

  const { rows: triggers } = await client.query(`
    SELECT t.tgname AS name, pg_get_triggerdef(t.oid) AS def
    FROM pg_trigger t
    JOIN pg_class rel ON rel.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
    ORDER BY t.tgname
  `);
  out.push("");
  out.push("-- =========================== TRIGGERS ===========================");
  out.push("");
  for (const t of triggers) out.push(`${t.def};`);

  out.push("");
  writeFileSync(resolve(process.cwd(), OUT), out.join("\n"), "utf8");

  console.log(`Wrote ${OUT}`);
  console.log(
    `  ${tables.length} tables, ${views.length} views, ${fks.length} foreign keys,`
  );
  console.log(
    `  ${indexes.length} standalone indexes, ${functions.length} functions, ${triggers.length} triggers`
  );
}

main()
  .catch((e) => {
    console.error(`Dump failed: ${e.message}`);
    process.exitCode = 1;
  })
  .finally(() => client.end());
