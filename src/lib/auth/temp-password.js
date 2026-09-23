import { randomInt } from "node:crypto";
import { isPassword } from "@/lib/validation/index";

export const TEMP_PASSWORD_TTL_DAYS = 7;
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

export function tempPasswordExpiry(from = Date.now()) {
  const base = from instanceof Date ? from.getTime() : from;
  return new Date(base + TEMP_PASSWORD_TTL_MS);
}
