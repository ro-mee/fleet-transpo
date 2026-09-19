// Layer 2 of the schema contract — the live half. Reads the database directly
// and answers the questions `npm run verify:anon` cannot.
//
// `Capstone/03 - Database/Migrations/Migrations.md`, under "What `024` teaches":
// *"There is still no check that the schema satisfies the code."* The offline
// half (`schema-contract.security.test.js`) gates what can be known from files.
// This is the half that needs the real database, and it exists for two jobs:
//
//   1. **Resolve the anon probe's INCONCLUSIVE verdicts.** `verify:anon` sees a
//      `200 []` and genuinely cannot tell RLS-deny-all from an empty table. This
//      script can: it reads `pg_class.relrowsecurity` and the grants, so the
//      answer stops depending on whether a table happens to have rows today. An
//      empty table that `anon` may read is not safe — it is one INSERT away from
//      being exposed — and that distinction is invisible from the REST side.
//
//   2. **Fail when the contract and reality disagree.** A table in `public` with
//      no classification, a `private` table without RLS, a `private` table with
//      an anon-permissive policy, a view that carries a hole straight through
//      base-table RLS, or code naming an object the schema does not have.
//
// THE INVARIANT IS NOT "NO TABLE GRANTS SELECT TO anon"
// -----------------------------------------------------
// That rule would be wrong on Supabase. A grant and a row filter are separate
// mechanisms, and a table may legitimately hold a `SELECT` grant while RLS
// correctly limits which rows are visible. The meaningful question is not *"is
// there a grant"* but *"does this table's classification match how it actually
// behaves"* — so the grant is an input to the verdict, never the verdict.
//
// READ-ONLY BY CONSTRUCTION. Every statement below is a catalog SELECT. There is
// no INSERT, UPDATE, DELETE or DDL anywhere in this file, and it never mutates
// the contract tables it inspects.
//
// It never prints credentials, connection strings, or row VALUES — only object
// names, catalog flags and counts.
//
// Run: node scripts/verify-db-contract.mjs [--table=<name>] [--quiet]

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { loadEnvLocal } from "./load-env.mjs";
import { TABLES, VIEWS, CLASSIFICATION, tableNames, viewNames } from "./lib/schema-contract.mjs";
import { referencedTablesInFile } from "./lib/sql-references.mjs";
import pg from "pg";

loadEnvLocal();

const args = process.argv.slice(2);
const onlyTable = args.find((a) => a.startsWith("--table="))?.split("=")[1] ?? null;
const quiet = args.includes("--quiet");

// 0 = contract holds, 1 = violations found, 3 = could not run.
const EXIT_OK = 0;
const EXIT_VIOLATION = 1;
const EXIT_UNUSABLE = 3;

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL is not set (.env.local or .env).\n" +
      "This check reads the live catalog — RLS flags, grants and policies — none of which\n" +
      "the anon probe or schema.sql can see. Set it and re-run."
  );
  process.exit(EXIT_UNUSABLE);
}

// ---------------------------------------------------------------------------
// live catalog
// ---------------------------------------------------------------------------

const RELATIONS_SQL = `
  SELECT c.relname                             AS name,
         c.relkind                             AS kind,
         c.relrowsecurity                      AS rls,
         c.relforcerowsecurity                 AS force_rls,
         COALESCE(c.reloptions, '{}')          AS reloptions,
         has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
         has_table_privilege('anon', c.oid, 'INSERT') AS anon_insert,
         has_table_privilege('anon', c.oid, 'UPDATE') AS anon_update,
         has_table_privilege('anon', c.oid, 'DELETE') AS anon_delete,
         has_table_privilege(current_user, c.oid, 'SELECT') AS self_select
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p', 'v', 'm')
   ORDER BY c.relname`;

const POLICIES_SQL = `
  SELECT tablename, policyname, roles, cmd, qual
    FROM pg_policies
   WHERE schemaname = 'public'
   ORDER BY tablename, policyname`;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Source files whose SQL names database objects. */
function appSourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "node_modules" || entry === ".next") continue;
        walk(full, out);
      } else if (
        /\.(js|jsx)$/.test(entry) &&
        !/\.test\.jsx?$/.test(entry) &&
        !full.includes(join("src", "security-assessment"))
      ) {
        out.push(full);
      }
    }
  };
  walk(join(process.cwd(), "src"));
  return out;
}

/** Does a policy's role list reach `anon` (directly or via PUBLIC)? */
const policyReachesAnon = (roles) =>
  Array.isArray(roles) && roles.some((r) => r === "anon" || r === "public" || r === "PUBLIC");

// ---------------------------------------------------------------------------
// verdicts
// ---------------------------------------------------------------------------

/**
 * Decide one relation's status against its declared classification.
 *
 * `private` means: reachable through the application's own API only, and
 * nothing else. So the question is always "can `anon` reach it", and the
 * catalog answers it in two independent parts — the grant, and the row filter.
 * Either one alone is insufficient, which is the whole reason this script exists.
 */
function judge(relation, declared, policies) {
  const isView = relation.kind === "v" || relation.kind === "m";
  const notes = [];
  const violations = [];

  const anonPolicies = policies.filter(policyReachesAnon);

  if (isView) {
    // A view carries no RLS of its own. Unless it opts into `security_invoker`,
    // it executes as its OWNER — so it reads straight through the base tables'
    // RLS, and a SELECT grant on it is a complete bypass of everything the
    // table-level RLS above claims to protect.
    const invoker = relation.reloptions.some((o) => /^security_invoker=(true|on)$/i.test(o));
    notes.push(invoker ? "security_invoker=on" : "runs as owner (no security_invoker)");
    if (!invoker && relation.anon_select) {
      violations.push(
        "anon holds SELECT on a view that runs as its owner — it reads through the base tables' RLS"
      );
    }
    if (relation.rls) notes.push("relrowsecurity is set, which does nothing for a view");
    return { violations, notes, kindLabel: relation.kind === "m" ? "MATERIALIZED VIEW" : "VIEW" };
  }

  // --- tables ---

  // The load-bearing failure. RLS off plus an anon privilege is reachable, and it
  // is reachable whether or not the table happens to hold rows right now.
  if (!relation.rls && relation.anon_select) {
    violations.push(
      "RLS is DISABLED and anon holds SELECT — readable with the public anon key alone"
    );
  } else if (!relation.rls) {
    violations.push(
      "RLS is DISABLED — not readable today only because anon lacks the SELECT grant, " +
        "which Supabase's default privileges grant on new tables in public"
    );
  }

  if (anonPolicies.length) {
    const names = anonPolicies.map((p) => `${p.policyname} (${p.cmd})`).join(", ");
    violations.push(`anon-permissive RLS policy present on a private table: ${names}`);
  }

  if (relation.force_rls) {
    // Never do this here: FORCE subjects the table OWNER to RLS, and the app
    // connects as the owner (src/lib/db.js, the pg Pool over DATABASE_URL). It
    // would turn every private table into deny-all for the application itself.
    violations.push("FORCE ROW LEVEL SECURITY is set — this breaks the application's own owner connection");
  }

  notes.push(relation.rls ? "RLS on" : "RLS OFF");
  notes.push(relation.anon_select ? "anon has SELECT" : "anon has no SELECT");
  if (anonPolicies.length === 0 && relation.rls) notes.push("no anon policy (deny-all for anon)");

  // Write grants are worth recording but are NOT a violation while RLS is on:
  // a permissive-by-default role still has to pass a policy, and there is none,
  // so RLS denies writes exactly as it denies reads. They become load-bearing the
  // moment RLS is off, which is why they are reported plainly on those rows.
  const writeGrants = ["INSERT", "UPDATE", "DELETE"].filter((p) => relation[`anon_${p.toLowerCase()}`]);
  if (writeGrants.length) {
    const summary = `anon holds write grants: ${writeGrants.join(", ")}`;
    if (relation.rls) notes.push(`${summary} (denied by RLS — no policy grants them)`);
    else violations.push(`${summary} — RLS is off, so these are live`);
  }

  if (declared === CLASSIFICATION.PUBLIC && !relation.anon_select) {
    violations.push("declared PUBLIC but anon holds no SELECT — the declaration is fiction");
  }

  return { violations, notes, kindLabel: "TABLE" };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n=== Database contract (live) ===\n");

  const target = new URL(process.env.DATABASE_URL);
  console.log(`Target: ${target.hostname}:${target.port || 5432}/${target.pathname.replace(/^\//, "")}`);
  console.log("Read-only: catalog SELECTs only. No DML, no DDL, no row values printed.\n");

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let relations;
  let policies;
  try {
    ({ rows: relations } = await client.query(RELATIONS_SQL));
    ({ rows: policies } = await client.query(POLICIES_SQL));
  } finally {
    await client.end();
  }

  const byName = new Map(relations.map((r) => [r.name, r]));
  const policiesByTable = new Map();
  for (const p of policies) {
    if (!policiesByTable.has(p.tablename)) policiesByTable.set(p.tablename, []);
    policiesByTable.get(p.tablename).push(p);
  }

  // --- controls -----------------------------------------------------------
  // A control failure makes every verdict below meaningless, so it is checked
  // before any of them is read. Each one is a different way this could quietly
  // report success for the wrong reason.
  const controls = [];

  controls.push({
    name: "the public schema contains relations to judge",
    ok: relations.length > 0,
    detail: `${relations.length} relation(s)`,
  });

  // `has_table_privilege` must be capable of returning TRUE. If it were broken
  // or the role unresolvable, every grant check would report "no SELECT" and
  // every table would look protected — a total false negative.
  const selfTrue = relations.filter((r) => r.self_select).length;
  controls.push({
    name: "privilege resolution reports TRUE when it should",
    ok: selfTrue > 0,
    detail: `${selfTrue}/${relations.length} relations grant the current user SELECT`,
  });

  // RLS must be readable as a value that VARIES. A hardcoded false, or a query
  // reading the wrong catalog column, would show "RLS off" everywhere.
  const rlsOn = relations.filter((r) => r.rls).length;
  controls.push({
    name: "RLS flags are read from the live catalog",
    ok: rlsOn > 0,
    detail: `${rlsOn}/${relations.length} relations currently have RLS enabled`,
  });

  console.log("--- controls ---");
  for (const c of controls) console.log(`  ${c.ok ? "ok  " : "FAIL"}  ${c.name} — ${c.detail}`);
  const controlsPassed = controls.every((c) => c.ok);
  if (!controlsPassed) {
    console.log(
      "\nA control failed, so no verdict below can be trusted. A broken privilege or RLS\n" +
        "read looks exactly like a clean result."
    );
  }

  // --- classification -----------------------------------------------------
  const declaredTables = new Set(tableNames());
  const declaredViews = new Set(viewNames());
  const liveNames = new Set(relations.map((r) => r.name));

  const unclassified = relations
    .filter((r) => !declaredTables.has(r.name) && !declaredViews.has(r.name))
    .map((r) => r.name);
  const phantom = [...declaredTables, ...declaredViews].filter((n) => !liveNames.has(n)).sort();

  // --- code vs live -------------------------------------------------------
  // The `024` failure: code querying an object the database no longer has.
  const referenced = new Map();
  for (const file of appSourceFiles()) {
    for (const name of referencedTablesInFile(readFileSync(file, "utf8"))) {
      if (!referenced.has(name)) referenced.set(name, relative(process.cwd(), file).replace(/\\/g, "/"));
    }
  }
  const missingInSchema = [...referenced.keys()].filter((n) => !liveNames.has(n)).sort();

  // --- per-relation verdicts ---------------------------------------------
  const results = relations
    .filter((r) => !onlyTable || r.name === onlyTable)
    .map((r) => {
      const declared =
        TABLES[r.name]?.classification ?? VIEWS[r.name]?.classification ?? null;
      if (!declared) return { name: r.name, kindLabel: r.kind, unclassified: true, violations: [], notes: [] };
      return { name: r.name, unclassified: false, ...judge(r, declared, policiesByTable.get(r.name) ?? []) };
    });

  if (onlyTable) console.log(`\nFocused run: judging only "${onlyTable}".`);
  console.log(`\n--- relations (${relations.length}) ---`);
  for (const r of results) {
    if (quiet && r.violations.length === 0 && !r.unclassified) continue;
    if (r.unclassified) {
      console.log(`  UNCLASSIFIED  ${r.name} — exists in public with no entry in the contract`);
      continue;
    }
    const label = r.violations.length ? "VIOLATION" : "ok";
    console.log(`  ${label.padEnd(11)} ${r.name.padEnd(30)} ${r.notes.join("; ")}`);
    for (const v of r.violations) console.log(`                ↳ ${v}`);
  }

  // --- the INCONCLUSIVE resolution ---------------------------------------
  // This is the sentence `verify:anon` cannot write for itself.
  console.log("\n--- anon-probe resolution ---");
  console.log(
    "For every table the probe scored INCONCLUSIVE (200 with no rows), this is the\n" +
      "database-side reason — which is what decides the verdict."
  );
  const resolved = results.filter((r) => !r.unclassified && (byName.get(r.name)?.kind === "r" || byName.get(r.name)?.kind === "p"));
  const protectedCount = resolved.filter(
    (r) => byName.get(r.name).rls && r.violations.length === 0
  ).length;
  const readableCount = resolved.filter((r) => byName.get(r.name).rls === false).length;
  console.log(`  RLS enabled, no anon policy   ${protectedCount}  -> PROTECTED (proven regardless of row count)`);
  console.log(`  RLS disabled                  ${readableCount}  -> see violations above`);

  // --- findings -----------------------------------------------------------
  const violations = results.filter((r) => r.unclassified || r.violations.length > 0);

  console.log("\n--- summary ---");
  console.log(`  relations in public      ${relations.length}`);
  console.log(`  classified in contract   ${declaredTables.size + declaredViews.size} (${declaredTables.size} tables, ${declaredViews.size} views)`);
  console.log(`  unclassified live        ${unclassified.length}`);
  console.log(`  contract entries missing live  ${phantom.length}`);
  console.log(`  code-named, absent live  ${missingInSchema.length}`);
  console.log(`  violations               ${violations.filter((r) => !r.unclassified).length}`);

  if (unclassified.length) {
    console.log(
      `\nUnclassified table(s) in public: ${unclassified.join(", ")}\n` +
        "Add each to scripts/lib/schema-contract.mjs with a classification and a reason.\n" +
        "An unclassified table is exactly how SEC-DB-003 happened."
    );
  }
  if (phantom.length) {
    console.log(
      `\nContract entr(y/ies) with no live relation: ${phantom.join(", ")}\n` +
        "A contract that describes objects the database does not have stops protecting anything."
    );
  }
  if (missingInSchema.length) {
    console.log(
      `\nCode names object(s) the live schema does not provide:\n  ` +
        missingInSchema.map((n) => `${n} (${referenced.get(n)})`).join("\n  ") +
        "\nThis is the `024` failure. Check the migration that removed it."
    );
  }

  if (!controlsPassed) process.exit(EXIT_UNUSABLE);
  if (unclassified.length || phantom.length || missingInSchema.length || violations.length) {
    process.exit(EXIT_VIOLATION);
  }
  process.exit(EXIT_OK);
}

main().catch((error) => {
  console.error(`\nDatabase contract check failed to run: ${error.message}`);
  process.exit(EXIT_UNUSABLE);
});
