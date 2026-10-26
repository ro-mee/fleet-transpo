import { query } from "@/lib/db";
import { toCalendarDay } from "@/lib/dates";
import { syncRoutineLegacy } from "@/services/maintenance-plans.service";
import { AuthError } from "@/lib/api/utils";

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
  const baseMileage = numOrNull(mileageAtService);

  return {
    last_service_date: lastServiceDate,
    next_service_date: days === null ? null : addDays(lastServiceDate, days),
    next_service_mileage: km === null || baseMileage === null ? null : baseMileage + km,
  };
}

/** Completions and compatibility columns share the caller's transaction and vehicle lock. */
export async function recomputeVehicleSchedule(vehicleId, maintenanceRow = {}, executor = { query }) {
 if (!vehicleId || String(maintenanceRow.status || "").toLowerCase() !== "completed") return;
 if (!maintenanceRow.service_plan_id && maintenanceRow.maintenance_type !== "Routine") return;
 if (!toCalendarDay(maintenanceRow.completed_date)) return;
 const { rows } = await executor.query(
  `SELECT * FROM vehicle_service_plans WHERE vehicle_id=$1 AND ${maintenanceRow.service_plan_id ? "plan_id=$2" : "service_code='routine'"} FOR UPDATE`,
  maintenanceRow.service_plan_id ? [vehicleId,maintenanceRow.service_plan_id] : [vehicleId]);
 const plan=rows[0]; if (!plan) return;
 // The caller holds the vehicle and plan locks; a separate approval must not strand this cycle.
 if (!maintenanceRow.service_plan_id) {
  const active = await executor.query("SELECT maintenance_id FROM vehiclemaintenance WHERE service_plan_id=$1 AND deleted_at IS NULL AND status IN ('Scheduled','In Progress','Pending Inspection') LIMIT 1", [plan.plan_id]);
  if (active.rows[0]) throw new AuthError("An active linked Routine work order uses this service plan. Complete or cancel it before approving separate Routine work.", 409);
 }
 if (maintenanceRow.service_plan_id && Number(maintenanceRow.service_plan_version)!==Number(plan.version)) throw new AuthError("Service plan changed since this work order was scheduled.",409);
 const derived=deriveNextSchedule({completedDate:maintenanceRow.completed_date,mileageAtService:maintenanceRow.mileage_at_service,intervalDays:plan.interval_days,intervalKm:plan.interval_km});
 // Backdated records cannot rewind a newer service cycle. Unknown mileage remains unknown.
 const { rows: after }=await executor.query(`UPDATE vehicle_service_plans SET
 last_service_date=GREATEST(last_service_date,$1::date),
 last_service_mileage=CASE WHEN last_service_date IS NULL OR last_service_date <= $1::date THEN $2::numeric ELSE last_service_mileage END,
 next_service_date=GREATEST(next_service_date,$3::date), next_service_mileage=GREATEST(next_service_mileage,$4::numeric),
 deferred_until=NULL,defer_reason=NULL,version=version+1,updated_at=NOW(),updated_by=$5
 WHERE plan_id=$6 RETURNING *`,[derived.last_service_date,maintenanceRow.mileage_at_service ?? null,derived.next_service_date,derived.next_service_mileage,maintenanceRow.completed_by ?? null,plan.plan_id]);
 if (after[0]) { await syncRoutineLegacy(executor,after[0]); return { before: plan, plan: after[0] }; }
}
