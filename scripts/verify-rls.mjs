// Read-only probe (SELECT only, no writes) — what the RLS migrations actually did.
//
// Why this exists: migrations `115_app_errors_rls.sql` and `116_rls_gap_tables.sql`
// were first written as 113/114/115 and recorded in the schema_migrations ledger
// under those names; a parallel 113 on origin forced a renumber to 115/116, so the
// ledger rows under the old names read as missing-from-disk. And schema.sql cannot
// answer the question for them — it captures no RLS at all (its only "POLICY"
// match is the `policy_version` column).
// The live database is the only place this is answerable.
//
// Background, from `100_enable_rls_all.sql`: that migration enabled RLS on 20
// tables and deliberately created NO policies. The design is deny-all for the
// PostgREST `anon` and `authenticated` roles, while the Next.js API server
// connects as `postgres` (a bypassrls role) via DATABASE_URL and is unaffected.
//
// The consequence: every table created AFTER 100 started with RLS *disabled*.
// 103_app_errors.sql is the first of those, so `app_errors` and everything from
// 104 onward are the candidate gap — which is what 115 and 116 should have closed.
//
// Reports:
//   1. every public table, and whether RLS is enabled on it
//   2. every policy in pg_policies (expected: none, per 100's stated design)
//   3. anon / authenticated grants on public tables
//   4. the exposure set — RLS disabled AND a role can still reach the table
//
// Credentials are never hardcoded — DATABASE_URL comes from the repo's env files
// through the shared loader, the same variable src/lib/db.js uses.
//
// Run: node scripts/verify-rls.mjs
import pg from "pg";
import { loadEnvLocal } from "./load-env.mjs";

loadEnvLocal();
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set — check .env");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  // Supabase terminates TLS with a cert this client won't have in its trust
  // store; the app's pool relies on the sslmode in the URL for the same reason.
  ssl: { rejectUnauthorized: false },
});

await client.connect();

try {
  // --- who we are ------------------------------------------------------------
  // If this comes back as anything but a bypassrls role, the queries below are
  // themselves subject to RLS and the report will be misleadingly empty.
  const { rows: who } = await client.query(
    `SELECT current_user AS role, r.rolbypassrls
       FROM pg_roles r
      WHERE r.rolname = current_user`
  );
  const connecting = who[0] ?? { role: "(unknown)", rolbypassrls: null };
  console.log(`\nConnecting role: ${connecting.role} (bypassrls=${connecting.rolbypassrls})`);
  if (connecting.rolbypassrls !== true) {
    console.warn(
      "  ! this role does NOT bypass RLS — results below may be filtered by policy"
    );
  }

  // --- roles that PostgREST exposes the public schema to ---------------------
  const { rows: roles } = await client.query(
    `SELECT rolname, rolbypassrls
       FROM pg_roles
      WHERE rolname IN ('anon', 'authenticated', 'service_role', 'postgres',
                        'authenticator')
      ORDER BY rolname`
  );
  console.log("Relevant roles:");
  for (const r of roles) {
    console.log(`  ${r.rolname.padEnd(16)} bypassrls=${r.rolbypassrls}`);
  }
  const postgrestRoles = roles
    .filter((r) => r.rolname === "anon" || r.rolname === "authenticated")
    .map((r) => r.rolname);
  if (postgrestRoles.length !== 2) {
    console.warn(
      `  ! expected both 'anon' and 'authenticated' to exist; found: ${postgrestRoles.join(", ") || "none"}`
    );
  }

  // --- 1. RLS state per public table -----------------------------------------
  const { rows: tables } = await client.query(
    `SELECT c.relname                                        AS table_name,
            c.relrowsecurity                                 AS rls_enabled,
            c.relforcerowsecurity                            AS rls_forced,
            (SELECT COUNT(*)::int
               FROM pg_policies p
              WHERE p.schemaname = 'public'
                AND p.tablename  = c.relname)                AS policy_count
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
      ORDER BY c.relrowsecurity, c.relname`
  );

  const withRls = tables.filter((t) => t.rls_enabled);
  const withoutRls = tables.filter((t) => !t.rls_enabled);

  console.log(`\n=== public tables: ${tables.length} total ===`);
  console.log(`  RLS enabled : ${withRls.length}`);
  console.log(`  RLS OFF     : ${withoutRls.length}`);

  if (withoutRls.length > 0) {
    console.log("\nRLS DISABLED on:");
    for (const t of withoutRls) console.log(`  - ${t.table_name}`);
  }

  // --- 2. policies ------------------------------------------------------------
  const { rows: policies } = await client.query(
    `SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
       FROM pg_policies
      WHERE schemaname = 'public'
      ORDER BY tablename, policyname`
  );
  console.log(`\n=== pg_policies: ${policies.length} policy/policies in public ===`);
  if (policies.length === 0) {
    console.log("  (none — consistent with 100's stated deny-all design)");
  } else {
    for (const p of policies) {
      console.log(`\n  ${p.tablename}.${p.policyname}`);
      console.log(`    cmd=${p.cmd} permissive=${p.permissive} roles=${p.roles}`);
      if (p.qual) console.log(`    USING      : ${p.qual}`);
      if (p.with_check) console.log(`    WITH CHECK : ${p.with_check}`);
    }
  }

  // Tables that have RLS on but no policy — deny-all for non-bypassrls roles.
  const denyAll = withRls.filter((t) => t.policy_count === 0);
  console.log(
    `\n  RLS on with zero policies (deny-all to anon/authenticated): ${denyAll.length}`
  );

  // --- 3. grants to the PostgREST-facing roles --------------------------------
  const { rows: grants } = await client.query(
    `SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
       FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND grantee IN ('anon', 'authenticated', 'service_role')
      GROUP BY table_name, grantee
      ORDER BY grantee, table_name`
  );
  const selectGranted = new Set(
    grants
      .filter((g) => g.grantee !== "service_role" && g.privs.includes("SELECT"))
      .map((g) => g.table_name)
  );
  console.log(
    `\n=== grants to anon/authenticated/service_role: ${grants.length} rows ===`
  );
  console.log(
    `  public tables where anon or authenticated holds SELECT: ${selectGranted.size}`
  );

  // --- 4. the exposure set ----------------------------------------------------
  // RLS off is only reachable from PostgREST if the role also has a grant. This
  // is the intersection that actually matters, and the one 115/116 existed to
  // empty.
  const exposed = withoutRls.filter((t) => selectGranted.has(t.table_name));
  const ungranted = withoutRls.filter((t) => !selectGranted.has(t.table_name));

  console.log("\n=== exposure ===");
  if (exposed.length === 0) {
    console.log(
      "  No public table is both RLS-disabled and SELECT-granted to anon/authenticated."
    );
  } else {
    console.log(
      `  ${exposed.length} table(s) RLS-disabled AND SELECT-granted — readable via PostgREST:`
    );
    for (const t of exposed) console.log(`  ! ${t.table_name}`);
  }
  if (ungranted.length > 0) {
    console.log(
      `\n  ${ungranted.length} table(s) have RLS off but no anon/authenticated grant,`
    );
    console.log("  so they are not currently reachable via PostgREST:");
    for (const t of ungranted) console.log(`    - ${t.table_name}`);
  }

  // --- app_errors, the named target of 115 ------------------------------------
  const appErrors = tables.find((t) => t.table_name === "app_errors");
  console.log("\n=== app_errors (target of 115_app_errors_rls.sql) ===");
  if (!appErrors) {
    console.log("  table not found in public");
  } else {
    console.log(`  RLS enabled  : ${appErrors.rls_enabled}`);
    console.log(`  policy count : ${appErrors.policy_count}`);
    console.log(
      `  anon/authed SELECT grant : ${selectGranted.has("app_errors")}`
    );
  }

  // A non-empty exposure set is a real finding, so it fails the probe.
  if (exposed.length > 0) {
    console.error(
      `\n✗ ${exposed.length} public table(s) are readable via PostgREST with RLS off`
    );
    process.exitCode = 1;
  } else {
    console.log("\n✓ no RLS-disabled table is SELECT-granted to anon/authenticated");
  }
} finally {
  await client.end();
}
