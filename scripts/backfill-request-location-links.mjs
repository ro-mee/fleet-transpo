import { loadEnvLocal } from "./load-env.mjs";
// Run with:
//   node --import ./scripts/route-harness-loader.mjs scripts/backfill-request-location-links.mjs
//   node --import ./scripts/route-harness-loader.mjs scripts/backfill-request-location-links.mjs --apply
loadEnvLocal();

import { query } from "../src/lib/db.js";
import { linkRequestLocations } from "../src/services/route-resolver.service.js";
import { RETIRED_LOCATIONS_SQL, frozenReference, retiredLocationIndex } from "./lib/request-location-links.mjs";

// ============================================================================
// One-time backfill of transportation_requests.pickup_location_id /
// .dropoff_location_id for rows that predate the link being written at ingest.
//
// WHAT THIS BUYS. The link is what lets a reservation reach a canonical
// location, and through it a structured address. A reservation does not store an
// address of its own — it stores a name that now resolves to a location which
// owns one. Getting structured addresses to flow to reservations and their
// routes is the purpose of this migration.
//
// WHAT IT DOES NOT BUY YET. No location in the affected set carries an
// address_id, so at present this migration moves no structured address anywhere.
// The goal is only reachable once the separate canonical-location address
// migration has given those locations addresses. Until then the true description
// is "the link is written and resolves", NOT "reservations inherit structured
// addresses" — and a report that claims the latter is the kind of unearned
// confidence this script's dry run exists to prevent.
//
// OUT OF SCOPE. A request naming a RETIRED location is skipped whole and
// reported (see lib/request-location-links.mjs for why half-linking one is worse
// than skipping it). Those rows are a separate data/business decision: not
// reactivated, not replaced, not rewritten here.
//
// DRY RUN BY DEFAULT. A script that touches the live database and cannot be
// reviewed before it writes should not write on a bare invocation, so `--apply`
// is required. The dry run is not a re-implementation of the matching rule:
// it runs linkRequestLocations() against a handle that REFUSES every write, so
// the resolution being reviewed is the resolution that will run. The skip rule
// is imported from the same module the review harness uses, so it is the same
// decision in both, not a parallel copy of it.
//
// Idempotent and non-destructive. The underlying UPDATE cannot clear an
// existing link and no-ops when the row is already correct, so a second run
// reports zero changes.
// ============================================================================

const APPLY = process.argv.includes("--apply");
const WRITE = /^\s*(UPDATE|INSERT|DELETE)\b/i;
const DETAIL_LIMIT = 25;

let writesRefused = 0;
const db = APPLY
  ? { query }
  : {
      query: async (sql, params) => {
        if (WRITE.test(sql)) {
          writesRefused++;
          return { rows: [], rowCount: 0 };
        }
        return query(sql, params);
      },
    };

function formatSide(label, resolvedId, currentId) {
  const before = currentId === null || currentId === undefined ? "unlinked" : `was ${currentId}`;
  return `        ${label.padEnd(7)} → ${String(resolvedId).padEnd(5)} (${before})`;
}

async function main() {
  console.log(
    APPLY
      ? "🔗 Backfilling request → location links (APPLY — rows will be written)"
      : "🔍 Backfilling request → location links (DRY RUN — nothing is written)"
  );

  const { rows } = await query(`
    SELECT request_id, pickup_location, dropoff_location,
           pickup_location_id, dropoff_location_id
      FROM transportation_requests
     WHERE deleted_at IS NULL
     ORDER BY request_id
  `);
  console.log(`Found ${rows.length} transportation requests.\n`);

  const { rows: retiredRows } = await query(RETIRED_LOCATIONS_SQL);
  const retiredIndex = retiredLocationIndex(retiredRows);
  if (retiredRows.length) {
    console.log(`Locations retired in the registry: ${retiredRows.length}. A request naming one is skipped whole.\n`);
  }

  const changes = [];
  const unmatched = [];
  const frozen = [];
  // Every request_id classified by some branch below. Printed at the end and
  // compared against the row count: a `continue`, a mis-ordered branch or a
  // silently dropped row then shows up as a number that does not add up, rather
  // than as a tidy report that is quietly missing rows.
  const classified = new Set();
  let already = 0;

  for (const row of rows) {
    const ref = frozenReference(row, retiredIndex);
    if (ref) {
      frozen.push(
        `  #${row.request_id}   ${ref.side} "${ref.text}" names #${ref.locationId} "${ref.name}", which is retired`
      );
      classified.add(row.request_id);
      continue;
    }

    const resolved = await linkRequestLocations(db, {
      requestId: row.request_id,
      pickup: row.pickup_location,
      dropoff: row.dropoff_location,
    });

    const pickupId = resolved?.pickupLocationId ?? null;
    const dropoffId = resolved?.dropoffLocationId ?? null;

    const pickupNew = pickupId !== null && pickupId !== row.pickup_location_id;
    const dropoffNew = dropoffId !== null && dropoffId !== row.dropoff_location_id;
    // Only a side that is BOTH unlinked and unresolved is a finding. A side
    // that is already linked is not re-examined against its text: the link is
    // the durable record and the text may have been renamed out from under it.
    const pickupLost = pickupId === null && row.pickup_location_id === null;
    const dropoffLost = dropoffId === null && row.dropoff_location_id === null && Boolean(row.dropoff_location);

    // These are two INDEPENDENT findings, not alternatives. A row can link its
    // drop-off while its pickup matches nothing, and reporting those as an
    // either/or hides the pickup — which is the one thing this dry run exists
    // to surface. (It did: five rows were reported as clean links while their
    // pickup text resolved to nothing.)
    if (pickupNew || dropoffNew) {
      const lines = [`  #${row.request_id}   ${row.pickup_location}  →  ${row.dropoff_location || "—"}`];
      if (pickupNew) lines.push(formatSide("pickup", pickupId, row.pickup_location_id));
      if (dropoffNew) lines.push(formatSide("dropoff", dropoffId, row.dropoff_location_id));
      changes.push(lines.join("\n"));
    }

    if (pickupLost || dropoffLost) {
      const which = [pickupLost ? `pickup "${row.pickup_location}"` : null, dropoffLost ? `dropoff "${row.dropoff_location}"` : null]
        .filter(Boolean)
        .join(", ");
      unmatched.push(`  #${row.request_id}   ${which} — no single active location matches`);
    }

    if (!pickupNew && !dropoffNew && !pickupLost && !dropoffLost) already++;
    classified.add(row.request_id);
  }

  if (frozen.length) {
    console.log(`Skipped — names a retired location (${frozen.length}), left exactly as they are:`);
    console.log(frozen.slice(0, DETAIL_LIMIT).join("\n"));
    if (frozen.length > DETAIL_LIMIT) console.log(`  … and ${frozen.length - DETAIL_LIMIT} more`);
    console.log("");
  }

  if (changes.length) {
    console.log(`Links to write (${changes.length}):`);
    console.log(changes.join("\n"));
    console.log("");
  }

  if (unmatched.length) {
    console.log(`Text matching no single active location (${unmatched.length}) — left unlinked, never guessed:`);
    console.log(unmatched.slice(0, DETAIL_LIMIT).join("\n"));
    if (unmatched.length > DETAIL_LIMIT) console.log(`  … and ${unmatched.length - DETAIL_LIMIT} more`);
    console.log("");
  }

  console.log("── Summary ──");
  console.log(`  requests examined                ${rows.length}`);
  console.log(`  skipped, retired reference       ${frozen.length}   ← not touched by this migration`);
  console.log(`  ${APPLY ? "linked now" : "would link  "}                    ${changes.length}`);
  console.log(`  no single location match         ${unmatched.length}   (rows, not sides — may overlap the line above)`);
  console.log(`  already complete, nothing to do  ${already}`);
  const covered = classified.size === rows.length;
  console.log(
    `  every row classified exactly once  ${classified.size} / ${rows.length}   ${covered ? "✓" : "✗ MISMATCH — a row was neither linked nor reported; do not trust this run"}`
  );

  if (APPLY) {
    console.log("\nApplied. Re-run without --apply to confirm it now reports 0 to write.");
  } else {
    console.log(`\nDRY RUN — nothing written (${writesRefused} write${writesRefused === 1 ? "" : "s"} refused by the read-only handle).`);
    console.log("Re-run with --apply to write these links.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Error backfilling request location links:", err);
  process.exit(1);
});
