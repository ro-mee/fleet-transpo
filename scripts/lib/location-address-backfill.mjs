// ============================================================================
// The canonical-location → structured-address backfill: its targets, its plan,
// and its write guard.
//
// Pure by construction. Nothing here opens a connection, so every rule this
// migration turns on can be exercised by a unit test rather than only by
// pointing a script at the live database.
//
// WHY THE TARGETS ARE LITERAL, AND WHY THAT IS NOT A HARDCODED ANSWER
// ------------------------------------------------------------------
// Three locations are in scope — #1, #8 and #10 — and they are named here by
// id, by the name the row is expected to carry, and by the ONE value the server
// is believed about: the barangay code.
//
// Everything else about the geography — region, city, the names of all three —
// is DERIVED at run time by `resolveStructuredAddress`, which resolves the
// barangay code against `ph_barangays` and takes its answer. The city code is
// carried here only as an EXPECTATION to assert against, never as a value to
// write. That distinction is the point: a migration that hardcoded a city name
// into a row would be asserting geography rather than reading it, and would not
// notice if the code it was handed resolved somewhere else.
//
// ============================================================================

/** The only statement this migration runs against `locations`. */
export const UPDATE_ADDRESS_ID_SQL =
  "UPDATE locations SET address_id = $1 WHERE location_id = $2";

/**
 * The three locations this migration touches, and nothing else.
 *
 * `expectCityCode` / `expectCityName` / `expectBarangayName` are ASSERTIONS. A
 * run whose derived geography disagrees with one of them stops on that location
 * and reports it, rather than writing a row whose barangay is not the one the
 * operator asked for.
 *
 * `houseBuildingNumber` is deliberately absent from every target. An airport
 * curb has no number, the `operational` type is what permits its absence, and
 * inventing one is the fabrication this whole layer refuses. See
 * `requiredDetailFields` in src/lib/address/structured.js.
 */
export const BACKFILL_TARGETS = Object.freeze([
  {
    locationId: 1,
    label: "#1 CoCo Star Hotel",
    expectedName: "CoCo Star Hotel",
    barangayCode: "1381000006",
    expectBarangayName: "Tambo",
    expectCityCode: "1381000000",
    expectCityName: "City of Parañaque",
    streetRoad: "Tamaraw Court",
    postalCode: "1701",
    type: "operational",
  },
  {
    locationId: 8,
    label: "#8 NAIA Terminal 2 - Arrivals",
    expectedName: "NAIA Terminal 2 - Arrivals",
    barangayCode: "1381100197",
    expectBarangayName: "Barangay 197",
    expectCityCode: "1381100000",
    expectCityName: "Pasay City",
    streetRoad: "NAIA Road",
    postalCode: "1300",
    type: "operational",
  },
  {
    locationId: 10,
    label: "#10 NAIA Terminal 3 - Arrivals (Bay 9)",
    expectedName: "NAIA Terminal 3 - Arrivals (Bay 9)",
    barangayCode: "1381100183",
    expectBarangayName: "Barangay 183",
    expectCityCode: "1381100000",
    expectCityName: "Pasay City",
    streetRoad: "Andrews Avenue",
    postalCode: "1300",
    type: "operational",
  },
]);

/**
 * The request body `resolveStructuredAddress` takes, built from a target.
 *
 * `latitude` / `longitude` are ABSENT rather than null, which is the same thing
 * to the validator (Stage 4 only refuses a HALF coordinate) and is the honest
 * way to say "no pin was dropped". The operational point is owned by
 * `locations.latitude` / `.longitude`, which this migration never reads as an
 * input and never writes.
 *
 * The empty strings are the form's own shape — the structured value carries
 * `""` for an unfilled detail field, not `undefined` — and `home` is absent
 * because the target states its own type.
 *
 * @param {object} target
 * @returns {object}
 */
export function buildStructuredInput(target) {
  return {
    type: target.type,
    psgcBarangayCode: target.barangayCode,
    houseBuildingNumber: "",
    streetRoad: target.streetRoad,
    unitFloorBuilding: "",
    subdivisionVillage: "",
    landmark: null,
    additionalDetails: null,
    postalCode: target.postalCode,
  };
}

// ---------------------------------------------------------------------------
// The write guard
// ---------------------------------------------------------------------------

// Anything that changes data. `SELECT ... FOR UPDATE` is a read that locks, not
// a write, and is not matched — this script never issues one.
export const WRITE_RE = /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT|REVOKE)\b/i;

/**
 * Wrap a query function so that, unless `apply` is true, every write is REFUSED
 * and RECORDED, and every read passes straight through.
 *
 * Two properties make this worth more than a hand-written preview:
 *
 *  1. **The dry run exercises the real code path.** `saveAddress` is called for
 *     real, with this handle as its `tx`. The statement and the parameters the
 *     report shows are the ones that function actually produced — not a second
 *     implementation, maintained beside it, that merely tends to agree. The
 *     same argument `scripts/lib/request-location-links.mjs` makes for sharing
 *     its rule with the review harness.
 *
 *  2. **It cannot silently write.** The refusal happens at the seam every write
 *     must pass through, so a future edit to `saveAddress` that adds a second
 *     statement is refused by this too, rather than escaping an allowlist of
 *     statements that was correct on the day it was written.
 *
 * @param {(sql: string, params?: any[]) => Promise<{rows: any[], rowCount: number}>} run
 * @param {{ apply?: boolean }} [opts]
 * @returns {{ query: Function, refusedWrites: Array<{sql: string, params: any[]}>, refusedCount: () => number }}
 */
export function createWriteGuard(run, { apply = false } = {}) {
  const refusedWrites = [];

  return {
    refusedWrites,
    refusedCount: () => refusedWrites.length,
    query: async (sql, params = []) => {
      if (!apply && WRITE_RE.test(sql)) {
        refusedWrites.push({ sql, params });
        return { rows: [], rowCount: 0 };
      }
      return run(sql, params);
    },
  };
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/**
 * What this migration should do about one location, given the row as it is now.
 *
 * The order of these checks is the order of their authority: a row that is not
 * the location we think it is never gets as far as being written, whatever else
 * is true of it.
 *
 * `already_linked` is a SKIP rather than a re-link. The address registry is
 * append-only, so writing again would INSERT a second row and orphan the first;
 * a re-run that reported "3 to write" every time would be a script whose dry run
 * could never be trusted to reach zero.
 *
 * `retired` is a SKIP for the reason the request-link backfill freezes retired
 * references: a location that has been versioned out is attached to a decision
 * someone has not made yet, and writing to it now puts it in a state that
 * decision then has to reason about.
 *
 * @param {{ target: object, row: object|null }} input
 * @returns {{ status: string, detail?: string }}
 */
export function classifyTarget({ target, row }) {
  if (!row) {
    return { status: "missing", detail: `no location row with location_id = ${target.locationId}` };
  }
  if (row.name !== target.expectedName) {
    return {
      status: "name_mismatch",
      detail: `row is named "${row.name}", expected "${target.expectedName}"`,
    };
  }
  if (row.is_active === false) {
    return { status: "retired", detail: "is_active = false; a retired location is not written to" };
  }
  if (row.address_id !== null && row.address_id !== undefined) {
    return { status: "already_linked", detail: `already points at address_id ${row.address_id}` };
  }
  return { status: "ready" };
}

/**
 * Check the derived geography against what the operator supplied.
 *
 * A mismatch is a STOP, not a warning. The barangay code is the one value the
 * client is believed about, and it is believed only as a CHOICE — so if it
 * resolves to a city other than the one that was asked for, the choice and the
 * expectation disagree and the run must not paper over it by storing the derived
 * answer silently.
 *
 * @param {object} target
 * @param {object} chain  a resolved PSGC chain
 * @returns {string[]} human-readable mismatches, empty when consistent
 */
export function geographyMismatches(target, chain) {
  const problems = [];
  if (chain.barangay?.code !== target.barangayCode) {
    problems.push(`resolved barangay code ${chain.barangay?.code} ≠ requested ${target.barangayCode}`);
  }
  if (chain.barangay?.name !== target.expectBarangayName) {
    problems.push(`resolved barangay "${chain.barangay?.name}" ≠ expected "${target.expectBarangayName}"`);
  }
  if (chain.city?.code !== target.expectCityCode) {
    problems.push(`resolved city code ${chain.city?.code} ≠ expected ${target.expectCityCode}`);
  }
  if (chain.city?.name !== target.expectCityName) {
    problems.push(`resolved city "${chain.city?.name}" ≠ expected "${target.expectCityName}"`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Collapse a statement to one readable line for a report. */
export const oneLine = (sql) => String(sql).replace(/\s+/g, " ").trim();

/** A value as SQL-ish literal text, for display only — this never reaches a driver. */
export function quote(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * The recorded INSERT shown as the statement it is, with its parameters inline.
 *
 * `$n` placeholders plus a separate array is what the driver receives, but it is
 * not what a reviewer can read. Inlining them is the difference between a report
 * that can be checked and one that has to be taken on trust.
 */
export function renderRecordedInsert(recorded) {
  const params = recorded.params ?? [];
  const withValues = oneLine(recorded.sql).replace(/\$(\d+)/g, (whole, digits) => {
    const value = params[Number(digits) - 1];
    return value === undefined ? whole : quote(value);
  });
  return withValues;
}

/** The 25 columns `saveAddress` writes, in the order its statement names them. */
export const ADDRESS_INSERT_COLUMNS = Object.freeze([
  "raw_input", "formatted_address",
  "street_number", "street_name", "unit_number", "building", "subdivision",
  "barangay", "city", "municipality", "province", "region",
  "postal_code", "postal_code_source", "country",
  "latitude", "longitude",
  "provider", "provider_place_id", "verified", "verified_at",
  "address_type", "landmark", "additional_details", "psgc_barangay_code",
]);

/**
 * Pair the recorded parameters with their columns, for the report.
 *
 * Reads the column list from the same order `saveAddress` binds them, so the
 * report names the field a value lands in rather than leaving the reader to
 * count commas.
 */
export function describeInsertParams(recorded) {
  const params = recorded.params ?? [];
  return ADDRESS_INSERT_COLUMNS.map((column, index) => ({
    column,
    value: params[index] === undefined ? null : params[index],
  }));
}
