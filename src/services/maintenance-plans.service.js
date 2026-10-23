import { query } from "@/lib/db";
import { AuthError } from "@/lib/api/utils";
import { normalizeRoleName } from "@/lib/auth/role-names";
import { toCalendarDay } from "@/lib/dates";
import { SERVICE_CODES, PLAN_FIELDS, LEGACY_PLAN_FIELDS, validateIntervals, validateOdometerObservation } from "@/lib/maintenance/service-catalog";

export function assertPlanConfigurationRole(user) {
 if (!["admin", "super_admin", "fleet_manager"].includes(normalizeRoleName(user?.role))) throw new AuthError("Only a Fleet Manager or Admin can configure service plans.", 403);
}
export function hasLegacyScheduleFields(data) {
 return Object.keys(LEGACY_PLAN_FIELDS).some(key => Object.hasOwn(data, key));
}
function vehicleId(value) {
 if (!Number.isSafeInteger(Number(value)) || Number(value) <= 0) throw new AuthError("vehicle_id must be a positive integer", 400);
 return Number(value);
}
export async function listServicePlans(user, id = null, executor = { query }) {
 const values = []; const filters = ["v.deleted_at IS NULL"];
 if (id !== null) { values.push(vehicleId(id)); filters.push(`p.vehicle_id = $${values.length}`); }
 if (normalizeRoleName(user?.role) === "mechanic") {
  values.push(user.employeeId);
  filters.push(`EXISTS (SELECT 1 FROM vehiclemaintenance vm WHERE vm.vehicle_id=p.vehicle_id AND vm.assigned_mechanic_id=$${values.length} AND vm.deleted_at IS NULL)`);
 }
 const { rows } = await executor.query(`SELECT p.*, CASE WHEN p.interval_days IS NULL AND p.interval_km IS NULL THEN 'manual' ELSE 'interval' END AS schedule_mode
 FROM vehicle_service_plans p JOIN vehicles v ON v.vehicle_id=p.vehicle_id WHERE ${filters.join(" AND ")} ORDER BY p.vehicle_id, p.service_code`, values);
 return rows;
}
export async function syncRoutineLegacy(executor, plan) {
 if (plan.service_code !== "routine") return;
 await executor.query(`UPDATE vehicles SET service_interval_days=$1, service_interval_km=$2, last_service_date=$3,
 next_service_date=$4, next_service_mileage=$5, updated_at=NOW() WHERE vehicle_id=$6`,
 [plan.interval_days, plan.interval_km === null ? null : Number(plan.interval_km), plan.last_service_date, plan.next_service_date, plan.next_service_mileage, plan.vehicle_id]);
}
export async function saveServicePlan(executor, id, code, patch, expectedVersion, actorId = null) {
 id = vehicleId(id);
 if (!SERVICE_CODES.includes(code)) throw new AuthError("Unknown service code", 400);
 if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new AuthError("A service plan object is required",400);
 if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new AuthError("expected_version must be 0 for creation or the current plan version",400);
 const { rows: vehicles } = await executor.query("SELECT vehicle_id FROM vehicles WHERE vehicle_id=$1 AND deleted_at IS NULL FOR UPDATE",[id]);
 if (!vehicles[0]) throw new AuthError("Vehicle not found",404);
 const { rows } = await executor.query("SELECT * FROM vehicle_service_plans WHERE vehicle_id=$1 AND service_code=$2 FOR UPDATE",[id,code]);
 const before = rows[0];
 if (Number(before?.version ?? 0) !== expectedVersion) throw new AuthError("Service plan changed. Reload before saving.",409);
 if (before) {
  const active = await executor.query("SELECT maintenance_id FROM vehiclemaintenance WHERE service_plan_id=$1 AND deleted_at IS NULL AND status IN ('Scheduled','In Progress','Pending Inspection') LIMIT 1",[before.plan_id]);
  if (active.rows[0]) throw new AuthError("An active work order uses this service plan. Complete or cancel it before changing the plan.",409);
 }
 const merged = Object.fromEntries(PLAN_FIELDS.map(key => [key, Object.hasOwn(patch,key) ? patch[key] : before?.[key] ?? null]));
 for (const key of ["last_service_date","next_service_date","deferred_until"]) if (merged[key] instanceof Date) merged[key] = toCalendarDay(merged[key]);
 const valid = validateIntervals({ ...merged, service_code: code });
 if (!valid.ok) throw new AuthError(Object.values(valid.errors)[0],400);
 const values = PLAN_FIELDS.map(key => valid.data[key]);
 const saved = before
  ? await executor.query(`UPDATE vehicle_service_plans SET ${PLAN_FIELDS.map((key,i)=>`${key}=$${i+1}`).join(",")}, version=version+1, updated_at=NOW(), updated_by=$9 WHERE plan_id=$10 RETURNING *`,[...values,actorId,before.plan_id])
  : await executor.query(`INSERT INTO vehicle_service_plans (${PLAN_FIELDS.join(",")}, updated_by, created_by, vehicle_id, service_code) VALUES (${PLAN_FIELDS.map((_,i)=>`$${i+1}`).join(",")},$9,$9,$10,$11) RETURNING *`,[...values,actorId,id,code]);
 await syncRoutineLegacy(executor,saved.rows[0]);
 return { before: before ?? null, plan: saved.rows[0] };
}
// Existing vehicle forms remain supported, but every schedule edit reaches the authority under the vehicle lock.
export async function syncRoutinePlanFromLegacy(executor,id,data,actorId) {
 if (!hasLegacyScheduleFields(data)) return null;
 const { rows } = await executor.query("SELECT * FROM vehicle_service_plans WHERE vehicle_id=$1 AND service_code='routine'",[id]);
 const patch = Object.fromEntries(Object.entries(LEGACY_PLAN_FIELDS).filter(([key])=>Object.hasOwn(data,key)).map(([key,target])=>[target,data[key]]));
 if (!rows[0] && !Object.values(patch).some(value=>value!==null && value!==undefined && value!=="")) return null;
 return saveServicePlan(executor,id,"routine",patch,Number(rows[0]?.version ?? 0),actorId);
}
export async function recordOdometerObservation(executor,id,input,actorId) {
 id=vehicleId(id); const valid=validateOdometerObservation(input);
 if (!valid.ok) throw new AuthError(Object.values(valid.errors)[0],400);
 const { rows } = await executor.query("SELECT vehicle_id,mileage FROM vehicles WHERE vehicle_id=$1 AND deleted_at IS NULL FOR UPDATE",[id]);
 if (!rows[0]) throw new AuthError("Vehicle not found",404);
 if (rows[0].mileage !== null && valid.data.reading_km < Number(rows[0].mileage)) throw new AuthError("Reading is below the current odometer. Decreasing corrections are not supported.",409);
 const result=await executor.query(`INSERT INTO vehicle_odometer_observations(vehicle_id,reading_km,observed_at,recorded_by,reason) VALUES($1,$2,$3,$4,$5) RETURNING *`,[id,valid.data.reading_km,valid.data.observed_at,actorId,valid.data.reason]);
 await executor.query("UPDATE vehicles SET mileage=$1,updated_at=NOW() WHERE vehicle_id=$2",[valid.data.reading_km,id]);
 return result.rows[0];
}
