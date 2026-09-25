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
// any other committed file. `--quiet` prints verdicts only, no values, for when
// the output is going anywhere but a terminal.
//
// Run:
//   node scripts/verify-driver-addresses.mjs --latest
//   node scripts/verify-driver-addresses.mjs --driver=<id>
//   node scripts/verify-driver-addresses.mjs --latest --pin=no --quiet
//
// `--latest` picks the highest `driver_id` — the newest driver — so the runbook does not
// require finding a primary key first. The list UI shows row positions, not driver_ids, so
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

/** @type {{ok: boolean, name: string, detail?: string}[]} */
const checks = [];
const check = (ok, name, detail) => checks.push({ ok: Boolean(ok), name, detail });

// Avoids printing a value that happens to be falsy-looking as if it were absent.
const show = (value) => (value === null || value === undefined ? "NULL" : String(value));

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
         barangay, city, province,
         postal_code, postal_code_source,
         latitude, longitude, provider, verified,
         address_type, psgc_barangay_code, created_at
    FROM addresses
   WHERE address_id = ANY($1::int[])
`;

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
      }
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
      show(row.formatted_address)
    );

    // `chk_addresses_coords_pair` makes a half-pair unstorable, so this failing
    // means the constraint is gone rather than that someone typed a latitude.
    const hasLat = row.latitude !== null;
    const hasLng = row.longitude !== null;
    check(
      hasLat === hasLng,
      `${label}: coordinates are both present or both NULL`,
      `lat=${show(row.latitude)} lng=${show(row.longitude)}`
    );
    check(
      Boolean(row.postal_code) && row.postal_code_source === "manual",
      `${label}: the ZIP is recorded as manual`,
      `postal_code=${show(row.postal_code)} source=${show(row.postal_code_source)}`
    );
  }

  checkRow("residential", residential);
  checkRow("emergency", emergency);

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
      `lat=${show(residential?.latitude)} lng=${show(residential?.longitude)}`
    );
  } else {
    checks.push({
      ok: true,
      name: "residential pin check skipped (--pin=no)",
      detail: `lat=${show(residential?.latitude)} lng=${show(residential?.longitude)}`,
    });
  }

  // ── The mirrored text columns ─────────────────────────────────────────────
  // The mirror is what keeps every existing reader — the driver detail page
  // included — working without being touched. If these drift, the page shows one
  // place while the registry points at another.
  check(
    Boolean(residential) && driver.residential_text === residential.formatted_address,
    "drivers.address equals the residential row's formatted_address",
    `drivers.address=${show(driver.residential_text)}`
  );
  check(
    Boolean(emergency) && driver.emergency_text === emergency.formatted_address,
    "drivers.emergency_contact_address equals the emergency row's formatted_address",
    `drivers.emergency_contact_address=${show(driver.emergency_text)}`
  );

  // ---------------------------------------------------------------------------
  // report
  // ---------------------------------------------------------------------------

  console.log("");
  for (const c of checks) {
    const mark = c.ok ? "PASS" : "FAIL";
    const detail = c.detail && c.detail !== "NULL" ? `  (${c.detail})` : "";
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

  process.exit(failed.length === 0 ? EXIT_OK : EXIT_FAILED);
}

main().catch((error) => {
  console.error(`\nCould not run: ${error.message}`);
  process.exit(EXIT_UNUSABLE);
});
