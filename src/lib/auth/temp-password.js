import { randomInt } from "node:crypto";
import { isPassword } from "@/lib/validation/index";
import { DEFAULT_SECURITY_POLICY } from "@/lib/security-policy";

// Defaults, exported because callers and tests reach for them as "what the
// policy is out of the box". The expiry itself takes the configured number of
// days — see `tempPasswordExpiry`.
export const TEMP_PASSWORD_TTL_DAYS = DEFAULT_SECURITY_POLICY.tempPasswordTtlDays;
export const TEMP_PASSWORD_TTL_MS = TEMP_PASSWORD_TTL_DAYS * 24 * 60 * 60 * 1000;

// No <, >, &, or quotes — keeps email HTML/text safe; HTML output is still escaped.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const SPECIAL = "!@#$%^*?-_+=";
const ALL = UPPER + LOWER + DIGITS + SPECIAL;

const pick = (set) => set[randomInt(set.length)];

function shuffle(chars) {
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars;
}

export function generateTempPassword(length = 16) {
  if (length < 8) throw new Error("length must be at least 8");
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SPECIAL)];
  while (chars.length < length) chars.push(pick(ALL));
  const password = shuffle(chars).join("");
  if (!isPassword(password)) throw new Error("generated password fails policy");
  return password;
}

/**
 * When a temporary password issued at `from` stops working.
 *
 * `ttlDays` is supplied by the caller from the configured security policy so
 * this stays synchronous and free of a database read — it runs inside
 * transactions on the invite and register paths. Omitted, it uses the default,
 * which is the behaviour before the policy was configurable.
 *
 * @param {number|Date} [from]
 * @param {number} [ttlDays]
 */
export function tempPasswordExpiry(from = Date.now(), ttlDays = TEMP_PASSWORD_TTL_DAYS) {
  const base = from instanceof Date ? from.getTime() : from;
  const days = Number.isFinite(Number(ttlDays)) && Number(ttlDays) > 0
    ? Number(ttlDays)
    : TEMP_PASSWORD_TTL_DAYS;
  return new Date(base + days * 24 * 60 * 60 * 1000);
}
