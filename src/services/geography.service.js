import { apiFetch, buildQuery } from "@/lib/api/client";

// The geography seam.
//
// Every address component imports its Philippine location data from HERE — never
// from a fetch, a table, or an inline constant. The requirement this satisfies is
// "keep location data separate from presentation components": the cascade
// dropdowns know they receive `[{ code, name }]` and nothing about where it came
// from, so replacing the DB tables with an API, or a bundled dataset, is a change
// to the four functions below and to nothing else.
//
// The shape is normalised at this boundary on purpose. The database columns are
// `psgc_code` / `name`; exposing those to components would leak the storage
// representation into rendering code, and a future source that calls a vendor API
// would then be forced to imitate this repo's column names.
//
// LEVEL-LOADING, NOT PER-KEYSTROKE SEARCH
// ---------------------------------------
// One request per level, when the level above it is chosen. The counts make this
// the right trade: 17 regions, ~10 provinces per region, tens of cities per
// province, tens-to-hundreds of barangays per city. All are small enough to fetch
// whole, which means the type-to-filter in the dropdowns runs CLIENT-SIDE over an
// already-loaded list — instant, and no network call per character. It is also
// why the ~42,000-row barangay table is never shipped to the browser at once.

/**
 * @typedef {{ code: string, name: string }} GeoOption
 */

/** All 17 regions. Small and fixed — loaded once when the form opens. */
export async function getRegions() {
  return apiFetch("/api/geo/regions");
}

/**
 * Provinces within a region. An EMPTY array is a meaningful answer, not a
 * failure: Metro Manila has no provinces, and the form uses this to decide the
 * province level is not required. See `regionRequiresProvince`.
 *
 * @param {string} regionCode
 * @returns {Promise<GeoOption[]>}
 */
export async function getProvinces(regionCode) {
  return apiFetch(`/api/geo/provinces${buildQuery({ region: regionCode })}`);
}

/**
 * Cities and municipalities.
 *
 * Exactly one of `provinceCode` / `regionCode` applies, and the region form is
 * not a fallback — it is the primary path for province-less regions, where there
 * is no province to filter by.
 *
 * @param {{ provinceCode?: string, regionCode?: string }} params
 * @returns {Promise<GeoOption[]>}
 */
export async function getCities({ provinceCode, regionCode } = {}) {
  return apiFetch(`/api/geo/cities${buildQuery({ province: provinceCode, region: regionCode })}`);
}

/**
 * Barangays within a city or municipality.
 *
 * @param {string} cityCode
 * @returns {Promise<GeoOption[]>}
 */
export async function getBarangays(cityCode) {
  return apiFetch(`/api/geo/barangays${buildQuery({ city: cityCode })}`);
}

/**
 * The full chain for one barangay, resolved server-side.
 *
 * This is what the SERVER uses to check a submitted address: it takes the chosen
 * leaf and derives everything above it, rather than trusting the client's
 * region/province/city text. Exposed here too so an edit form can repopulate all
 * four dropdowns from the single code the address row stored — the alternative
 * would be storing a denormalised code per level, which is one more thing to keep
 * consistent for no gain.
 *
 * @param {string} barangayCode
 * @returns {Promise<{ region: GeoOption, province: GeoOption|null, city: GeoOption, barangay: GeoOption }|null>}
 *   `province` is null for a province-less city — a real answer, not a miss.
 */
export async function resolveBarangay(barangayCode) {
  return apiFetch(`/api/geo/resolve${buildQuery({ barangay: barangayCode })}`);
}
