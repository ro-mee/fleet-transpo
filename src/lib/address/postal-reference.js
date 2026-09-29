import { normalizePostalCode } from "./postal";

/** Normalize locality labels shared by PSGC and the PHLPost directory. */
export function postalNameKey(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/^(?:city|municipality)\s+of\s+/, "")
    .replace(/\s+(?:city|municipality)$/, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Compare a ZIP against the PHLPost codes returned for an exact locality.
 * An empty record set means the source does not cover this locality; it must
 * stay unknown rather than turn an incomplete directory into a false error.
 */
export function classifyPostalCode(records, postalCode) {
  const codes = [...new Set((records ?? []).map((row) => normalizePostalCode(row?.postalCode ?? row?.postal_code)).filter(Boolean))].sort();
  if (codes.length === 0) return { status: "unknown", postalCodes: [] };

  const normalized = normalizePostalCode(postalCode);
  return {
    status: codes.includes(normalized) ? "match" : "mismatch",
    postalCodes: codes,
  };
}

/** The official locator labels province-less NCR entries as Metro Manila. */
export function postalProvinceName(chain) {
  if (chain?.province?.name) return chain.province.name;
  return /national capital|\bncr\b|metro manila/i.test(chain?.region?.name ?? "")
    ? "Metro Manila"
    : "";
}
