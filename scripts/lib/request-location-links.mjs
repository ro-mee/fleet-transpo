import { normalizePlaceName } from "../../src/services/route-resolver.service.js";

// ============================================================================
// The frozen-reference rule, shared by the backfill and the read-only review
// harness.
//
// It lives here rather than in either script for one reason: the harness exists
// to show what `--apply` would write. If it derived this rule itself, that claim
// would be a re-implementation that merely tends to agree. Importing the same
// function makes the two identical by construction.
//
// The name normalization is imported from the resolver, not re-written, for the
// same reason — this rule has to key names exactly the way the matcher does, or
// it would freeze a set that is not the set the matcher cannot see.
// ============================================================================

/**
 * Every RETIRED location. Read as `is_active = false` because that is precisely
 * the set `linkRequestLocations` cannot observe: it filters `is_active = true`.
 *
 * The consequence is worth stating plainly, because it is why this rule is
 * needed at all. A request naming a retired location is not MIS-linked — the
 * matcher simply never sees the retired row, so it silently links whatever the
 * other side resolves to and leaves the retired reference untouched. Without a
 * freeze, "don't touch the NAIA Terminal 2 requests" and "run the backfill"
 * would contradict each other, and the contradiction would be invisible in the
 * output: five rows would report as clean links.
 */
export const RETIRED_LOCATIONS_SQL = `
  SELECT location_id, name
    FROM locations
   WHERE is_active = false
   ORDER BY location_id
`;

/** Index retired rows by the key the matcher uses, so lookups are one Map hit. */
export function retiredLocationIndex(rows) {
  const index = new Map();
  for (const row of rows || []) {
    const key = normalizePlaceName(row.name);
    if (!key) continue;
    const hits = index.get(key);
    const entry = { locationId: Number(row.location_id), name: row.name };
    if (hits) hits.push(entry);
    else index.set(key, [entry]);
  }
  return index;
}

/**
 * The retired location this request names on either side, or null.
 *
 * A hit FREEZES THE WHOLE REQUEST, not just the offending side.
 *
 * The reason is NOT that a half-linked row is malformed — it is not. A request
 * whose pickup resolves to nothing is a normal shape, and #487 ("Main Lobby") is
 * exactly that: its drop-off links, its pickup does not, and for it that is the
 * correct and final outcome. `linkRequestLocations` resolves each side
 * independently by design, deliberately, so a request with one dead side still
 * keeps the live one.
 *
 * #481-485 differ in kind, not in degree. Their pickup names a location that
 * EXISTS and has been RETIRED, so the text is not unresolvable — it is attached
 * to a decision that has not been made: reactivate #3, re-point to a replacement,
 * or leave it. Writing to those rows now puts them in a state the pending
 * decision then has to reason about, and for no gain this migration needs. So
 * they are skipped whole and handed back exactly as they are.
 *
 * `pickup` is checked first only so a report names the same side on every run.
 */
export function frozenReference(row, index) {
  const sides = [
    ["pickup", row?.pickup_location],
    ["dropoff", row?.dropoff_location],
  ];
  for (const [side, text] of sides) {
    const hits = index.get(normalizePlaceName(text));
    if (hits?.length) return { side, text, locationId: hits[0].locationId, name: hits[0].name };
  }
  return null;
}
