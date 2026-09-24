import { loadEnvLocal } from "./load-env.mjs";
// Run with:
//   node --import ./scripts/route-harness-loader.mjs scripts/backfill-location-addresses.mjs
//   node --import ./scripts/route-harness-loader.mjs scripts/backfill-location-addresses.mjs --snapshot=scratch/locations-before.json
//   node --import ./scripts/route-harness-loader.mjs scripts/backfill-location-addresses.mjs --verify --snapshot=scratch/locations-before.json
//   node --import ./scripts/route-harness-loader.mjs scripts/backfill-location-addresses.mjs --apply --snapshot=scratch/locations-before.json
//
// The loader is required: `saveAddress`, `resolveStructuredAddress` and the PSGC
// service are written against the "@/..." alias, which plain Node ESM does not
// resolve.
loadEnvLocal();

import { readFileSync, writeFileSync } from "node:fs";
import { query, withTransaction } from "../src/lib/db.js";
import { saveAddress } from "../src/services/address.service.js";
import { resolveStructuredAddress } from "../src/lib/address/validate-structured.js";
import { resolveBarangayChain } from "../src/lib/geo/psgc.js";
import {
  BACKFILL_TARGETS,
  UPDATE_ADDRESS_ID_SQL,
  buildStructuredInput,
  classifyTarget,
  createWriteGuard,
  describeInsertParams,
  geographyMismatches,
  oneLine,
  quote,
  renderRecordedInsert,
} from "./lib/location-address-backfill.mjs";

// ============================================================================
// Give the three operational canonical locations — #1 CoCo Star Hotel,
// #8 NAIA Terminal 2 - Arrivals, #10 NAIA Terminal 3 - Arrivals (Bay 9) — a
// structured address, and point each location at it.
//
// WHAT THIS CHANGES, EXACTLY TWO STATEMENTS PER LOCATION
// -----------------------------------------------------
//   1. INSERT INTO addresses (...)   — a NEW row, via the real service
//   2. UPDATE locations SET address_id = $1 WHERE location_id = $2
//
// And nothing else. The location's `latitude` / `longitude` are never read as an
// input and never written; `locations.address` (the legacy free-text column) is
// never written; no other column of `locations` is named in any statement.
//
// WHY THE ADDRESS ROW CARRIES NO COORDINATES
// ------------------------------------------
// The operational point is owned by `locations.latitude` / `.longitude` — that
// pair is what the geofence, the route resolver and the trip monitor actually
// consume, and `locations` alone carries the mandatory `pickup_radius_m` /
// `dropoff_radius_m` those features need. Giving the address row its own
// coordinate would be a second answer to "where is this place" that has to be
// kept in step with the first.
//
// This is not a consequence of the dialog passing `showPinMap={false}`. The
// schema states it independently: `chk_addresses_coords_pair` permits
// (NULL, NULL) as its FIRST branch, and `saveAddress` writes `?? null`. NULL
// coordinates are an anticipated state, and this migration takes it deliberately.
//
// WHY `--apply` REQUIRES A SNAPSHOT
// ---------------------------------
// A migration that cannot be compared against the state it started from cannot
// be verified afterwards, only believed. `--snapshot=<path>` writes the before
// state; in `--apply` it is mandatory and is written BEFORE the first write.
//
// DRY RUN BY DEFAULT. `--apply` is required to write. The dry run does not
// re-implement the write: it runs the real `saveAddress` against a handle that
// REFUSES and RECORDS every write, so the statements in the report are the ones
// the service actually produced.
// ============================================================================

const APPLY = process.argv.includes("--apply");
const VERIFY = process.argv.includes("--verify");
const snapshotArg = process.argv.find((arg) => arg.startsWith("--snapshot="));
const SNAPSHOT_PATH = snapshotArg ? snapshotArg.slice("--snapshot=".length) : null;

const SELECT_TARGETS_SQL = `
  SELECT location_id, name, address, latitude, longitude, address_id, is_active
    FROM locations
   WHERE location_id = ANY($1::int[])
   ORDER BY location_id
`;

// EVERY location's link, so "no unrelated locations changed" is a comparison
// rather than an assumption. The previous STATE of the whole registry is not
// needed — the invariant is about `address_id` moving on a row that is not one
// of the three, and that is fully answered by this map.
const SELECT_ALL_LINKS_SQL = "SELECT location_id, address_id FROM locations ORDER BY location_id";

const COUNT_ADDRESSES_SQL = "SELECT count(*)::int AS n FROM addresses";

/** Read the before-state this run will be judged against. */
async function captureSnapshot() {
  const targetIds = BACKFILL_TARGETS.map((t) => t.locationId);
  const { rows: targets } = await query(SELECT_TARGETS_SQL, [targetIds]);
  const { rows: links } = await query(SELECT_ALL_LINKS_SQL);
  const { rows: [addresses] } = await query(COUNT_ADDRESSES_SQL);

  return {
    capturedAt: new Date().toISOString(),
    addressCount: addresses.n,
    locationAddressIds: Object.fromEntries(links.map((r) => [String(r.location_id), r.address_id])),
    // `numeric` arrives as a string from pg; kept verbatim so a later comparison
    // is a comparison of what the database holds, not of a round-tripped float.
    targets: targets.map((r) => ({
      locationId: r.location_id,
      name: r.name,
      address: r.address,
      latitude: r.latitude,
      longitude: r.longitude,
      addressId: r.address_id,
      isActive: r.is_active,
    })),
  };
}

function printTargetBanner(target, classification) {
  console.log(`\n── ${target.label}  (location_id ${target.locationId})`);
  console.log(`   status: ${classification.status}${classification.detail ? ` — ${classification.detail}` : ""}`);
}

async function main() {
  // ---- verification mode: read-only, compares live state to a snapshot ------
  if (VERIFY) {
    if (!SNAPSHOT_PATH) {
      console.error("--verify requires --snapshot=<path> naming the before-state to compare against.");
      process.exit(1);
    }
    const before = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
    const after = await captureSnapshot();
    process.exit(await runVerification(before, after));
  }

  if (APPLY && !SNAPSHOT_PATH) {
    console.error("--apply requires --snapshot=<path> so the run can be compared against its own before-state.");
    process.exit(1);
  }

  console.log(
    APPLY
      ? "🏨 Backfilling canonical-location structured addresses (APPLY — rows WILL be written)"
      : "🔍 Backfilling canonical-location structured addresses (DRY RUN — nothing is written)"
  );

  if (SNAPSHOT_PATH) {
    const snapshot = await captureSnapshot();
    writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
    const linked = Object.values(snapshot.locationAddressIds).filter((v) => v !== null).length;
    console.log(`Snapshot written to ${SNAPSHOT_PATH} — addresses: ${snapshot.addressCount}, locations already linked: ${linked}`);
  }

  const targetIds = BACKFILL_TARGETS.map((t) => t.locationId);
  const { rows: located } = await query(SELECT_TARGETS_SQL, [targetIds]);
  const byId = new Map(located.map((r) => [r.location_id, r]));
  console.log(`Found ${located.length} of ${BACKFILL_TARGETS.length} target locations.`);

  const plan = [];
  const skipped = [];
  const failed = [];
  let refusedTotal = 0;

  for (const target of BACKFILL_TARGETS) {
    const row = byId.get(target.locationId) ?? null;
    const classification = classifyTarget({ target, row });
    printTargetBanner(target, classification);

    if (classification.status !== "ready") {
      if (row) {
        console.log(`   BEFORE  address_id ${row.address_id ?? "NULL"}   coords ${row.latitude}, ${row.longitude}`);
        console.log(`   legacy  ${row.address ? `"${row.address}"` : "—"}`);
      }
      skipped.push({ target, classification });
      continue;
    }

    console.log(`   BEFORE  address_id ${row.address_id ?? "NULL"}   coords ${row.latitude}, ${row.longitude}`);
    console.log(`   legacy  ${row.address ? `"${row.address}"` : "—"}   ← not modified by this migration`);

    // ── the real resolver, against the live PSGC tables ──────────────────────
    const resolution = await resolveStructuredAddress(buildStructuredInput(target));
    if (!resolution.ok) {
      console.log(`   ✗ REFUSED by the resolver — ${resolution.error}`);
      failed.push({ target, error: resolution.error });
      continue;
    }
    const value = resolution.value;

    // The full chain is resolved separately ONLY to assert against the
    // operator's supplied expectation. `resolveStructuredAddress` returns the
    // names it derived but not the city CODE, and the code is what the
    // expectation is stated in. The row that gets written is the service's
    // output, not anything recomputed here.
    const chain = await resolveBarangayChain(target.barangayCode);
    const problems = chain ? geographyMismatches(target, chain) : [`barangay code ${target.barangayCode} did not resolve`];

    console.log(`   derived ${value.components.barangay} · ${value.components.city} · ${value.components.region}`);
    console.log(`           ${value.formattedAddress}`);

    if (problems.length) {
      // A geography mismatch is a STOP for this location. Reported, never
      // written: the code the operator chose and the city they expect disagree,
      // and silently storing the derived answer would bury that.
      for (const problem of problems) console.log(`   ✗ GEOGRAPHY MISMATCH — ${problem}`);
      failed.push({ target, error: problems.join("; ") });
      continue;
    }

    // ── the real writer, against a handle that refuses (or a transaction) ────
    let addressId = null;
    let writes = [];

    if (APPLY) {
      addressId = await withTransaction(async (tx) => {
        const inserted = await saveAddress(value, { tx });
        await tx.query(UPDATE_ADDRESS_ID_SQL, [inserted, target.locationId]);
        return inserted;
      });
      console.log(`   ✓ written — address_id ${addressId}`);
    } else {
      // `saveAddress` runs for real. Every write it attempts is refused and
      // recorded, so `writes` holds the statement the service actually produced.
      const guard = createWriteGuard(query, { apply: false });
      await saveAddress(value, { tx: guard });
      await guard.query(UPDATE_ADDRESS_ID_SQL, [null, target.locationId]);
      writes = guard.refusedWrites;
      refusedTotal += guard.refusedCount();
    }

    plan.push({ target, row, value, writes, addressId });
  }

  // ---- the exact statements -------------------------------------------------
  if (plan.length) {
    console.log("\n════════ PROPOSED OPERATIONS — exactly two per location ════════");
    for (const { target, value, writes, addressId } of plan) {
      console.log(`\n── ${target.label} — location_id ${target.locationId}`);
      const insert = writes.find((w) => /^\s*INSERT/i.test(w.sql));
      const update = writes.find((w) => /^\s*UPDATE/i.test(w.sql));

      console.log("\n  [1] INSERT INTO addresses — one NEW row (registry is append-only)");
      console.log(`      ${insert ? renderRecordedInsert(insert) : "«not captured»"}`);

      if (insert) {
        console.log("\n      parameters by column:");
        for (const { column, value: cell } of describeInsertParams(insert)) {
          console.log(`        ${column.padEnd(20)} ${quote(cell)}`);
        }
      }

      console.log(`\n  [2] ${oneLine(UPDATE_ADDRESS_ID_SQL)}`);
      console.log(`      $1 = ${APPLY ? addressId : "«the address_id returned by [1]»"}`);
      console.log(`      $2 = ${target.locationId}`);
      if (update) console.log(`      captured: ${oneLine(update.sql)}`);

      console.log(`\n  NOT TOUCHED: locations.address (legacy text), locations.latitude, locations.longitude`);
      console.log(`               neither statement above names any of those columns`);
    }
  }

  // ---- summary --------------------------------------------------------------
  console.log("\n── Summary ──");
  console.log(`  targets in scope                      ${BACKFILL_TARGETS.length}`);
  console.log(`  ${APPLY ? "written" : "would write"}                             ${plan.length}`);
  console.log(`  skipped (already linked / retired / renamed / missing)  ${skipped.length}`);
  console.log(`  refused by the resolver or a mismatch   ${failed.length}`);

  if (skipped.length) {
    console.log("\n  Skipped, left exactly as they are:");
    for (const { target, classification } of skipped) {
      console.log(`    ${target.label} — ${classification.status}: ${classification.detail ?? ""}`);
    }
  }
  if (failed.length) {
    console.log("\n  NOT written, needs attention:");
    for (const { target, error } of failed) console.log(`    ${target.label} — ${error}`);
  }

  if (APPLY) {
    console.log("\nApplied. Verify against the same snapshot:");
    console.log(`  node --import ./scripts/route-harness-loader.mjs scripts/backfill-location-addresses.mjs --verify --snapshot=${SNAPSHOT_PATH}`);
  } else {
    console.log(`\nDRY RUN — nothing written (${refusedTotal} write${refusedTotal === 1 ? "" : "s"} refused at the guard).`);
    if (plan.length) console.log(`Re-run with --apply --snapshot=<path> to write these ${plan.length}.`);
  }

  process.exit(0);
}

// ============================================================================
// Verification — run AFTER an apply, against the snapshot taken BEFORE it.
//
// Each check is a claim this migration makes, turned into a comparison. A check
// that cannot be evaluated is FAILED rather than passed: "could not tell" must
// never read the same as "fine".
// ============================================================================
async function runVerification(before, after) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  const beforeIds = new Set(before.targets.map((t) => t.locationId));
  const expected = [...beforeIds].sort((a, b) => a - b);

  // 1. exactly three new address rows
  const newAddresses = after.addressCount - before.addressCount;
  add(
    "exactly three new address rows",
    newAddresses === 3,
    `addresses ${before.addressCount} → ${after.addressCount} (Δ ${newAddresses})`
  );

  // 2. exactly three address_id changes, and on the right rows
  const changed = Object.keys(after.locationAddressIds).filter(
    (id) => after.locationAddressIds[id] !== before.locationAddressIds[id]
  );
  const changedInts = changed.map(Number).sort((a, b) => a - b);
  add(
    "exactly three address_id changes, on #1/#8/#10",
    changed.length === 3 && changedInts.every((id, i) => id === expected[i]),
    `changed: [${changedInts.join(", ")}], expected [${expected.join(", ")}]`
  );

  // 3. no unrelated location changed
  const unrelated = changedInts.filter((id) => !beforeIds.has(id));
  add("no unrelated location changed", unrelated.length === 0, `unexpected: [${unrelated.join(", ")}]` || "none");

  // 4. coordinates unchanged
  const movedCoords = after.targets
    .map((t) => {
      const prior = before.targets.find((b) => b.locationId === t.locationId);
      if (!prior) return `${t.locationId}: absent before`;
      if (prior.latitude !== t.latitude || prior.longitude !== t.longitude) {
        return `${t.locationId}: ${prior.latitude},${prior.longitude} → ${t.latitude},${t.longitude}`;
      }
      return null;
    })
    .filter(Boolean);
  add("no location coordinates changed", movedCoords.length === 0, movedCoords.join("; ") || "all identical");

  // 5. legacy text unchanged
  const movedText = after.targets
    .map((t) => {
      const prior = before.targets.find((b) => b.locationId === t.locationId);
      if (!prior) return `${t.locationId}: absent before`;
      if (prior.address !== t.address) return `${t.locationId}: "${prior.address}" → "${t.address}"`;
      return null;
    })
    .filter(Boolean);
  add("no legacy locations.address text changed", movedText.length === 0, movedText.join("; ") || "all identical");

  // 6–9. the address rows themselves
  const ids = after.targets.map((t) => t.addressId).filter((v) => v !== null && v !== undefined);

  if (ids.length !== 3) {
    add("the three address rows carry the expected PSGC hierarchy", false, `only ${ids.length} of 3 locations link to an address`);
    add("all three remain unverified", false, "not evaluable");
    add("all three address coordinate pairs are NULL", false, "not evaluable");
    add("operational validation accepts the rows without a house/building number", false, "not evaluable");
  } else {
    const { rows } = await query(
      `SELECT address_id, psgc_barangay_code, city, region, province,
              latitude, longitude, verified, verified_at, provider, provider_place_id,
              address_type, street_number, formatted_address
         FROM addresses
        WHERE address_id = ANY($1::int[])
        ORDER BY address_id`,
      [ids]
    );

    const expectedCodes = Object.fromEntries(BACKFILL_TARGETS.map((t) => [t.locationId, t.barangayCode]));
    const linkById = new Map(after.targets.map((t) => [t.addressId, t.locationId]));

    const wrongHierarchy = rows.filter((r) => {
      const locationId = linkById.get(r.address_id);
      return (
        r.psgc_barangay_code !== expectedCodes[locationId] ||
        r.address_type !== "operational" ||
        !r.city ||
        !r.region ||
        r.province !== null // Metro Manila has no province; a value here would be invented
      );
    });
    add(
      "the three address rows carry the expected PSGC hierarchy",
      rows.length === 3 && wrongHierarchy.length === 0,
      rows.length === 3 && wrongHierarchy.length === 0
        ? "3 rows, each with its expected barangay code, an operational type and no invented province"
        : `rows ${rows.length}; wrong: ${wrongHierarchy.map((r) => r.address_id).join(", ") || "none"}`
    );

    const claimed = rows.filter(
      (r) => r.verified || r.verified_at !== null || r.provider !== "manual" || r.provider_place_id !== null
    );
    add(
      "all three remain unverified",
      claimed.length === 0,
      claimed.length === 0
        ? "verified = false, verified_at = NULL, provider = 'manual' on all three"
        : claimed.map((r) => `#${r.address_id} verified=${r.verified} provider=${r.provider}`).join("; ")
    );

    const located = rows.filter((r) => r.latitude !== null || r.longitude !== null);
    add(
      "all three address coordinate pairs are NULL",
      located.length === 0,
      located.length === 0 ? "latitude and longitude NULL on all three" : located.map((r) => `#${r.address_id} ${r.latitude},${r.longitude}`).join("; ")
    );

    const withNumber = rows.filter((r) => r.street_number !== null && r.street_number !== "");
    const badForms = rows.filter((r) => !r.formatted_address || /^[,\s]/.test(r.formatted_address));
    add(
      "operational validation accepts the rows without a house/building number",
      rows.length === 3 && withNumber.length === 0 && badForms.length === 0,
      rows.length !== 3
        ? `only ${rows.length} rows`
        : withNumber.length
          ? `house number present on ${withNumber.map((r) => r.address_id).join(", ")}`
          : badForms.length
            ? `malformed formatted_address on ${badForms.map((r) => r.address_id).join(", ")}`
            : "street_number NULL on all three; formatted_address well-formed"
    );
  }

  console.log("── Verification ──");
  for (const { name, ok, detail } of checks) {
    console.log(`  ${ok ? "✓" : "✗"} ${name}`);
    console.log(`      ${detail}`);
  }
  const failedCount = checks.filter((c) => !c.ok).length;
  console.log(`\n${failedCount === 0 ? "All checks passed." : `${failedCount} check(s) FAILED — the migration is not verified.`}`);
  return failedCount === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("❌ Error backfilling location addresses:", err);
  process.exit(1);
});
