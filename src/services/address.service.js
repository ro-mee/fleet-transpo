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
import { isBlankAddress } from "@/lib/address/invalidate";

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
            verified, verified_at, created_at, updated_at
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
  };
}
