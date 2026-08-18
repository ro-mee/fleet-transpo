export const PATTERNS = {
  NAME: /^[A-Za-z\u00C0-\u017F' .-]+$/,
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  PHONE_PH: /^(?:\+63|0)9\d{9}$/,
  ALPHANUMERIC: /^[A-Za-z0-9]+$/,
  LICENSE_NUMBER: /^[A-Z0-9][A-Z0-9 .-]*$/,
  VIN: /^[A-HJ-NPR-Z0-9]{17}$/,
  ENGINE_CHASSIS: /^[A-Za-z0-9 .-]+$/,
  PLATE_PH: /^[A-Z]{1,3}[ -]?\d{1,4}[A-Z]{0,3}$/,
};

export const LIMITS = {
  NAME_MIN: 2,
  NAME_MAX: 100,
  TEXT_MAX: 255,
  PASSWORD_MIN: 8,
  YEAR_MIN: 1900,
  SEAT_MIN: 1,
  SEAT_MAX: 100,
  MONEY_MIN: 0,
  MONEY_MAX: 999999999999.99,
  MILEAGE_MIN: 0,
  FUEL_MIN: 0.01,
  FILE_MAX_MB: 10,
};

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf"];

export function isEmail(value) {
  return typeof value === "string" && PATTERNS.EMAIL.test(value.trim());
}

export function isPhonePH(value) {
  if (!value) return false;
  const cleaned = String(value).replace(/[\s()-]/g, "");
  return PATTERNS.PHONE_PH.test(cleaned);
}

export function isName(value) {
  const v = String(value ?? "").trim();
  return v.length >= LIMITS.NAME_MIN && v.length <= LIMITS.NAME_MAX && PATTERNS.NAME.test(v);
}

export function isAlphaNumeric(value) {
  return typeof value === "string" && PATTERNS.ALPHANUMERIC.test(value.trim());
}

export function isVIN(value) {
  return typeof value === "string" && PATTERNS.VIN.test(value.trim().toUpperCase());
}

export function isYear(value) {
  const n = Number(value);
  const max = new Date().getFullYear() + 1;
  return Number.isFinite(n) && n >= LIMITS.YEAR_MIN && n <= max;
}

export function isSeatingCapacity(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= LIMITS.SEAT_MIN && n <= LIMITS.SEAT_MAX;
}

export function isPositiveNumber(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max;
}

export function isPlateNumberPH(value) {
  return typeof value === "string" && PATTERNS.PLATE_PH.test(value.trim().toUpperCase());
}

export function isLicenseNumber(value) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 30 && PATTERNS.LICENSE_NUMBER.test(value.trim().toUpperCase());
}

export function isIsoDate(value) {
  if (!value || typeof value !== "string") return false;
  if (value.length === 10) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

export function isDateInPast(value) {
  if (!isIsoDate(value)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(`${String(value).slice(0, 10)}T00:00:00`) < today;
}

export function isDateInFuture(value) {
  if (!isIsoDate(value)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(`${String(value).slice(0, 10)}T00:00:00`) >= today;
}

export function isTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function isPassword(value) {
  return typeof value === "string" && value.length >= LIMITS.PASSWORD_MIN && /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);
}

export function hasPasswordLowercase(value) {
  return typeof value === "string" && /[a-z]/.test(value);
}

export function hasPasswordUppercase(value) {
  return typeof value === "string" && /[A-Z]/.test(value);
}

export function hasPasswordNumber(value) {
  return typeof value === "string" && /\d/.test(value);
}

export function hasPasswordSpecial(value) {
  return typeof value === "string" && /[^A-Za-z0-9]/.test(value);
}

export function isFileTypeAllowed(file) {
  if (!file || !file.type) return false;
  return ACCEPTED_IMAGE_TYPES.includes(file.type);
}

export function isFileSizeAllowed(file, maxMb = LIMITS.FILE_MAX_MB) {
  if (!file || !file.size) return false;
  return file.size <= maxMb * 1024 * 1024;
}

export function isId(value) {
  if (value === undefined || value === null || value === "") return false;
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}

export function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function isUrl(value) {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function isBase64DataUrl(value) {
  if (typeof value !== "string") return false;
  return /^data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=\s]+$/.test(value);
}

export function normalizePlate(value) {
  return String(value ?? "").trim().toUpperCase();
}

export function normalizeName(value) {
  return String(value ?? "").trim();
}

// Standard Proper Case (Title Case) for person names.
//
// Lowercases the whole string, then capitalises the first letter of every word.
// Handles hyphenated and apostrophe names so "O'NEILL" -> "O'Neill" and
// "juan-carlos" -> "Juan-Carlos". Existing whitespace is collapsed. Designed
// for DISPLAY / data cleanup only — do not feed it into the email-builder path
// (drivers/route.js derives emails from normalizeName().toLowerCase(), and a
// multi-word Title-Cased value would inject spaces into an address).
export function toProperCase(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/(^|[\s\-'])([a-z0-9])/g, (m, sep, ch) => `${sep}${ch.toUpperCase()}`);
}

// Vehicle type acronyms that must stay uppercase in a Title-Cased name.
// ("SUV", "MPV", "AUV", ...) — the general proper-case rule would wrongly
// produce "Suv", "Mpv", etc.
const VEHICLE_ACRONYMS = new Set(["SUV", "MPV", "AUV", "EV", "HEV", "PHEV", "4WD", "AWD", "2WD"]);

// Standard Proper Case for VEHICLE names / models / manufacturers.
//
// Like toProperCase (lowercase then capitalise each word), but:
//   - a hyphen becomes a space, so "TEST-VEHICLE" -> "Test Vehicle";
//   - a known vehicle-type acronym stays uppercase ("SUV" stays "SUV");
//   - a token containing a digit is treated as a model identifier and left
//     verbatim ("CiviC18S" stays "CiviC18S", not "Civic18s").
// Plate numbers are deliberately NOT passed through this — they are already
// ALL CAPS identifiers and must never be lowercased.
export function toVehicleTitleCase(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/-/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      const upper = word.toUpperCase();
      if (VEHICLE_ACRONYMS.has(upper) || /\d/.test(word)) return word;
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizePhone(value) {
  return String(value ?? "").trim();
}

export function normalizeLicense(value) {
  return String(value ?? "").trim().toUpperCase();
}
