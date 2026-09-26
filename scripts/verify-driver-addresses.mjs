// The database half of the driver address migration's manual verification.
//
// WHY THIS EXISTS. The route tests (`src/app/api/drivers/route.test.js` and its
// sibling `[id]` file) double `saveAddress` and the PSGC resolver, so they prove
// the route's CONTROL FLOW and nothing about the database. Nothing in them shows
// that a row reaches Postgres, that the pin lands as a real coordinate pair, or
// that the composed address is what actually got mirrored into the text column.
// That gap is what the manual pass at /drivers/new is for — and this script
// exists because the DB half of that pass has no other reliable way to run here:
// `psql` is unavailable in this repo, and `CLAUDE.md` records that the Supabase
// SQL editor silently targeted the wrong project once already.
//
// IT DOES NOT CREATE ANYTHING. It verifies a driver you already created through
// the UI. Creating one from here would write real rows to the live database —
// there is no scratch database — and would bypass the cascade and the pin, which
// are the two things this pass exists to exercise.
//
// READ-ONLY BY CONSTRUCTION. Every statement is a SELECT on `drivers`,
// `employees` and `addresses`. There is no INSERT, UPDATE, DELETE or DDL in this
// file, and it never prints a credential or a connection string.
//
// PRIVACY: the output contains a real person's home address. That is deliberate
// — the operator has to confirm the stored place is the one they picked — but it
// also means the output must NOT be pasted into the Capstone vault, a report, or
// any other committed file. `--quiet` withholds the details that quote stored
// address TEXT — the composed `formatted_address` and the two mirrored driver
// columns — and drops the stored-rows block. Ids, PSGC codes, `manual` sources and
// booleans still print; use it when the output is going anywhere but a terminal.
//
// That withholding is marked PER CHECK rather than applied to the whole report,
// because most details are harmless and useful — `(4)`, `(manual)`,
// `(1380100167)` are the difference between a diagnosable run and a useless one.
// A check whose detail echoes stored text carries `sensitive: true` (see the
// three below). **Adding a check that prints a stored column means marking it**,
// or `--quiet` silently stops meaning what this paragraph says it means — which
// is exactly how it was wrong before: the flag suppressed the stored-rows block
// and then printed the address anyway, twice, inside the PASS details.
//
// Run:
//   node scripts/verify-driver-addresses.mjs --latest
//   node scripts/verify-driver-addresses.mjs --driver=<id>
//   node scripts/verify-driver-addresses.mjs --latest --pin=no --quiet
//
// `--latest` picks the highest `driver_id` — the newest driver — so the runbook
// (`Capstone/07 - Development/Driver Address Verification Runbook.md`) does not require
// finding a primary key first. The list UI shows row positions, not driver_ids, so
// reading an id off the screen is a guess; this replaces it with a SELECT.
//
// The pin check defaults to "the residential address has a real lat/lng pair",
// which is what the runbook asks for. Pass --pin=no when you deliberately did
// not drop one.
//
// THE RENAME CHECK IS A RE-RUN. Edit that driver, change only a name, then run
// this again. The fingerprint line at the end must be byte-identical: same two address
// ids, same `created_at` on both rows. A different id means a new registry row was
// appended (the omitted-vs-empty rule leaking); a different `created_at` would mean a row
// was rewritten, which the registry never does. `--latest` is safe for this comparison
// because renaming does not create a driver — the same row is resolved both times.
//
// THE REGISTRY IS REPORTED IN FULL, NOT ONLY THE TWO ROWS IN USE. Every other check
// here asks what `drivers.address_id` points AT, and none of them can see the rows
// nothing points at. Since the registry is append-only, those rows are permanent:
// a row an operator replaced is still there, and so is a row written by a save that
// never managed to repoint the driver — the partial-success defect the POST
// restructure removed, and the only place that failure is visible at all.
//
// Those two are indistinguishable from a single run, so this REPORTS the registry
// rather than asserting about it: counts, ids, timestamps and PSGC codes, never
// address text. A check that failed on any orphan would go red on a healthy
// database the first time somebody edited an address. The orphan comparison is a
// re-run, the same mechanic as the rename check above — note the ids, make the
// change, run again, and an orphan that appears only in the second run came from
// that save.
//
// The referencing columns are read from the LIVE catalog rather than hardcoded.
// `schema.sql` was found five migrations behind live on 2026-09-25; a stale list
// would report rows as orphaned that a newer table actually references, which is
// the wrong direction — it sends someone hunting a defect that is not there. If a
// composite foreign key ever references `addresses`, this says so and skips rather
// than computing a number that could be wrong in the direction of HIDING an orphan.

import { loadEnvLocal } from "./load-env.mjs";
import pg from "pg";

loadEnvLocal();

const args = process.argv.slice(2);
const quiet = args.includes("--quiet");
const latest = args.includes("--latest");
const driverArg = args.find((a) => a.startsWith("--driver="))?.split("=")[1] ?? null;
const pinArg = args.find((a) => a.startsWith("--pin="))?.split("=")[1] ?? "yes";

// 0 = every check passed, 1 = at least one failed, 3 = could not run.
const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_UNUSABLE = 3;

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL is not set (.env.local or .env).\n" +
      "This reads the live database, which is the whole point — the route tests cannot.\n" +
      "Set it and re-run."
  );
  process.exit(EXIT_UNUSABLE);
}

// `--latest` exists because the id is not always to hand. The driver list shows row
// positions rather than primary keys, so "the driver I just made is #94" was read off
// the screen and named a `driver_id` that does not exist — the first run of this script
// failed on exactly that. One extra SELECT removes the guess.
let driverId = Number(driverArg);
if (!latest && (!Number.isSafeInteger(driverId) || driverId <= 0)) {
  console.error(
    "Usage: node scripts/verify-driver-addresses.mjs (--driver=<id> | --latest) [--pin=no] [--quiet]\n\n" +
      "Pass the driver_id of the driver you created at /drivers/new, or --latest to verify\n" +
      "the most recently created driver without looking the id up first. This script never\n" +
      "creates one: a throwaway driver would be a real row in the live database, and it\n" +
      "would bypass the cascade and the pin that this pass exists to exercise."
  );
  process.exit(EXIT_UNUSABLE);
}

const expectPin = pinArg !== "no";

// ---------------------------------------------------------------------------
// checks
// ---------------------------------------------------------------------------

/** @type {{ok: boolean, name: string, detail?: string, sensitive?: boolean}[]} */
const checks = [];
// `sensitive` marks a detail that quotes a stored address column. Under `--quiet`
// those details are withheld; every other detail still prints. See the header.
const check = (ok, name, detail, sensitive = false) =>
  checks.push({ ok: Boolean(ok), name, detail, sensitive });

// Avoids printing a value that happens to be falsy-looking as if it were absent.
const show = (value) => (value === null || value === undefined ? "NULL" : String(value));

// Presence, never the value. A stored coordinate pair IS a home location — seven
// decimal places is a more precise disclosure than the street text `--quiet` exists to
// withhold — so the pin checks report set/NULL and never the numbers themselves. This
// is the standing rule for this surface: booleans or key NAMES, never a value. The
// checks are about presence anyway (`chk_addresses_coords_pair` makes a half-pair
// unstorable), so nothing diagnosable is lost.
const pairState = (row) =>
  `lat=${row?.latitude === null || row?.latitude === undefined ? "NULL" : "set"} ` +
  `lng=${row?.longitude === null || row?.longitude === undefined ? "NULL" : "set"}`;

const DRIVER_SQL = `
  SELECT d.driver_id, d.employee_id, d.deleted_at,
         d.address_id, d.emergency_contact_address_id,
         d.address        AS residential_text,
         d.emergency_contact_address AS emergency_text,
         e.deleted_at     AS employee_deleted_at
    FROM drivers d
    LEFT JOIN employees e ON e.employee_id = d.employee_id
   WHERE d.driver_id = $1
`;

// Highest `driver_id` is the newest driver, because the column is a serial. Deliberately
// not filtered on `deleted_at`: if the newest driver was just archived, that is worth
// seeing rather than silently skipping to an older one.
const LATEST_SQL = `
  SELECT d.driver_id, d.created_at
    FROM drivers d
   ORDER BY d.driver_id DESC
   LIMIT 1
`;

// Deliberately NOT `SELECT *`. Every column here is one the script either
// asserts on or prints, and `raw_input` — the most sensitive thing on the table —
// is left out rather than fetched and discarded.
const ADDRESSES_SQL = `
  SELECT address_id, formatted_address,
         street_number, street_name,
         barangay, city, province,
         postal_code, postal_code_source,
         latitude, longitude, provider, verified,
         address_type, psgc_barangay_code, created_at
    FROM addresses
   WHERE address_id = ANY($1::int[])
`;

// `resolveBarangayChain`'s join, verbatim (`src/lib/geo/psgc.js:101-125`), with the
// display names dropped — only the codes are needed to answer "does this resolve".
//
// This exists because the picker's pre-fill walks three reads in order (the row
// exists → it carries a `psgc_barangay_code` → that code still resolves), and
// `loadStructuredAddress` returns a DIFFERENT reason for each failure while the UI
// shows one grey line for all three. A blank picker is therefore a message with
// three possible causes. Reproducing the same three steps here names the cause from
// the database side, which the browser cannot be asked to do reliably.
const CHAIN_SQL = `
  SELECT b.psgc_code AS barangay_code,
         c.psgc_code AS city_code,
         r.psgc_code AS region_code,
         p.psgc_code AS province_code
    FROM public.ph_barangays b
    JOIN public.ph_cities  c ON c.psgc_code = b.city_code
    JOIN public.ph_regions r ON r.psgc_code = c.region_code
    LEFT JOIN public.ph_provinces p ON p.psgc_code = c.province_code
   WHERE b.psgc_code = $1
`;

// ── The address registry, in full ────────────────────────────────────────────
// Three columns reference `public.addresses` today — `drivers.address_id`,
// `drivers.emergency_contact_address_id` and `locations.address_id` — and the
// migration that added the last of them is why this file is not hardcoded to that
// list. See the header for the rest of the reasoning.
const ADDRESS_REFERRERS_SQL = `
  SELECT c.conname,
         n.nspname                 AS schema_name,
         cl.relname                AS table_name,
         a.attname                 AS column_name,
         array_length(c.conkey, 1) AS column_count
    FROM pg_constraint c
    JOIN pg_class     cl ON cl.oid = c.conrelid
    JOIN pg_namespace n  ON n.oid = cl.relnamespace
    JOIN pg_attribute a  ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
   WHERE c.contype = 'f'
     AND c.confrelid = 'public.addresses'::regclass
   ORDER BY 2, 3, 4
`;

const TOTAL_ADDRESSES_SQL = `SELECT count(*)::int AS total FROM public.addresses`;

/** A SQL identifier, quoted. Only ever fed from the live catalog above. */
const ident = (name) => `"${String(name).replace(/"/g, '""')}"`;

/** How many orphan ids the report lists before summarising the rest. */
const MAX_PRINTED_ORPHANS = 20;

/**
 * The rows in `addresses` that nothing references.
 *
 * Built from the catalog rather than written out, so a table that gains an
 * `address_id` later cannot make its rows look orphaned. Ids, `created_at` and the
 * PSGC code only — `formatted_address` is deliberately NOT selected, because an
 * orphaned row still holds a real home address and this block prints in the middle
 * of a run whose output may be read anywhere. See the header's privacy paragraph.
 *
 * @param {{schemaName: string, tableName: string, columnName: string}[]} referrers
 */
function orphanSql(referrers) {
  const notExists = referrers
    .map(
      (r) =>
        `NOT EXISTS (SELECT 1 FROM ${ident(r.schemaName)}.${ident(r.tableName)} ref\n` +
        `                WHERE ref.${ident(r.columnName)} = addr.address_id)`
    )
    .join("\n           AND ");
  return `
    SELECT addr.address_id, addr.created_at, addr.psgc_barangay_code
      FROM public.addresses addr
     WHERE ${notExists}
     ORDER BY addr.address_id
  `;
}

async function main() {
  const target = new URL(process.env.DATABASE_URL);
  console.log(`Target: ${target.hostname}:${target.port || 5432}/${target.pathname.replace(/^\//, "")}`);
  console.log("Read-only: SELECTs only. No DML, no DDL, no credentials printed.\n");
  if (!quiet) {
    console.log(
      "NOTE: the output below contains a real home address. Do not paste it into the\n" +
        "Capstone vault or any committed file — use --quiet when it needs to go somewhere.\n"
    );
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Resolved before anything is printed about the driver, so the header always names
  // the row that was actually checked rather than the one that was asked for.
  if (latest) {
    const { rows } = await client.query(LATEST_SQL);
    if (!rows.length) {
      console.error("FAIL  there are no drivers at all — nothing to verify.");
      await client.end();
      process.exit(EXIT_FAILED);
    }
    driverId = rows[0].driver_id;
    const created = rows[0].created_at?.toISOString?.() ?? rows[0].created_at;
    console.log(`--latest resolved to driver_id ${driverId} (created ${show(created)}).`);
    console.log("If that is not the driver you just created, re-run with --driver=<id>.\n");
  }
  console.log(`Driver: ${driverId}`);

  let driver;
  let addressRows = [];
  // Per-address-id result of replaying the picker's third read. A null `chainRow`
  // with a null `chainError` means the query ran and matched nothing, which is the
  // `unknown-barangay` outcome and not a failure of the query itself.
  const chains = new Map();
  // The whole-registry view — total rows, the columns that reference them, and the
  // ids nothing points at. Deliberately not filtered by `driverId`: the question
  // "what else is in here?" is the one the other checks cannot ask.
  let registry = null;
  try {
    const { rows } = await client.query(DRIVER_SQL, [driverId]);
    driver = rows[0];

    // Both queries run inside the try so the `finally` is the only exit from this
    // block — an early `process.exit()` here would terminate the process with the
    // connection still open rather than ending it.
    if (driver) {
      const ids = [driver.address_id, driver.emergency_contact_address_id].filter(
        (id) => id !== null && id !== undefined
      );
      if (ids.length) {
        const { rows: found } = await client.query(ADDRESSES_SQL, [ids]);
        addressRows = found;

        // ...and the chain read the picker's pre-fill depends on. Both queries sit
        // inside this try so `finally` remains the only exit, as above.
        for (const row of addressRows) {
          if (!row.psgc_barangay_code) continue;
          try {
            const { rows: chain } = await client.query(CHAIN_SQL, [row.psgc_barangay_code]);
            chains.set(row.address_id, { row: chain[0] ?? null, error: null });
          } catch (e) {
            chains.set(row.address_id, { row: null, error: e.message });
          }
        }
      }
    }

    // ── The registry's own state, independent of which driver was asked for ───
    // Its own try/catch so a catalog query that fails reports as an unaccounted
    // registry rather than taking the whole run down with it: everything above is
    // still worth reading, and "the numbers could not be produced" is a different
    // statement from "there are no orphans".
    try {
      const { rows: referrerRows } = await client.query(ADDRESS_REFERRERS_SQL);
      const { rows: totalRows } = await client.query(TOTAL_ADDRESSES_SQL);
      registry = {
        total: totalRows[0]?.total ?? 0,
        referrers: referrerRows,
        orphans: [],
        error: null,
        skipped: null,
      };

      // A composite key cannot be answered by the per-column NOT EXISTS above:
      // matching one column of a pair is not a reference to the row, so the query
      // would over-count referrers and hide orphans. None exist today; if one
      // appears, say so rather than print a number that could be wrong that way.
      const composite = referrerRows.filter((r) => Number(r.column_count) > 1);

      if (!referrerRows.length) {
        registry.skipped =
          "no foreign key in the catalog references public.addresses, which cannot be right while drivers.address_id exists";
      } else if (composite.length) {
        registry.skipped =
          `composite foreign key(s) reference addresses (${[
            ...new Set(composite.map((r) => `${r.table_name}.${r.conname}`)),
          ].join(", ")}), which a per-column NOT EXISTS cannot answer`;
      } else {
        const { rows: orphanRows } = await client.query(
          orphanSql(
            referrerRows.map((r) => ({
              schemaName: r.schema_name,
              tableName: r.table_name,
              columnName: r.column_name,
            }))
          )
        );
        registry.orphans = orphanRows;
      }
    } catch (e) {
      registry = { total: null, referrers: [], orphans: [], error: e.message, skipped: null };
    }
  } finally {
    await client.end();
  }

  if (!driver) {
    console.log(`FAIL  no driver row with driver_id = ${driverId}`);
    console.log("\nNothing to verify — check the id, or create the driver first.");
    process.exit(EXIT_FAILED);
  }

  const byId = new Map(addressRows.map((r) => [r.address_id, r]));

  // ── The driver row ────────────────────────────────────────────────────────
  check(!driver.deleted_at, "driver row is not soft-deleted", show(driver.deleted_at));
  check(
    driver.employee_id !== null && driver.employee_deleted_at === null,
    "driver is linked to a live employee",
    `employee_id=${show(driver.employee_id)}`
  );

  // ── Both ids present, distinct, and resolvable ────────────────────────────
  // The whole point of the migration: an operator who picked two addresses must
  // not end up with a driver holding NULL. That was the partial success the POST
  // restructure removed, so it is the first thing checked.
  check(
    driver.address_id !== null && driver.address_id !== undefined,
    "drivers.address_id is set",
    show(driver.address_id)
  );
  check(
    driver.emergency_contact_address_id !== null &&
      driver.emergency_contact_address_id !== undefined,
    "drivers.emergency_contact_address_id is set",
    show(driver.emergency_contact_address_id)
  );
  check(
    driver.address_id !== driver.emergency_contact_address_id,
    "the two ids point at different registry rows",
    `${show(driver.address_id)} vs ${show(driver.emergency_contact_address_id)}`
  );

  const residential = byId.get(driver.address_id);
  const emergency = byId.get(driver.emergency_contact_address_id);
  check(Boolean(residential), "the residential id resolves to an addresses row");
  check(Boolean(emergency), "the emergency id resolves to an addresses row");

  // ── Per-row expectations ──────────────────────────────────────────────────
  /**
   * The assertions that hold for BOTH rows, kept in one place so the residential
   * and emergency halves cannot quietly diverge.
   */
  function checkRow(label, row) {
    if (!row) return;
    check(
      row.provider === "manual",
      `${label}: provider is 'manual'`,
      show(row.provider)
    );
    check(
      row.verified === false,
      `${label}: verified is false`,
      // A dropped pin is an operator's claim about where a door is, not a
      // provider verification. Nothing on this path may set it true.
      show(row.verified)
    );
    check(
      row.address_type === "home",
      `${label}: address_type is 'home'`,
      show(row.address_type)
    );
    // The cascade's fingerprint. A NULL here means the address arrived as free
    // text rather than through the picker, which is the one thing that would
    // make every other pass misleading.
    check(
      Boolean(row.psgc_barangay_code),
      `${label}: psgc_barangay_code is set`,
      show(row.psgc_barangay_code)
    );
    check(
      Boolean(row.formatted_address && row.formatted_address.trim()),
      `${label}: formatted_address is not blank`,
      show(row.formatted_address),
      true // the composed address IS the personal value — withheld under --quiet
    );

    // ── The two fields the picker's own rule demands and the server does not ──
    //
    // `REQUIRED_DETAILS` (src/lib/address/structured.js) requires a house number,
    // a street and a ZIP for a `home` address; the SERVER requires none of the
    // three, and the picker forces `type: "home"`. So a row can be perfectly valid
    // — every check above passing — and still seed a form whose "Use this address"
    // button never enables, because the operator is shown a form that looks
    // complete with one empty required field somewhere in it. The pin then cannot
    // leave the browser at all, and nothing else in this run says why: a street
    // with no number leaves `formatted_address` non-blank.
    //
    // Booleans only, deliberately. Which fields are empty is the diagnostic; their
    // contents are the operator's address and have no business in this output.
    check(
      Boolean(row.street_number && String(row.street_number).trim()),
      `${label}: a house number is stored (the picker's 'home' rule demands one)`,
      row.street_number ? "(set)" : "(NULL)"
    );
    check(
      Boolean(row.street_name && String(row.street_name).trim()),
      `${label}: a street is stored (same rule)`,
      row.street_name ? "(set)" : "(NULL)"
    );

    // `chk_addresses_coords_pair` makes a half-pair unstorable, so this failing
    // means the constraint is gone rather than that someone typed a latitude.
    const hasLat = row.latitude !== null;
    const hasLng = row.longitude !== null;
    check(
      hasLat === hasLng,
      `${label}: coordinates are both present or both NULL`,
      pairState(row)
    );
    check(
      Boolean(row.postal_code) && row.postal_code_source === "manual",
      `${label}: the ZIP is recorded as manual`,
      `postal_code=${show(row.postal_code)} source=${show(row.postal_code_source)}`
    );
  }

  checkRow("residential", residential);
  checkRow("emergency", emergency);

  // ── Pre-fill: can the picker re-open each saved address? ──────────────────
  /**
   * Replays the three reads `loadStructuredAddress` makes and names the one that
   * stops it. Three of the loader's four reasons are reachable here; `no-address-id`
   * is already covered by the checks above.
   *
   * Worth having as a check rather than a note: a blank picker and a legacy address
   * look identical on screen, and the runbook's re-open step cannot tell "the loader
   * said no" from "the loader was never wired to this field".
   */
  function checkPrefill(label, row) {
    if (!row) return;
    const probe = chains.get(row.address_id);
    const detail = !row.psgc_barangay_code
      ? "row carries no psgc_barangay_code — the loader reports 'no-psgc-code'"
      : probe?.error
        ? `chain query failed: ${probe.error} — the loader reports 'unavailable'`
        : probe?.row
          ? `${show(probe.row.barangay_code)} -> city ${show(probe.row.city_code)} / region ${show(probe.row.region_code)}`
          : `no chain row for ${show(row.psgc_barangay_code)} — the loader reports 'unknown-barangay'`;
    check(
      Boolean(probe?.row),
      `${label}: the stored barangay code resolves, so the picker can re-open this address`,
      detail
    );
  }

  checkPrefill("residential", residential);
  checkPrefill("emergency", emergency);

  // ── The pin ───────────────────────────────────────────────────────────────
  // This is the first surface to exercise the both-present branch of
  // chk_addresses_coords_pair; every address row written before it is NULL/NULL,
  // because the location and hotel dialogs pass showPinMap={false}. If the
  // residential row has no pair, either the pin was not dropped or the dialog's
  // map never reached the server.
  if (expectPin) {
    check(
      Boolean(residential) && residential.latitude !== null && residential.longitude !== null,
      "residential: a real latitude/longitude pair is stored (the dropped pin)",
      pairState(residential)
    );
  } else {
    checks.push({
      ok: true,
      name: "residential pin check skipped (--pin=no)",
      detail: pairState(residential),
    });
  }

  // ── The mirrored text columns ─────────────────────────────────────────────
  // The mirror is what keeps every existing reader — the driver detail page
  // included — working without being touched. If these drift, the page shows one
  // place while the registry points at another.
  check(
    Boolean(residential) && driver.residential_text === residential.formatted_address,
    "drivers.address equals the residential row's formatted_address",
    `drivers.address=${show(driver.residential_text)}`,
    true // mirrors the residential row's address text
  );
  check(
    Boolean(emergency) && driver.emergency_text === emergency.formatted_address,
    "drivers.emergency_contact_address equals the emergency row's formatted_address",
    `drivers.emergency_contact_address=${show(driver.emergency_text)}`,
    true // mirrors the emergency row's address text
  );

  // ── The whole registry ────────────────────────────────────────────────────
  // A check rather than a bare print, so that failing to PRODUCE this section
  // turns the run red instead of quietly omitting it. What it asserts is the
  // report's own completeness, NOT a count: the rows nothing points at include
  // every address anyone has ever replaced, which is normal, and a run that went
  // red on those would be wrong on a healthy database. See the header.
  const referrerColumns = [
    ...new Set((registry?.referrers ?? []).map((r) => `${r.table_name}.${r.column_name}`)),
  ];
  check(
    Boolean(registry) && !registry.error && !registry.skipped,
    "the address registry was accounted for end to end",
    registry?.error
      ? `query failed: ${registry.error}`
      : registry?.skipped
        ? registry.skipped
        : `${show(registry?.total)} row(s), referenced by ${referrerColumns.join(", ")}`
  );

  // ---------------------------------------------------------------------------
  // report
  // ---------------------------------------------------------------------------

  console.log("");
  for (const c of checks) {
    const mark = c.ok ? "PASS" : "FAIL";
    // `--quiet` withholds only the details flagged as quoting a stored column.
    // Everything else keeps its detail, because `(4)` and `(manual)` are not
    // personal and are most of what makes a run diagnosable from the output alone.
    // The marker is printed rather than omitted so a withheld value cannot be
    // mistaken for a check that had no detail to give.
    const detail =
      quiet && c.sensitive
        ? "  (withheld: --quiet)"
        : c.detail && c.detail !== "NULL"
          ? `  (${c.detail})`
          : "";
    console.log(`  ${mark}  ${c.name}${detail}`);
  }

  if (!quiet) {
    console.log("\n── stored rows ──");
    console.log(
      `  residential  id=${show(residential?.address_id)}  ${show(residential?.formatted_address)}`
    );
    console.log(
      `  emergency    id=${show(emergency?.address_id)}  ${show(emergency?.formatted_address)}`
    );
    if (residential) {
      console.log(
        `  residential  barangay=${show(residential.barangay)} city=${show(residential.city)} ` +
          `province=${show(residential.province)} psgc=${show(residential.psgc_barangay_code)}`
      );
    }
  }

  // Printed whether or not `--quiet` is set: ids, timestamps and PSGC codes are
  // not address text, and this block is the only place the registry's total state
  // is visible. The residential/emergency blocks above are the ones that quote a
  // stored address, which is what `--quiet` exists for.
  console.log("\n── address registry ──");
  if (!registry || registry.error || registry.skipped) {
    console.log(
      `  not accounted for: ${registry?.error ?? registry?.skipped ?? "the registry query did not run"}`
    );
  } else {
    const orphans = registry.orphans;
    console.log(
      `  ${show(registry.total)} row(s) in total — ` +
        `${show(registry.total - orphans.length)} referenced by ${referrerColumns.join(", ")}, ` +
        `${orphans.length} referenced by nothing`
    );
    console.log(
      "  A row nothing points at is NORMAL after an address is replaced: the registry is append-only\n" +
        "  and the row the record used to point at stays. It is also what a save that wrote a row and\n" +
        "  never repointed the driver leaves behind, and this is the only place that is visible.\n" +
        "  To tell the two apart: note the ids below, make the change, run again. An id that appears\n" +
        "  only in the second run came from that change."
    );
    for (const row of orphans.slice(0, MAX_PRINTED_ORPHANS)) {
      const created = row.created_at?.toISOString?.() ?? row.created_at;
      console.log(
        `  unreferenced  id=${show(row.address_id)}  created=${show(created)}  psgc=${show(row.psgc_barangay_code)}`
      );
    }
    if (orphans.length > MAX_PRINTED_ORPHANS) {
      console.log(`  … and ${orphans.length - MAX_PRINTED_ORPHANS} more, not listed here.`);
    }
  }

  // The rename check, made mechanical: this line must be unchanged after an edit
  // that only renames the driver.
  console.log("\n── fingerprint (must be IDENTICAL after a rename-only edit) ──");
  console.log(
    `  ${show(residential?.address_id)}@${show(residential?.created_at?.toISOString?.() ?? residential?.created_at)}` +
      `  ${show(emergency?.address_id)}@${show(emergency?.created_at?.toISOString?.() ?? emergency?.created_at)}`
  );

  const failed = checks.filter((c) => !c.ok);
  console.log("");
  console.log(
    failed.length === 0
      ? `All ${checks.length} checks passed.`
      : `${failed.length} of ${checks.length} checks FAILED.`
  );

  // What this cannot answer, stated rather than implied — the two steps that
  // still need a person at a browser.
  console.log(
    "\nNOT covered here: the cascade interaction itself (that the picked barangay is what\n" +
      "you meant to pick) and whether /drivers/<id> renders both addresses. This script\n" +
      "reads what was stored; it cannot see what the form showed you or what the page draws."
  );

  // And the limit on the registry block above, which is the one a reader is most
  // likely to over-read: it lists unreferenced rows but attributes none of them.
  console.log(
    "\nThe address registry block cannot say WHY a row is unreferenced, and does not try.\n" +
      "A replaced address and an abandoned one look identical in a single run — both are a\n" +
      "row nothing points at. The second run is what separates them. It also cannot see a\n" +
      "row that was written and rolled back with its transaction, or a row deleted outside\n" +
      "this app; there is no history in the table, only what is there now."
  );

  process.exit(failed.length === 0 ? EXIT_OK : EXIT_FAILED);
}

main().catch((error) => {
  console.error(`\nCould not run: ${error.message}`);
  process.exit(EXIT_UNUSABLE);
});
