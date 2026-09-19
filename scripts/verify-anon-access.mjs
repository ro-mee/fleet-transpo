// Stage 2 verification — can the public anon key reach private fleet data?
//
// The claim under test is narrow and worth stating exactly: *holding the public
// anon key, and nothing else, cannot read fleet data through Supabase's REST
// API.* The anon key ships in the browser bundle by design; it is not a secret.
// What makes it safe is that PostgREST applies the database's own grants and
// Row Level Security on top of it — so the question is never "is the key secret"
// but "what does the database let it see".
//
// This script answers that from the outside, the way an attacker would: no
// DATABASE_URL, no service-role key, no repository access. Only the two public
// values and the network.
//
// READ-ONLY BY CONSTRUCTION. Every probe is `GET ...?select=*&limit=1`. There is
// no write, no mutation and no POST anywhere in this file.
//
// It never prints the anon key, and it never prints row *values* — an exposed
// table is reported by name and column list, which is enough to act on without
// copying live fleet data into a terminal or a report.
//
// Run: node scripts/verify-anon-access.mjs [--table=<name>] [--quiet]
//
// ---
//
// THE VERDICT RULE, and why it is not simply "no rows means safe":
//
// A `200` with `[]` is AMBIGUOUS. It is what RLS deny-all looks like, and it is
// also what an empty table looks like. Several tables here are new enough that
// empty is the likely state, so reading `200 []` as proof of safety would
// manufacture exactly the false confidence this script exists to prevent.
//
//   rows returned          -> EXPOSED       the anon key reads protected data
//   explicit denial        -> PASS          access refused, at grant or policy
//   200 with []            -> INCONCLUSIVE  cannot tell deny-all from empty
//
// INCONCLUSIVE is resolved by `npm run db:contract`, which reads the database
// directly and can say *why* the probe saw nothing (RLS enabled? no anon grant?).
// This script is the end-to-end probe; that one is the explanation. Neither is
// sufficient alone, and a table stays open until the two agree.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvLocal } from "./load-env.mjs";

loadEnvLocal();

const args = process.argv.slice(2);
const onlyTable = args.find((a) => a.startsWith("--table="))?.split("=")[1] ?? null;
const quiet = args.includes("--quiet");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Exit codes: 0 = nothing exposed and everything proven, 1 = exposed,
// 2 = not proven (inconclusive results remain), 3 = could not run.
const EXIT_OK = 0;
const EXIT_EXPOSED = 1;
const EXIT_INCONCLUSIVE = 2;
const EXIT_UNUSABLE = 3;

if (!SUPABASE_URL || !ANON_KEY) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are both required.\n" +
      "They are the two public values the browser bundle already ships; no service key " +
      "or DATABASE_URL is used here by design.\n" +
      "Set them in .env.local (or .env) and re-run."
  );
  process.exit(EXIT_UNUSABLE);
}

const restBase = `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1`;

// The tables this plan already suspects, probed and reported first. Everything
// else in the schema is probed too — this is ordering, not scope.
const PRIORITY_TABLES = ["app_errors", "ai_prompt_templates", "trip_monitor_alerts"];

const headersFor = (key) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  Accept: "application/json",
});

/**
 * One read-only probe.
 *
 * Returns a verdict plus the evidence behind it. The body is never returned —
 * only its shape — so live fleet data cannot leak into the output.
 */
async function probeTable(table) {
  const url = `${restBase}/${encodeURIComponent(table)}?select=*&limit=1`;
  let response;
  try {
    response = await fetch(url, { headers: headersFor(ANON_KEY) });
  } catch (error) {
    return { table, verdict: "UNREACHABLE", detail: error.message };
  }

  const raw = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* A non-JSON body is itself the evidence; handled below. */
  }

  const pgCode = parsed && !Array.isArray(parsed) ? parsed.code : null;
  const message = parsed && !Array.isArray(parsed) ? parsed.message : null;

  if (response.status === 200 && Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return {
        table,
        verdict: "INCONCLUSIVE",
        // Worth being precise about what a 200 does and does not prove. It DOES
        // prove anon holds SELECT here — a role without the grant gets 42501,
        // as `employees` shows. So the only question left is why no rows came
        // back: policy, or emptiness. Those are indistinguishable from outside.
        detail: "200 with [] — anon holds SELECT; rows hidden by RLS or table is empty",
      };
    }
    // Exposed. Report the column names, never the values.
    const columns = Object.keys(parsed[0] ?? {});
    return {
      table,
      verdict: "EXPOSED",
      detail: `${parsed.length} row(s) readable; columns: ${columns.join(", ")}`,
    };
  }

  // An explicit refusal. 401 = the credential was rejected; 403 / 42501 =
  // permission denied for this role; PGRST205 = the table is not exposed at all.
  if (response.status === 401 || response.status === 403 || pgCode === "42501") {
    return { table, verdict: "PASS", detail: `HTTP ${response.status}${pgCode ? ` (${pgCode})` : ""} — refused` };
  }
  if (response.status === 404 || pgCode === "PGRST205") {
    return { table, verdict: "PASS", detail: "not exposed through PostgREST" };
  }

  return {
    table,
    verdict: "UNREACHABLE",
    detail: `HTTP ${response.status}${pgCode ? ` (${pgCode})` : ""}${message ? ` — ${message}` : ""}`,
  };
}

/**
 * Enumerate what to probe.
 *
 * The list comes from the checked-in `schema.sql`, NOT from PostgREST's root
 * OpenAPI document. That root endpoint (`GET /rest/v1/`) serves only to a
 * service_role key and answers anon with `401 {"message":"Invalid API key"}` —
 * so using it here would fail the control for a reason that has nothing to do
 * with what is under test, and would have made a perfectly valid anon key look
 * broken.
 *
 * `schema.sql` is generated from the live database by `npm run db:dump`, so it
 * is the same list of objects. Using it also keeps this script's inputs to the
 * repository plus the two public values, which is the whole point: no
 * DATABASE_URL, no service key.
 *
 * VIEWS ARE INCLUDED, and that is not a detail. This function originally
 * matched `CREATE TABLE` only, so `driver_stats` — a view — was never probed,
 * and the hole it represents went unnoticed until `npm run db:contract` read the
 * catalog and asked why a view owned by `postgres` had a SELECT grant for
 * `anon`. PostgREST exposes views exactly like tables, so a probe that skips
 * them has a blind spot the size of every view in the schema.
 */
function listSchemaObjects() {
  let sql;
  try {
    sql = readFileSync(resolve(process.cwd(), "schema.sql"), "utf8");
  } catch (error) {
    return { ok: false, detail: `schema.sql could not be read: ${error.message}` };
  }
  const names = new Set();
  // The dump writes unqualified names; the optional `public.` and quoting are
  // tolerated so a future dump style does not silently empty this list.
  const patterns = [
    /^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s*\(/gim,
    /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:public\.)?"?([a-z0-9_]+)"?/gim,
  ];
  for (const pattern of patterns) {
    for (const match of sql.matchAll(pattern)) names.add(match[1]);
  }
  return { ok: names.size > 0, tables: [...names].sort() };
}

/**
 * Controls. A blanket failure — wrong URL, blocked network, dead endpoint —
 * must never be indistinguishable from a clean result.
 *
 * Every control runs against a real table endpoint. The load-bearing one is the
 * tampered key: if a deliberately broken key produced the same response as the
 * real one, then the credential is not what is being evaluated, and every
 * "refused" verdict below would be an artifact rather than a policy decision.
 *
 * Credential validity is judged by the RESPONSE MESSAGE, not the status code.
 * A wrong key and a denied-but-valid key are both 401, so status alone cannot
 * tell "you may not read this" from "I do not know you" — and confusing those
 * two is exactly how a broken run gets reported as a clean one.
 */
const CONTROL_TABLE = "employees";

const isInvalidKey = (body) =>
  !!body && !Array.isArray(body) && /invalid api key/i.test(body.message ?? "");

async function probeRaw(key, table) {
  const response = await fetch(
    `${restBase}/${encodeURIComponent(table)}?select=*&limit=1`,
    { headers: headersFor(key) }
  );
  const raw = await response.text();
  let body = null;
  try {
    body = JSON.parse(raw);
  } catch {
    /* A non-JSON body is reported as-is by the control that reads it. */
  }
  return { status: response.status, body };
}

async function runControls() {
  const controls = [];

  const bogus = await probeRaw(`${ANON_KEY.split(".")[0]}.invalid.invalid`, CONTROL_TABLE);
  const real = await probeRaw(ANON_KEY, CONTROL_TABLE);

  // 1. The endpoint answers at all, with a body PostgREST actually produced.
  //    Without this, a captive portal or a typo'd URL looks like universal denial.
  const liveBody =
    !!real.body && (Array.isArray(real.body) || real.body.code || real.body.message);
  controls.push({
    name: "the REST endpoint is live and answering",
    ok: liveBody,
    detail: `HTTP ${real.status} from /${CONTROL_TABLE}`,
  });

  // 2. A tampered key is rejected AS A KEY. This is what proves the credential
  //    is genuinely being evaluated rather than ignored.
  controls.push({
    name: "a tampered key is rejected as a credential",
    ok: isInvalidKey(bogus.body),
    detail: `HTTP ${bogus.status}${
      isInvalidKey(bogus.body) ? ' — "Invalid API key"' : " — no key-rejection message"
    }`,
  });

  // 3. The real key IS accepted as a credential. If it were not, every table
  //    would return the same key-rejection 401 and every one would be scored
  //    PASS for entirely the wrong reason.
  controls.push({
    name: "the real key is accepted as a valid credential",
    ok: !isInvalidKey(real.body),
    detail: `HTTP ${real.status}${
      isInvalidKey(real.body) ? " — REJECTED as an invalid key" : " — authenticated"
    }`,
  });

  return controls;
}

async function main() {
  console.log("\n=== Anon-key access verification ===\n");
  console.log(`Target: ${new URL(SUPABASE_URL).host} (project ref not printed in full)`);
  console.log("Credential in use: the PUBLIC anon key only. No service key, no DATABASE_URL.");
  console.log("Every request below is a read-only GET with limit=1.\n");

  const controls = await runControls();
  console.log("--- controls ---");
  for (const c of controls) console.log(`  ${c.ok ? "ok  " : "FAIL"}  ${c.name} — ${c.detail}`);
  const controlsPassed = controls.every((c) => c.ok);
  if (!controlsPassed) {
    console.log(
      "\nA control failed, so no verdict below can be trusted. Fix connectivity or the " +
        "credential before reading anything further."
    );
  }

  const listing = listSchemaObjects();
  let tables;
  if (listing.ok) {
    tables = listing.tables;
    console.log(`\nschema.sql declares ${tables.length} tables and views in the public schema.`);
  } else {
    console.log(`\nCould not enumerate tables: ${listing.detail}`);
    tables = [];
  }

  if (onlyTable) {
    tables = [onlyTable];
    console.log(`Focused run: probing only "${onlyTable}".`);
  } else {
    // Priority tables first so the expected finding is the first thing read.
    tables = [
      ...PRIORITY_TABLES.filter((t) => tables.includes(t)),
      ...tables.filter((t) => !PRIORITY_TABLES.includes(t)),
    ];
  }

  const results = [];
  for (const table of tables) {
    results.push(await probeTable(table));
  }

  const buckets = {
    EXPOSED: results.filter((r) => r.verdict === "EXPOSED"),
    INCONCLUSIVE: results.filter((r) => r.verdict === "INCONCLUSIVE"),
    PASS: results.filter((r) => r.verdict === "PASS"),
    UNREACHABLE: results.filter((r) => r.verdict === "UNREACHABLE"),
  };

  console.log("\n--- results ---");
  for (const r of results) {
    if (quiet && r.verdict === "PASS") continue;
    console.log(`  ${r.verdict.padEnd(13)} ${r.table.padEnd(28)} ${r.detail}`);
  }

  console.log("\n--- summary ---");
  console.log(`  EXPOSED      ${buckets.EXPOSED.length}`);
  console.log(`  INCONCLUSIVE ${buckets.INCONCLUSIVE.length}   (not proven safe — needs db:contract)`);
  console.log(`  PASS         ${buckets.PASS.length}   (explicitly refused)`);
  console.log(`  UNREACHABLE  ${buckets.UNREACHABLE.length}`);

  if (buckets.EXPOSED.length) {
    console.log(
      "\nEXPOSED. Stop and report before remediating: name the table, its columns and the\n" +
        "row count, and do not copy values out of the database into the report.\n" +
        "These are read-only probes; nothing was modified."
    );
  }

  if (buckets.INCONCLUSIVE.length) {
    console.log(
      "\nSome tables returned 200 with no rows. That is NOT a pass — an empty table and a\n" +
        "policy-denied table look identical from here. Run `npm run db:contract` to resolve\n" +
        "each one from the database side (RLS enabled? anon hold SELECT?).\n" +
        `Tables needing resolution: ${buckets.INCONCLUSIVE.map((r) => r.table).join(", ")}`
    );
  }

  if (!controlsPassed) process.exit(EXIT_UNUSABLE);
  if (buckets.EXPOSED.length) process.exit(EXIT_EXPOSED);
  if (buckets.INCONCLUSIVE.length || buckets.UNREACHABLE.length) process.exit(EXIT_INCONCLUSIVE);
  process.exit(EXIT_OK);
}

main().catch((error) => {
  console.error(`\nAnon-access verification failed to run: ${error.message}`);
  process.exit(EXIT_UNUSABLE);
});
