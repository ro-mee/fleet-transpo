export const SUPPORTED_LICENSE_TYPES = Object.freeze(["Professional"]);
export const SUPPORTED_LICENSE_CLASSES = Object.freeze(["B", "B1"]);
export const LICENSE_VERIFICATION_METHODS = Object.freeze(["physical_card", "lto_digital_id"]);
export const LICENSE_TIME_ZONE = "Asia/Manila";

const LICENSE_NUMBER_PATTERN = /^[A-Z0-9][A-Z0-9 .-]*$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateOnly(value) {
  if (typeof value !== "string" || !DATE_ONLY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function formatPartsInManila(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LICENSE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year && values.month && values.day
    ? values.year + "-" + values.month + "-" + values.day
    : null;
}

export function licenseCalendarDay(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    // PostgreSQL DATE values are handed to this application as local-midnight
    // Date objects. Keep their calendar components, as the existing date helper
    // does, instead of shifting them through UTC.
    return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
  }

  const text = String(value).trim();
  if (DATE_ONLY_PATTERN.test(text)) return isValidDateOnly(text) ? text : null;
  const instant = new Date(text);
  return Number.isFinite(instant.getTime()) ? formatPartsInManila(instant) : null;
}

function referenceCalendarDay(value) {
  if (typeof value === "string" && DATE_ONLY_PATTERN.test(value.trim())) {
    return isValidDateOnly(value.trim()) ? value.trim() : null;
  }
  const instant = value instanceof Date ? value : new Date(value);
  return Number.isFinite(instant.getTime()) ? formatPartsInManila(instant) : null;
}

export function licenseReferenceCalendarDay(value = new Date()) {
  return referenceCalendarDay(value);
}

export function isValidLicenseNumber(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toUpperCase();
  return normalized.length > 0 && normalized.length <= 30 && LICENSE_NUMBER_PATTERN.test(normalized);
}

export function licenseNumberEvidence(value) {
  return {
    license_number_present: typeof value === "string" && value.trim().length > 0,
    license_number_valid: isValidLicenseNumber(value),
  };
}

export function normalizeLicenseType(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "professional" || normalized === "professional driver") return "Professional";
  return null;
}

export function isValidLicenseExpiry(value) {
  // Accept anything licenseCalendarDay can read — including the Date objects
  // node-postgres hands back for DATE columns. Requiring a YYYY-MM-DD string
  // here made staff verification impossible for every driver whose expiry was
  // read from the database rather than typed into a form.
  return licenseCalendarDay(value) !== null;
}

export function validateLicenseDetails(details, { requireAll = false } = {}) {
  const errors = {};
  const present = (key) => Object.prototype.hasOwnProperty.call(details ?? {}, key);

  if (requireAll || present("license_number")) {
    if (!details?.license_number || !String(details.license_number).trim()) errors.license_number = "License number is required.";
    else if (!isValidLicenseNumber(details.license_number)) errors.license_number = "License number is malformed. Use letters, numbers, spaces, periods, or hyphens only.";
  }

  if (requireAll || present("license_type")) {
    if (!details?.license_type || !String(details.license_type).trim()) errors.license_type = "License type is required.";
    else if (/^student(?:\s|$)/i.test(String(details.license_type).trim())) errors.license_type = "Student Permit is not eligible for driving assignments.";
    else if (!normalizeLicenseType(details.license_type)) errors.license_type = "Unsupported license type. Professional is the only license type currently supported for fleet driving.";
  }

  if (requireAll || present("license_class")) {
    if (!details?.license_class || !String(details.license_class).trim()) errors.license_class = "License class is required.";
    else if (!normalizeLicenseClasses(details.license_class)) errors.license_class = "Unsupported license class. Supported classes are B and B1.";
  }

  if (requireAll || present("license_expiry")) {
    if (details?.license_expiry == null || (typeof details.license_expiry === "string" && !details.license_expiry.trim())) errors.license_expiry = "License expiration date is required.";
    else if (!isValidLicenseExpiry(details.license_expiry)) errors.license_expiry = "License expiration date must be a valid date.";
  }

  return errors;
}

export function normalizeLicenseClasses(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const codes = value
    .toUpperCase()
    .split(/[\s,;/]+/)
    .filter(Boolean);
  if (!codes.length || codes.some((code) => !SUPPORTED_LICENSE_CLASSES.includes(code))) return null;
  return SUPPORTED_LICENSE_CLASSES.filter((code) => codes.includes(code));
}

export function formatLicenseClasses(value) {
  const codes = normalizeLicenseClasses(value);
  return codes ? codes.join(", ") : "";
}

export function licenseExpiryIsBefore(licenseExpiry, reference = new Date()) {
  const expiryDay = licenseCalendarDay(licenseExpiry);
  const referenceDay = licenseReferenceCalendarDay(reference);
  return Boolean(expiryDay && referenceDay && expiryDay < referenceDay);
}

export function evaluateDriverLicenseEligibility(driver, vehicle, reference = new Date()) {
  const reasons = [];
  const number = typeof driver?.license_number === "string" ? driver.license_number.trim() : "";
  const numberIsMasked = number.startsWith("********");
  const numberIsValid = number
    ? (numberIsMasked ? driver?.license_number_valid === true : isValidLicenseNumber(number))
    : driver?.license_number_valid === true;
  const type = normalizeLicenseType(driver?.license_type);
  const classes = normalizeLicenseClasses(driver?.license_class);
  const expiryDay = licenseCalendarDay(driver?.license_expiry);
  const referenceDay = referenceCalendarDay(reference);
  const requiredClass = typeof vehicle?.required_license_class === "string"
    ? vehicle.required_license_class.trim().toUpperCase()
    : "";

  if (!number && driver?.license_number_present !== true) reasons.push("License number is missing.");
  else if (!numberIsValid) {
    reasons.push("License number is malformed.");
  }

  if (typeof driver?.license_type === "string" && /^student(?:\s|$)/i.test(driver.license_type.trim())) {
    reasons.push("Student Permit is not eligible for driving assignments.");
  } else if (!type || !SUPPORTED_LICENSE_TYPES.includes(type)) {
    reasons.push("Unsupported license type; a Professional license is required for fleet driving.");
  }

  if (!classes) {
    reasons.push("License class is missing or unsupported.");
  }

  if (!expiryDay) {
    reasons.push("License expiration date is missing or invalid.");
  } else if (referenceDay && expiryDay < referenceDay) {
    reasons.push("Expired license (expired on " + expiryDay + ").");
  }

  if (
    !driver?.license_verified_at ||
    !driver?.license_verified_by ||
    !LICENSE_VERIFICATION_METHODS.includes(driver?.license_verification_method)
  ) {
    reasons.push("License details have not been verified by authorized staff.");
  }

  if (!requiredClass || !SUPPORTED_LICENSE_CLASSES.includes(requiredClass)) {
    reasons.push("Vehicle required license class is missing or unsupported.");
  } else if (classes && !classes.includes(requiredClass)) {
    reasons.push("License class does not cover this vehicle (requires " + requiredClass + ").");
  }

  return {
    eligible: reasons.length === 0,
    reason: reasons[0] ?? null,
    reasons,
    expiryDay,
    referenceDay,
  };
}

export function maskLicenseNumber(value) {
  if (typeof value !== "string" || !value.trim()) return value ?? null;
  const normalized = value.trim();
  const visible = normalized.slice(-4);
  return "********" + visible;
}
