// Persisting an AddressValue into the `addresses` registry.
//
// WHY EVERY SAVE INSERTS A NEW ROW
// --------------------------------
// The tempting alternative is to reuse a row when it looks the same, or to
// UPDATE the row a caller passes back by id. Both are rejected.
//
// A shared row would make one entity's edit silently rewrite another's address:
// two drivers who live on the same street would point at one row, and correcting
// a typo for one would move the other. An UPDATE-by-id is worse still — a
// client-supplied `addressId` is exactly the kind of value this feature spends
// its effort NOT trusting, and letting it choose which row to overwrite would
// reintroduce the problem the server-side re-resolution exists to close.
//
// So the registry is append-only: a save writes what the SERVER resolved, and
// repoints the referencing column. A superseded row is orphaned rather than
// mutated. Orphans are inert (nothing joins to them, and the FK's
// ON DELETE SET NULL means removing one is always safe), and this is the only
// arrangement in which a coordinate can never end up describing a row it was
// not resolved for.
//
// Callers run the INSERT inside the same transaction as the row that references
// it, so a failed write cannot leave a dangling address behind.

import { query } from "@/lib/db";
import { resolveBarangayChain } from "@/lib/geo/psgc";
import { isBlankAddress } from "@/lib/address/invalidate";
import { EMPTY_STRUCTURED_ADDRESS, geographyFromChain } from "@/lib/address/structured";

// The last four columns are the STRUCTURED-path ones, added by migration 123
// alongside the PSGC tables. They are here rather than in a second statement
// because omitting them is silent and expensive: a picked address would store
// its street line but no barangay code, which is the one value that makes it
// re-resolvable. It would then be indistinguishable from a legacy free-text row,
// and nothing downstream could tell that a cascade had ever produced it.
//
// They are nullable and absent on the provider path, so a geocoded address
// writes NULL for all four, exactly as before.
const INSERT_SQL = `
  INSERT INTO addresses (
    raw_input, formatted_address,
    street_number, street_name, unit_number, building, subdivision,
    barangay, city, municipality, province, region,
    postal_code, postal_code_source, country,
    latitude, longitude,
    provider, provider_place_id, verified, verified_at,
    address_type, landmark, additional_details, psgc_barangay_code
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
    $13, $14, $15, $16, $17, $18, $19, $20, $21,
    $22, $23, $24, $25
  )
  RETURNING address_id
`;

/**
 * Write a resolved address and return its id, or null for a blank one.
 *
 * A blank address returns null rather than writing an empty row: "this driver
 * has no address" is expressed by the referencing column being NULL, not by a
 * registry row that reads as a real place with no content.
 *
 * @param {object} value   a server-resolved AddressValue (see validate.js)
 * @param {object} [opts]
 * @param {{ query: Function }} [opts.tx]  a transaction handle; pass this when
 *   the caller is already inside one, so the address and its referrer commit
 *   together.
 * @returns {Promise<number|null>}
 */
export async function saveAddress(value, { tx } = {}) {
  if (isBlankAddress(value)) return null;

  const run = tx ? tx.query : query;
  const components = value.components ?? {};

  const { rows } = await run(INSERT_SQL, [
    value.raw ?? null,
    value.formattedAddress ?? value.raw ?? null,
    components.houseNumber ?? null,
    components.street ?? null,
    components.unitNumber ?? null,
    components.building ?? null,
    components.subdivision ?? null,
    components.barangay ?? null,
    components.city ?? null,
    components.municipality ?? null,
    components.province ?? null,
    components.region ?? null,
    value.postalCode ?? null,
    // Only ever 'provider' or 'manual'. A null source with a postal code present
    // would be a contradiction the UI could not render honestly.
    value.postalCode ? (value.postalCodeSource ?? "manual") : null,
    components.country ?? "Philippines",
    value.latitude ?? null,
    value.longitude ?? null,
    value.provider ?? null,
    value.providerPlaceId ?? null,
    Boolean(value.verified),
    // A verified row with no timestamp would be a row claiming a verification
    // that nothing dates.
    value.verified ? (value.verifiedAt ?? new Date().toISOString()) : null,
    // The structured-path fields (`psgc_barangay_code` chief among them). All
    // undefined on the provider path, which is what makes this write NULL for
    // those callers rather than needing a second statement.
    value.addressType ?? null,
    value.landmark ?? null,
    value.additionalDetails ?? null,
    value.psgcBarangayCode ?? null,
  ]);

  return rows[0]?.address_id ?? null;
}

/**
 * Read an address back for display.
 *
 * Returns null rather than throwing when the id is unknown: a location whose
 * address row was removed degrades to its own denormalized text columns, which
 * is a state the API surfaces already handle.
 *
 * @param {number|null} addressId
 * @returns {Promise<object|null>}
 */
export async function getAddress(addressId) {
  const id = Number(addressId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;

  const { rows } = await query(
    `SELECT address_id, raw_input, formatted_address,
            street_number, street_name, unit_number, building, subdivision,
            barangay, city, municipality, province, region,
            postal_code, postal_code_source, country,
            latitude, longitude, provider, provider_place_id,
            verified, verified_at, created_at, updated_at,
            address_type, landmark, additional_details, psgc_barangay_code
       FROM addresses
      WHERE address_id = $1`,
    [id]
  );

  const row = rows[0];
  if (!row) return null;

  return {
    addressId: row.address_id,
    raw: row.raw_input ?? "",
    formattedAddress: row.formatted_address,
    components: {
      houseNumber: row.street_number,
      street: row.street_name,
      unitNumber: row.unit_number,
      building: row.building,
      subdivision: row.subdivision,
      barangay: row.barangay,
      city: row.city,
      municipality: row.municipality,
      province: row.province,
      region: row.region,
      country: row.country,
    },
    postalCode: row.postal_code,
    postalCodeSource: row.postal_code_source,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    verified: Boolean(row.verified),
    provider: row.provider,
    providerPlaceId: row.provider_place_id,
    verifiedAt: row.verified_at ? new Date(row.verified_at).toISOString() : null,
    // The structured-path fields, read back under the same names `saveAddress`
    // takes them in and `resolveStructuredAddress` produces them.
    //
    // They were WRITTEN and not READ until now: the INSERT above has carried all
    // four since migration 123, and this function returned none of them. That
    // asymmetry is worth a comment because it is invisible from either end —
    // the writer looked complete, the reader looked complete, and the only
    // evidence was a `psgc_barangay_code` that went in and never came out. A
    // picked address was indistinguishable from a legacy free-text one to every
    // caller, and the sole way to confirm a save had stored its barangay code
    // was to query the table by hand.
    addressType: row.address_type,
    landmark: row.landmark,
    additionalDetails: row.additional_details,
    psgcBarangayCode: row.psgc_barangay_code,
  };
}

/**
 * Read a saved address back INTO THE FORM THAT WROTE IT.
 *
 * The inverse of `saveAddress` for the structured (cascade) path, so the picker
 * can re-open on an address that already exists instead of starting blank. The
 * mapping is taken from `INSERT_SQL` above and from the `components` block in
 * `src/lib/address/validate-structured.js`, so the two directions are read side
 * by side rather than remembered.
 *
 * WHY IT RE-RESOLVES THE BARANGAY RATHER THAN READING THE STORED NAMES
 * -------------------------------------------------------------------
 * The row stores a barangay NAME (`barangays.barangay`) and the cascade needs
 * four CODES. Reading the name back and asking "which barangay is called this"
 * is the fuzzy match this whole design refuses — it is wrong for exactly the
 * names that are hardest to notice, since a city can hold two barangays of one
 * name and the row does not record which one it meant. So the code is the only
 * thing read, and `resolveBarangayChain` — the same function the WRITE path
 * calls — turns it back into the four levels. A row whose stored name no longer
 * matches its code therefore reloads with the CURRENT name, which is right: the
 * code is the identity and the name is a label PSGC is free to revise.
 *
 * THE THREE REFUSALS, AND WHY THEY ARE NOT ONE
 * --------------------------------------------
 * "Cannot pre-fill" has three different causes and the operator is owed the
 * difference. A single falsy return would be indistinguishable from a bug, and
 * the one case that is NOT a defect — a legacy row that predates the structured
 * path — would read as one:
 *
 *   * `no-address-id`     nobody has picked an address here yet, or this row
 *                         predates the registry link. Nothing to load; the
 *                         picker opens blank, as it always has.
 *   * `no-psgc-code`      an address row exists but is free text. THIS IS THE
 *                         HONEST ONE: the data needed to re-open the cascade was
 *                         never captured, and inventing it is the fuzzy match
 *                         above. Stays read-only.
 *   * `unknown-barangay`  the code is set but no longer resolves. A real state —
 *                         `resolveBarangayChain` returns null rather than
 *                         throwing, and `validate-structured.js` already treats
 *                         it as one — reached when the PSGC data moved under a
 *                         saved row.
 *
 * A fourth, `unavailable`, is not a statement about the address but about us:
 * the read itself failed. It is caught HERE rather than in each route because
 * this function has exactly one job and it is not worth doing — pre-filling a
 * form — and a caller that had to guard every call would be the same guard
 * written twice. The alternative, letting it throw, would have `GET
 * /api/drivers/[id]` return 500 for a driver's whole detail page because an edit
 * form could not be pre-filled.
 *
 * @param {number|null} addressId
 * @returns {Promise<{ok: true, value: object} | {ok: false, reason: string}>}
 */
export async function loadStructuredAddress(addressId) {
  if (addressId === null || addressId === undefined) {
    return { ok: false, reason: "no-address-id" };
  }

  try {
    const address = await getAddress(addressId);
    if (!address) return { ok: false, reason: "no-address-id" };

    // A provider-path or legacy row. Named separately from the id being absent
    // because the id IS present — there is simply nothing re-openable behind it.
    if (!address.psgcBarangayCode) return { ok: false, reason: "no-psgc-code" };

    const chain = await resolveBarangayChain(address.psgcBarangayCode);
    if (!chain) return { ok: false, reason: "unknown-barangay" };

    // Text fields are normalized to "" rather than left null, to match
    // EMPTY_STRUCTURED_ADDRESS. The form's `isFilled` treats both as unfilled, but
    // `detailErrors` and the preview call String methods on these, and a null that
    // only ever arrives from the loader would be a crash reachable only by
    // re-opening an existing address.
    return {
      ok: true,
      value: {
        ...EMPTY_STRUCTURED_ADDRESS,
        ...geographyFromChain(chain),
        type: address.addressType ?? EMPTY_STRUCTURED_ADDRESS.type,
        houseBuildingNumber: address.components.houseNumber ?? "",
        streetRoad: address.components.street ?? "",
        unitFloorBuilding: address.components.unitNumber ?? "",
        subdivisionVillage: address.components.subdivision ?? "",
        landmark: address.landmark ?? "",
        additionalDetails: address.additionalDetails ?? "",
        postalCode: address.postalCode ?? "",
        // The pin, as placed. Both or neither by the same CHECK constraint the
        // form's own rule mirrors, so no pairing has to be re-derived here.
        latitude: address.latitude,
        longitude: address.longitude,
      },
    };
  } catch (e) {
    // Logged, not swallowed silently: a pre-fill that stops working should be
    // findable. It is not re-thrown because the caller's only options are to
    // degrade or to fail a view that is not about addresses.
    console.warn("Address prefill failed:", e?.message ?? e);
    return { ok: false, reason: "unavailable" };
  }
}
