// Mechanic Workshop shared contract helpers (UI side).
//
// Mirrors the locked backend contracts from Tasks 1–5 so the UI can never
// drift from them:
//
// - MECHANIC_WRITABLE_FIELDS: exact copy of MECHANIC_WRITABLE in
//   src/app/api/vehicle-maintenance/[id]/route.js. buildMechanicUpdateBody
//   picks ONLY these keys, so a forbidden field (cost, vehicle_id, priority,
//   next_schedule_*, deleted_at, assigned_*) can never reach the PUT body even
//   if a form ever holds one.
// - MECHANIC_TRANSITIONS: the mechanic leg of the state machine
//   (Scheduled → In Progress → Pending Inspection). Approve/Complete are
//   staff-only and have no representation here at all.
// - DIAGNOSIS_MAX_LENGTH: the 2000-char server cap, enforced inline before
//   submit so the mechanic gets feedback instead of a 400.

export const MECHANIC_WRITABLE_FIELDS = [
  "status",
  "description",
  "remarks",
  "mileage_at_service",
  "service_provider",
  "service_center",
  "technician_name",
  "service_center_name",
  "notes",
  "diagnosis",
  "parts_replaced",
  "labor_hours",
];

const MECHANIC_WRITABLE = new Set(MECHANIC_WRITABLE_FIELDS);

export const MECHANIC_TRANSITIONS = {
  Scheduled: ["In Progress"],
  "In Progress": ["Pending Inspection"],
};

export const DIAGNOSIS_MAX_LENGTH = 2000;

// Below 1024px the Workshop is read-only: mutating buttons render disabled
// with this reason instead of hiding. Never hide the reason.
export const DESKTOP_ONLY_TITLE = "Use a desktop screen to update work orders";

export const DESKTOP_MIN_WIDTH = 1024;

/**
 * The single mutating action a mechanic may take from a status, or null when
 * the job awaits someone else (Pending Inspection → FM; terminal states).
 */
export function nextMechanicAction(status) {
  if (status === "Scheduled") return { label: "Start", to: "In Progress" };
  if (status === "In Progress") return { label: "Mark Ready", to: "Pending Inspection" };
  return null;
}

/**
 * Build a PUT body containing ONLY whitelisted mechanic fields. Empty strings
 * and undefined are dropped (the route maps "" → null, but not sending the
 * key at all keeps evidence saves from wiping fields the mechanic did not
 * touch). parts_replaced must be a JSON array — enforced by Array check.
 */
export function buildMechanicUpdateBody(input = {}) {
  const raw = {
    status: input.status,
    description: input.description,
    remarks: input.remarks,
    mileage_at_service: input.mileage_at_service ?? input.mileageAtService,
    service_provider: input.service_provider ?? input.serviceProvider,
    service_center: input.service_center ?? input.serviceCenter,
    technician_name: input.technician_name,
    service_center_name: input.service_center_name,
    notes: input.notes,
    diagnosis: input.diagnosis,
    parts_replaced: Array.isArray(input.parts_replaced)
      ? input.parts_replaced
      : input.parts,
    labor_hours: input.labor_hours ?? input.laborHours,
  };
  const body = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!MECHANIC_WRITABLE.has(key)) continue;
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    body[key] = value;
  }
  return body;
}

/**
 * Serialize parts-editor rows [{ name, qty }] to the JSON array the route
 * accepts. Blank names and non-positive quantities are dropped; an editor
 * with no valid rows yields [] (and the caller omits the key).
 */
export function serializeParts(rows = []) {
  const out = [];
  for (const row of rows) {
    const name = String(row?.name ?? "").trim();
    const qty = Number(row?.qty);
    if (!name) continue;
    if (!Number.isFinite(qty) || qty <= 0) continue;
    out.push({ name, qty });
  }
  return out;
}

/** Inline diagnosis validation: null when valid, message when over the cap. */
export function validateDiagnosis(text) {
  const len = String(text ?? "").length;
  if (len > DIAGNOSIS_MAX_LENGTH) {
    return `Diagnosis must be ${DIAGNOSIS_MAX_LENGTH} characters or fewer (currently ${len}).`;
  }
  return null;
}

/** Vehicle projection tolerant of both row shapes (summary `vehicle`, lean `vehicles`). */
export function jobVehicle(job = {}) {
  const v = job.vehicle ?? job.vehicles ?? {};
  return {
    plate: v.plate_number ?? null,
    name: v.vehicle_name ?? null,
  };
}

/** One-line problem: diagnosis first, then description, else null. */
export function jobProblem(job = {}) {
  const d = String(job.diagnosis ?? "").trim();
  if (d) return d;
  const desc = String(job.description ?? "").trim();
  return desc || null;
}

/** "125 min on the line", or null when the row carries no age. */
export function jobAgeLabel(job = {}) {
  if (job.ageMinutes == null) return null;
  return `${Number(job.ageMinutes)} min on the line`;
}
