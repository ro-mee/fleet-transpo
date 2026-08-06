import { query } from "@/lib/db";
import { toCalendarDay } from "@/lib/dates";

/**
 * Derives a vehicle's next service due-dates when a maintenance record
 * completes.
 *
 * Before this existed, next_service_date was hand-typed at vehicle creation
 * and never updated, so a vehicle serviced ten times still carried its original
 * due-date — or a blank one, at which point it silently dropped out of the
 * prediction entirely.
 *
 * A null interval yields a null due-date rather than a guessed one. That is the
 * same "this dimension does not participate" signal the engine consumes, so a
 * fleet manager who only tracks kilometres is not handed an invented date.
 */

/**
 * Adds whole days to a YYYY-MM-DD string, staying in calendar space.
 *
 * The arithmetic runs through a local Date and comes back out via
 * toCalendarDay rather than round-tripping through toISOString: at UTC+8 that
 * round-trip returns the day before the one requested, which would set every
 * derived due-date one day early. See the note on src/lib/dates.js:7.
 */
function addDays(isoDay, days) {
  const [y, m, d] = isoDay.split("-").map(Number);
  return toCalendarDay(new Date(y, m - 1, d + days));
}

function numOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function deriveNextSchedule({
  completedDate,
  mileageAtService,
  currentMileage,
  intervalDays,
  intervalKm,
} = {}) {
  const lastServiceDate = toCalendarDay(completedDate);
  if (!lastServiceDate) {
    return { last_service_date: null, next_service_date: null, next_service_mileage: null };
  }

  const days = numOrNull(intervalDays);
  const km = numOrNull(intervalKm);

  // Measured from the odometer AT the service, not from today. Using current
  // mileage would give away every kilometre driven since the service,
  // shortening the interval by however long the record took to be entered.
  const baseMileage = numOrNull(mileageAtService) ?? numOrNull(currentMileage);

  return {
    last_service_date: lastServiceDate,
    next_service_date: days === null ? null : addDays(lastServiceDate, days),
    next_service_mileage: km === null || baseMileage === null ? null : baseMileage + km,
  };
}

/**
 * Postgres types of the columns deriveNextSchedule writes, so GREATEST gets two
 * arguments of the same type instead of leaving Postgres to infer one from an
 * untyped string parameter. Per migration 001: both dates are DATE and
 * next_service_mileage is DECIMAL(12,2).
 */
const COLUMN_CASTS = {
  last_service_date: "date",
  next_service_date: "date",
  next_service_mileage: "numeric",
};

/**
 * Applies deriveNextSchedule to the vehicle. No-ops unless the maintenance
 * record is Completed — a Scheduled or In Progress record has not moved the
 * service clock and must not advance the due-date.
 *
 * Only non-null derived fields are written, so a vehicle with one interval set
 * keeps its other hand-entered due-date instead of having it blanked.
 *
 * Every write is clamped with GREATEST so the schedule can only ever move
 * forward. Without it, an old maintenance record flipped to Completed today
 * would overwrite a correct schedule with its own earlier values and mark a
 * freshly-serviced vehicle overdue. The clamp lives in SQL rather than in a
 * read-then-compare here because a read-compare-write is a race between two
 * concurrent completions, and the write is already a single statement. This is
 * the same shape the trip routes use for vehicles.mileage.
 *
 * COALESCE is inside GREATEST, not around it: a NULL existing column must adopt
 * the derived value, and `GREATEST(NULL, x)` in Postgres does return x — but
 * relying on that would leave the intent implicit, and the COALESCE also pins
 * the type of the existing side.
 *
 * The clamp's cost is that one bad entry is permanent through this path: a
 * typo'd year or a mis-keyed odometer pushes the schedule out, and every later
 * correct completion is clamped away, so the vehicle's effective service
 * interval silently lengthens. Two things address that. The UPDATE RETURNS the
 * written columns and this function logs any column where the clamp kept the
 * existing value over the incoming one, so the condition is at least
 * observable rather than silent. And the correction path is
 * PUT /api/vehicles/[id], whose allowlist includes next_service_date and
 * next_service_mileage and which does NOT clamp — an authorized fleet manager
 * can pull a schedule back there. last_service_date is deliberately absent from
 * that allowlist, so the record of when a service actually happened stays owned
 * by this function.
 */
export async function recomputeVehicleSchedule(vehicleId, maintenanceRow = {}) {
  if (!vehicleId) return;
  if (String(maintenanceRow.status || "").toLowerCase() !== "completed") return;

  const { rows } = await query(
    `SELECT mileage, service_interval_km, service_interval_days
       FROM vehicles WHERE vehicle_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [vehicleId]
  );
  const vehicle = rows[0];
  if (!vehicle) return;

  const derived = deriveNextSchedule({
    // completed_date is the authority; maintenance_date is the fallback for
    // records completed without one being entered.
    completedDate: maintenanceRow.completed_date || maintenanceRow.maintenance_date,
    mileageAtService: maintenanceRow.mileage_at_service,
    currentMileage: vehicle.mileage,
    intervalDays: vehicle.service_interval_days,
    intervalKm: vehicle.service_interval_km,
  });

  const sets = [];
  const values = [];
  const attempted = {};
  for (const [column, value] of Object.entries(derived)) {
    if (value === null) continue;
    values.push(String(value));
    attempted[column] = String(value);
    const cast = `$${values.length}::${COLUMN_CASTS[column]}`;
    sets.push(`${column} = GREATEST(COALESCE(${column}, ${cast}), ${cast})`);
  }
  if (sets.length === 0) return;

  const written = Object.keys(attempted);
  values.push(vehicleId);
  const { rows: after } = await query(
    `UPDATE vehicles SET ${sets.join(", ")}, updated_at = NOW()
      WHERE vehicle_id = $${values.length}
      RETURNING ${written.join(", ")}`,
    values
  );

  logSuppressedWrites(vehicleId, attempted, after[0]);
}

/**
 * Reports any column where GREATEST kept the existing value over the incoming
 * one.
 *
 * Without this the clamp is invisible: the request succeeds, the response is a
 * 200, and the only evidence that a completion did not move the schedule is the
 * absence of a change nobody is watching for. Comparison is on the calendar day
 * and on the number, not on the raw strings, because Postgres hands DATE back
 * as a Date and DECIMAL back as a string with its own scale — "55000" and
 * "55000.00" are the same value and must not read as a suppressed write.
 */
function logSuppressedWrites(vehicleId, attempted, row) {
  if (!row) return;
  for (const [column, incoming] of Object.entries(attempted)) {
    const kept = row[column];
    const same =
      COLUMN_CASTS[column] === "numeric"
        ? Number(kept) === Number(incoming)
        : toCalendarDay(kept) === toCalendarDay(incoming);
    if (same) continue;
    console.warn(
      `[maintenance-schedule] clamp suppressed a write on vehicle ${vehicleId}: ` +
        `${column} stayed at ${toCalendarDay(kept) ?? kept} rather than moving back to ${incoming}. ` +
        `Correct it through PUT /api/vehicles/${vehicleId} if the existing value is wrong.`
    );
  }
}
