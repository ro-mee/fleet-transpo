import { query } from "@/lib/db";
import { classifyPostalCode, postalNameKey } from "@/lib/address/postal-reference";

/**
 * Return the official ZIP assignments for one normalized province/locality.
 * A missing row is meaningful only as "not covered"; callers must not infer a
 * mismatch from it.
 */
export async function getPostalCodesForLocality({ province, locality }) {
  const provinceKey = postalNameKey(province);
  const localityKey = postalNameKey(locality);
  if (!provinceKey || !localityKey) return [];

  const { rows } = await query(
    `SELECT postal_code
       FROM phlpost_postal_codes
      WHERE province_key = $1 AND locality_key = $2
      ORDER BY postal_code`,
    [provinceKey, localityKey]
  );
  return rows.map((row) => ({ postalCode: String(row.postal_code) }));
}

export async function checkPostalCodeForLocality({ province, locality, postalCode }) {
  const records = await getPostalCodesForLocality({ province, locality });
  return classifyPostalCode(records, postalCode);
}
