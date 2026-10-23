import { AuthError } from "@/lib/api/utils";
import { assertPlanConfigurationRole } from "@/services/maintenance-plans.service";
import { getMaintenanceOutlook } from "@/services/maintenance-outlook.service";

export function isReviewedPlanRequest(body) {
  return Object.hasOwn(body, "service_plan_id") || Object.hasOwn(body, "expected_version") || Object.hasOwn(body, "service_plan_version");
}

// The caller owns the transaction, required audit, status sync and post-commit notification.
export async function reviewPlanWorkOrder(tx, user, body, now = new Date()) {
  assertPlanConfigurationRole(user);
  for (const key of ["vehicle_id", "service_plan_id"]) {
    if (!["number", "string"].includes(typeof body[key]) || !Number.isSafeInteger(Number(body[key])) || Number(body[key]) <= 0) throw new AuthError(`${key} must be a positive integer`, 400);
  }
  if (!Number.isSafeInteger(body.expected_version) || body.expected_version < 1) throw new AuthError("expected_version must be the current service plan version", 400);
  const vehicleId = Number(body.vehicle_id);
  const vehicle = (await tx.query("SELECT vehicle_id FROM vehicles WHERE vehicle_id=$1 AND deleted_at IS NULL FOR UPDATE", [vehicleId])).rows[0];
  if (!vehicle) throw new AuthError("Vehicle not found", 404);
  const plan = (await tx.query("SELECT * FROM vehicle_service_plans WHERE vehicle_id=$1 AND plan_id=$2 FOR UPDATE", [vehicleId, Number(body.service_plan_id)])).rows[0];
  if (!plan) throw new AuthError("Service plan not found for this vehicle", 404);
  if (Number(plan.version) !== body.expected_version) throw new AuthError("Service plan changed. Reload before scheduling.", 409);
  const existing = (await tx.query(`SELECT * FROM vehiclemaintenance WHERE service_plan_id=$1 AND deleted_at IS NULL
    AND status IN ('Scheduled','In Progress','Pending Inspection') FOR UPDATE`, [plan.plan_id])).rows[0];
  if (existing) return { existing, plan, reviewedService: null };
  const outlook = await getMaintenanceOutlook(user, now, tx);
  const service = outlook.predictions.find(p => Number(p.vehicle_id) === vehicleId)?.services.find(s => Number(s.plan_id) === Number(plan.plan_id));
  if (!service || Number(service.version) !== Number(plan.version)) throw new AuthError("Service outlook changed or is unavailable. Reload before scheduling.", 409);
  // Narrow transaction-local hand-off for Task 6 snapshots. Never read forecast facts from body.
  return { existing: null, plan, reviewedService: { assessed_at: now.toISOString(), vehicle_id: vehicleId, ...service } };
}

const WORK_ORDER_SELECT = `SELECT status, created_by, repair_completed_by, assigned_mechanic_id, repair_started_at, priority,
  vehicle_id, maintenance_date, maintenance_type, service_plan_id, service_plan_version FROM vehiclemaintenance
  WHERE maintenance_id = $1 AND deleted_at IS NULL`;

export async function lockMaintenanceWorkOrder(tx, id, targetVehicleId, completing, targetMaintenanceType) {
  const discovered = (await tx.query(WORK_ORDER_SELECT, [id])).rows[0];
  if (!discovered) return { beforeRow: null, vehicleIds: [] };
  const vehicleIds = [...new Set([discovered.vehicle_id, targetVehicleId ?? discovered.vehicle_id].filter(v => v != null).map(Number))].sort((a,b) => a-b);
  if (vehicleIds.length) await tx.query("SELECT vehicle_id FROM vehicles WHERE vehicle_id = ANY($1::int[]) ORDER BY vehicle_id FOR UPDATE", [vehicleIds]);
  if (discovered.service_plan_id || (completing && (targetMaintenanceType ?? discovered.maintenance_type) === "Routine")) {
    await tx.query(`SELECT * FROM vehicle_service_plans WHERE vehicle_id=$1 AND ${discovered.service_plan_id ? "plan_id=$2" : "service_code='routine'"} FOR UPDATE`, discovered.service_plan_id ? [discovered.vehicle_id, discovered.service_plan_id] : [targetVehicleId ?? discovered.vehicle_id]);
  }
  const beforeRow = (await tx.query(`${WORK_ORDER_SELECT} FOR UPDATE`, [id])).rows[0];
  if (beforeRow && (beforeRow.vehicle_id !== discovered.vehicle_id || beforeRow.service_plan_id !== discovered.service_plan_id || beforeRow.service_plan_version !== discovered.service_plan_version || beforeRow.maintenance_type !== discovered.maintenance_type)) throw new AuthError("Work order changed. Reload before saving.", 409);
  return { beforeRow, vehicleIds };
}

export function assertWorkOrderPlanUnchanged(before, body) {
  for (const key of ["service_plan_id", "service_plan_version"]) {
    if (Object.hasOwn(body,key) && body[key] !== before[key] && Number(body[key]) !== Number(before[key])) throw new AuthError("A work order's service task and cycle cannot be changed. Cancel it and review a new order.",409);
  }
  if (before.service_plan_id && body.vehicle_id !== undefined && Number(body.vehicle_id) !== Number(before.vehicle_id)) throw new AuthError("A linked work order cannot move to another vehicle. Cancel it and review a new order.",409);
}
