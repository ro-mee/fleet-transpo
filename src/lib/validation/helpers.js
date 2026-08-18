import {
  PATTERNS,
  LIMITS,
  isEmail,
  isPhonePH,
  isName,
  isAlphaNumeric,
  isVIN,
  isYear,
  isSeatingCapacity,
  isPositiveNumber,
  isPlateNumberPH,
  isLicenseNumber,
  isIsoDate,
  isDateInPast,
  isTime,
  isPassword,
  hasPasswordLowercase,
  hasPasswordUppercase,
  hasPasswordNumber,
  hasPasswordSpecial,
  isId,
  isUuid,
  isUrl,
  isBase64DataUrl,
  normalizePlate,
  normalizeName,
  normalizeEmail,
  normalizePhone,
  normalizeLicense,
  toProperCase,
  toVehicleTitleCase,
} from "./index";

export { normalizePlate, normalizeName, normalizeEmail, normalizePhone, normalizeLicense, toProperCase, toVehicleTitleCase, isUrl, isBase64DataUrl, isEmail, isPhonePH, isName, isId, isUuid, isPassword, hasPasswordLowercase, hasPasswordUppercase, hasPasswordNumber, hasPasswordSpecial, isIsoDate, isDateInPast, isTime, isPositiveNumber, isSeatingCapacity, isYear, isVIN, isLicenseNumber, isPlateNumberPH };

export const ERRORS = {
  required: (label) => `${label} is required.`,
  name: (label) => `${label} must be at least ${LIMITS.NAME_MIN} characters and contain only letters (no numbers or special characters).`,
  email: "Please enter a valid email address.",
  phone: "Please enter a valid Philippine phone number (e.g. 09171234567 or +639171234567).",
  plate: "Please enter a valid Philippine plate number (e.g. ABC-1234).",
  license: "License number must be alphanumeric and between 1 and 30 characters.",
  vin: "VIN must be exactly 17 characters (no I, O, or Q).",
  alphanumeric: (label) => `${label} must contain only letters and numbers.`,
  year: (label) => `${label} must be between ${LIMITS.YEAR_MIN} and ${new Date().getFullYear() + 1}.`,
  seating: (label) => `${label} must be a whole number between ${LIMITS.SEAT_MIN} and ${LIMITS.SEAT_MAX}.`,
  positive: (label, min = 0) => (min > 0 ? `${label} must be at least ${min}.` : `${label} must be a non-negative number.`),
  date: (label) => `${label} must be a valid date.`,
  pastDate: (label) => `${label} must not be in the past.`,
  time: (label) => `${label} must be a valid time.`,
  passwordLength: `Password must be at least ${LIMITS.PASSWORD_MIN} characters.`,
  passwordUppercase: "Password must contain at least one uppercase letter.",
  passwordLowercase: "Password must contain at least one lowercase letter.",
  passwordNumber: "Password must contain at least one number.",
  passwordSpecial: "Password must contain at least one special character.",
  passwordMatch: "Passwords do not match.",
  passwordSame: "New password must be different from the current password.",
  id: (label) => `${label} is invalid.`,
  uuid: (label) => `${label} is invalid.`,
  url: (label) => `${label} must be a valid URL.`,
  base64Url: (label) => `${label} must be a valid image (base64 data URL).`,
};

export const isNotEmpty = (value) => value !== undefined && value !== null && String(value).trim() !== "";

export function maintenanceDateRule(value, values = {}) {
  if (!value) return null;
  const status = String(values.status || "").toLowerCase();
  if (status !== "scheduled" && status !== "completed") return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  if (status === "scheduled" && d.getTime() < today.getTime()) {
    return "Scheduled maintenance cannot be in the past.";
  }
  if (status === "completed" && d.getTime() > today.getTime()) {
    return "Completed maintenance cannot be in the future.";
  }
  return null;
}

/**
 * A completion date can never be in the future, whatever the record's status.
 *
 * Distinct from maintenanceDateRule, which only bounds maintenance_date and
 * only when status is Scheduled or Completed. completed_date needs its own
 * unconditional rule because recomputeVehicleSchedule prefers it over
 * maintenance_date when advancing a vehicle's next service date, and that
 * advance is clamped forward-only — so a future completion date moves the
 * vehicle's schedule out beyond the prediction horizon with no way back.
 */
export function completionDateRule(value) {
  if (!value) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() > today.getTime()) {
    return "Completed date cannot be in the future.";
  }
  return null;
}

export function validateField(value, spec = {}, label = "This field", allValues = null) {
  const {
    required = false,
    type,
    minLength,
    maxLength,
    pattern,
    message,
    min,
    max,
    integer = false,
    optional = false,
    validate,
  } = spec;

  const effectivePattern = pattern ?? type;

  if (!isNotEmpty(value)) {
    if (required) return ERRORS.required(label);
    if (optional) return null;
  }

  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  if (minLength !== undefined && String(value).length < minLength) {
    return `${label} must be at least ${minLength} characters.`;
  }

  if (maxLength !== undefined && String(value).length > maxLength) {
    return `${label} must be at most ${maxLength} characters.`;
  }

  if (effectivePattern) {
    if (typeof effectivePattern === "string") {
      const map = {
        email: () => (isEmail(value) ? null : message || ERRORS.email),
        phone: () => (isPhonePH(value) ? null : message || ERRORS.phone),
        name: () => (isName(value) ? null : message || ERRORS.name(label)),
        alphanumeric: () => (isAlphaNumeric(value) ? null : message || ERRORS.alphanumeric(label)),
        vin: () => (isVIN(value) ? null : message || ERRORS.vin),
        plate: () => (isPlateNumberPH(value) ? null : message || ERRORS.plate),
        license: () => (isLicenseNumber(value) ? null : message || ERRORS.license),
        year: () => (isYear(value) ? null : message || ERRORS.year(label)),
        seating: () => (isSeatingCapacity(value) ? null : message || ERRORS.seating(label)),
        positiveNumber: () => {
          if (!isPositiveNumber(value, min, max)) return message || ERRORS.positive(label, min);
          if (integer && !Number.isInteger(Number(value))) return message || `${label} must be a whole number.`;
          return null;
        },
        date: () => (isIsoDate(value) ? null : message || ERRORS.date(label)),
        pastDate: () => (isDateInPast(value) ? null : message || ERRORS.pastDate(label)),
        time: () => (isTime(value) ? null : message || ERRORS.time(label)),
        password: () => {
          if (!isPassword(value)) {
            if (!hasPasswordLowercase(value)) return ERRORS.passwordLowercase;
            if (!hasPasswordUppercase(value)) return ERRORS.passwordUppercase;
            if (!hasPasswordNumber(value)) return ERRORS.passwordNumber;
            if (!hasPasswordSpecial(value)) return ERRORS.passwordSpecial;
            return ERRORS.passwordLength;
          }
          return null;
        },
        id: () => (isId(value) ? null : message || ERRORS.id(label)),
        uuid: () => (isUuid(value) ? null : message || ERRORS.uuid(label)),
        url: () => (isUrl(value) ? null : message || ERRORS.url(label)),
        base64Url: () => (isBase64DataUrl(value) ? null : message || ERRORS.base64Url(label)),
      };
      const fn = map[effectivePattern];
      if (fn) {
        const res = fn();
        if (res) return res;
      }
    }
    if (effectivePattern instanceof RegExp && !effectivePattern.test(String(value))) {
      return message || `${label} is invalid.`;
    }
  }

  if (validate) {
    const msg = validate(value, allValues);
    if (typeof msg === "string" && msg) return msg;
  }

  return null;
}

export function validatePayload(body, schema = {}) {
  const errors = {};
  for (const [field, spec] of Object.entries(schema)) {
    if (typeof spec === "function") {
      const msg = spec(body[field], body);
      if (msg) errors[field] = msg;
      continue;
    }
    const label = typeof spec === "string" ? spec : spec?.label || field.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const error = validateField(body[field], typeof spec === "string" ? { required: true } : spec, label, body);
    if (error) errors[field] = error;
  }
  return errors;
}

export function firstError(errors) {
  return Object.values(errors)[0] || null;
}

export function isValidObject(errors) {
  return Object.keys(errors).length === 0;
}

export const validateBody = validatePayload;
