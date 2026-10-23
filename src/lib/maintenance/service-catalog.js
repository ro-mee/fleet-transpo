export const SERVICE_CODES = Object.freeze(["routine", "brakes", "tires"]);
export const PLAN_FIELDS = Object.freeze(["interval_days", "interval_km", "last_service_date", "last_service_mileage", "next_service_date", "next_service_mileage", "deferred_until", "defer_reason"]);
export const LEGACY_PLAN_FIELDS = Object.freeze({ service_interval_days: "interval_days", service_interval_km: "interval_km", next_service_date: "next_service_date", next_service_mileage: "next_service_mileage" });
const empty = value => value === null || value === undefined || value === "";
function numeric(value) {
 return (typeof value === "number" || typeof value === "string") && String(value).trim() !== "" && Number.isFinite(Number(value));
}
function validDay(value) {
 return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
export function validateIntervals(input = {}) {
 const data = Object.fromEntries(PLAN_FIELDS.map(key => [key, empty(input[key]) ? null : input[key]]));
 const errors = {};
 for (const key of ["interval_days", "interval_km", "last_service_mileage", "next_service_mileage"]) {
  if (data[key] === null) continue;
  if (!numeric(data[key]) || Number(data[key]) < (key.startsWith("interval") ? 1 : 0) || Number(data[key]) > 9999999999.99 || (key === "interval_days" && (!Number.isSafeInteger(Number(data[key])) || Number(data[key]) > 2147483647))) errors[key] = `${key} must be a valid ${key.startsWith("interval") ? "positive" : "non-negative"} number.`;
  else data[key] = Number(data[key]);
 }
 if (input.service_code === "routine" && data.interval_km !== null && (!Number.isSafeInteger(data.interval_km) || data.interval_km > 2147483647)) errors.interval_km = "Routine interval kilometres must be a whole number from 1 to 2,147,483,647.";
 for (const key of ["last_service_date", "next_service_date", "deferred_until"]) {
  if (data[key] !== null && !validDay(data[key])) errors[key] = `${key} must be a real calendar date (YYYY-MM-DD).`;
 }
 if (data.defer_reason !== null) {
  if (typeof data.defer_reason !== "string" || data.defer_reason.trim().length > 1000) errors.defer_reason = "Use a reason of up to 1000 characters.";
  else data.defer_reason = data.defer_reason.trim() || null;
 }
 if (data.deferred_until && !data.defer_reason) errors.defer_reason = "Record a reason for deferring service.";
 if (data.interval_days === null && data.interval_km === null && data.next_service_date === null && data.next_service_mileage === null) errors.interval_days = "Configure an interval or an explicit manual due threshold.";
 return { ok: Object.keys(errors).length === 0, errors, data };
}
export function validateOdometerObservation(input = {}, now = Date.now()) {
 const errors = {};
 if (!numeric(input.reading_km) || Number(input.reading_km) < 0 || Number(input.reading_km) > 2000000) errors.reading_km = "Reading must be between 0 and 2,000,000 km.";
 const observed = typeof input.observed_at === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(input.observed_at) ? Date.parse(input.observed_at) : NaN;
 if (!Number.isFinite(observed) || observed > now || !validDay(input.observed_at.slice(0,10))) errors.observed_at = "Record a valid observation time with its timezone; future readings are not allowed.";
 if (typeof input.reason !== "string" || !input.reason.trim() || input.reason.trim().length > 1000) errors.reason = "Record a reason of up to 1000 characters.";
 return { ok: Object.keys(errors).length === 0, errors, data: { reading_km: Number(input.reading_km), observed_at: Number.isFinite(observed) ? new Date(observed).toISOString() : null, reason: typeof input.reason === "string" ? input.reason.trim() : null } };
}
