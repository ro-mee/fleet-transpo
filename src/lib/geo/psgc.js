// Server-side access to the PSGC geography tables (migration 123).
//
// Sits between the `ph_*` tables and the `/api/geo/*` routes so the SQL lives in
// one place and the route handlers stay thin, matching how the rest of this repo
// separates service from transport.
//
// THE PROVIDE-A-NAME / GET-A-CODE CONTRACT
// ----------------------------------------
// Every function returns `{ code, name }`, never raw rows. Components select a
// `code` and display a `name`, so the DB's `psgc_code` column never leaks into
// rendering code — and a future geography source that is not these tables has
// only this file to satisfy.
//
// EMPTY IS AN ANSWER, NOT AN ERROR
// --------------------------------
// `listProvinces` returning `[]` is how the form learns a region has no provinces
// (Metro Manila), which is what makes the province level optional rather than
// permanently unsatisfiable. No function here throws on an empty result, and no
// caller may treat empty as "not found" — see `src/lib/address/structured.js`.
import { query } from "@/lib/db";

/** Regions, ordered as PSGC numbers them so the list is stable across reloads. */
export async function listRegions() {
  const { rows } = await query(
    `SELECT psgc_code, name FROM public.ph_regions ORDER BY psgc_code`
  );
  return rows.map(toOption);
}

/**
 * Provinces in a region. An empty array means the region genuinely has no
 * provinces — see the header.
 *
 * @param {string} regionCode
 */
export async function listProvinces(regionCode) {
  const { rows } = await query(
    `SELECT psgc_code, name FROM public.ph_provinces WHERE region_code = $1 ORDER BY name`,
    [regionCode]
  );
  return rows.map(toOption);
}

/**
 * Cities and municipalities within a province, or within a region.
 *
 * Exactly one of the two is supplied and neither is a fallback for the other:
 * the region form is the PRIMARY path for province-less regions, where there is
 * no province to filter by. Filtering by region alone also returns the cities of
 * that region's provinces, which is harmless — the form only reaches this path
 * when the province list came back empty.
 *
 * @param {{ provinceCode?: string, regionCode?: string }} params
 */
export async function listCities({ provinceCode, regionCode } = {}) {
  if (provinceCode) {
    const { rows } = await query(
      `SELECT psgc_code, name FROM public.ph_cities WHERE province_code = $1 ORDER BY name`,
      [provinceCode]
    );
    return rows.map(toOption);
  }

  if (regionCode) {
    const { rows } = await query(
      `SELECT psgc_code, name FROM public.ph_cities WHERE region_code = $1 ORDER BY name`,
      [regionCode]
    );
    return rows.map(toOption);
  }

  // Neither supplied is a caller error rather than an empty result, and returning
  // [] here would surface it as a mysteriously blank dropdown.
  throw new Error("listCities requires a provinceCode or a regionCode");
}

/** Barangays within a city or municipality. */
export async function listBarangays(cityCode) {
  const { rows } = await query(
    `SELECT psgc_code, name FROM public.ph_barangays WHERE city_code = $1 ORDER BY name`,
    [cityCode]
  );
  return rows.map(toOption);
}

/**
 * The full hierarchy for one barangay, derived from the code alone.
 *
 * This is the query behind server-side address validation: a write carries a
 * `psgc_barangay_code`, and the server asks this function what that code actually
 * means rather than believing the region/province/city text the client sent
 * alongside it. A client cannot file "Barangay Balibago" under "Cebu City" if the
 * city name is derived here instead of accepted.
 *
 * Returns null when the code is unknown — the caller must reject, not default.
 *
 * `province` is null for a province-less city, which is a real answer.
 *
 * @param {string} barangayCode
 */
export async function resolveBarangayChain(barangayCode) {
  const { rows } = await query(
    `SELECT
       b.psgc_code AS barangay_code, b.name AS barangay_name,
       c.psgc_code AS city_code,     c.name AS city_name,
       p.psgc_code AS province_code, p.name AS province_name,
       r.psgc_code AS region_code,   r.name AS region_name
     FROM public.ph_barangays b
     JOIN public.ph_cities  c ON c.psgc_code = b.city_code
     JOIN public.ph_regions r ON r.psgc_code = c.region_code
     LEFT JOIN public.ph_provinces p ON p.psgc_code = c.province_code
     WHERE b.psgc_code = $1`,
    [barangayCode]
  );

  const row = rows[0];
  if (!row) return null;

  return {
    region: { code: row.region_code, name: row.region_name },
    province: row.province_code ? { code: row.province_code, name: row.province_name } : null,
    city: { code: row.city_code, name: row.city_name },
    barangay: { code: row.barangay_code, name: row.barangay_name },
  };
}

/** Row → `{ code, name }`. See the header for why this boundary exists. */
function toOption(row) {
  return { code: row.psgc_code, name: row.name };
}
