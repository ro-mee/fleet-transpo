import { query } from "@/lib/db";
import { normalizeRoleName } from "@/lib/auth/role-names";
import { evaluateServiceOutcome, recurringInspectionSignals, normalizeInspectionItems, INSPECTION_RULE_VERSION } from "@/lib/maintenance/inspection-signals";
export const FORECAST_RULE_VERSION="service-outlook-v1";
export async function appendMaintenanceSnapshot(tx,{event,order,forecast={},inputs={},outcome={},actorId=null}) {
 return (await tx.query(`INSERT INTO maintenance_forecast_snapshots(vehicle_id,service_plan_id,maintenance_id,rule_version,event,inputs,forecast,outcome,captured_by)
 VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9) RETURNING snapshot_id`,
 [order.vehicle_id,order.service_plan_id ?? null,order.maintenance_id ?? null,["inspection_reviewed","mechanic_outcome"].includes(event)?INSPECTION_RULE_VERSION:FORECAST_RULE_VERSION,event,JSON.stringify(inputs),JSON.stringify(forecast),JSON.stringify(outcome),actorId])).rows[0];
}
export async function captureServiceCompletion(tx,order,actorId) {
 if(!order.service_plan_id && !order.inspection_items?.length) return;
 const scheduled=(await tx.query("SELECT * FROM maintenance_forecast_snapshots WHERE maintenance_id=$1 AND event='reviewed_schedule' ORDER BY snapshot_id DESC LIMIT 1",[order.maintenance_id])).rows[0];
 const crossing=(await tx.query("SELECT snapshot_id FROM maintenance_forecast_snapshots WHERE maintenance_id=$1 AND event='threshold_observed' ORDER BY snapshot_id LIMIT 1",[order.maintenance_id])).rows[0];
 return appendMaintenanceSnapshot(tx,{event:"completed",order,actorId,forecast:scheduled?.forecast ?? {},inputs:{scheduled_snapshot_id:scheduled?.snapshot_id ?? null,completed_date:order.completed_date,mileage_at_service:order.mileage_at_service,inspection_items:order.inspection_items ?? []},
 outcome:{...evaluateServiceOutcome(scheduled?.forecast,order,crossing),inspection_outcomes:order.inspection_outcomes ?? [],crossing_snapshot_id:crossing?.snapshot_id ?? null}});
}
export async function captureOdometerCrossings(tx,observation,previousReading,actorId) {
 if(previousReading==null) return;
 const {rows}=await tx.query(`SELECT s.* FROM maintenance_forecast_snapshots s JOIN vehiclemaintenance vm ON vm.maintenance_id=s.maintenance_id
 WHERE s.vehicle_id=$1 AND s.event='reviewed_schedule' AND vm.deleted_at IS NULL AND vm.status IN ('Scheduled','In Progress','Pending Inspection')
 AND NOT EXISTS(SELECT 1 FROM maintenance_forecast_snapshots crossed WHERE crossed.maintenance_id=s.maintenance_id AND crossed.event='threshold_observed')`,[observation.vehicle_id]);
 for(const snapshot of rows) {
  if(new Date(observation.observed_at).getTime() < new Date(snapshot.captured_at).getTime()) continue;
  const threshold=snapshot.forecast?.next_service_mileage;
  if(threshold==null || Number(previousReading)>=Number(threshold) || Number(observation.reading_km)<Number(threshold)) continue;
  await appendMaintenanceSnapshot(tx,{event:"threshold_observed",order:snapshot,actorId,forecast:snapshot.forecast,
   inputs:{observation_id:observation.observation_id,observed_at:observation.observed_at,previous_reading_km:Number(previousReading),reading_km:Number(observation.reading_km)},outcome:{evaluation:"threshold_observed",exact_crossing_time:"unknown"}});
 }
}
export async function maintenanceSnapshots(user,id,executor={query}) {
 const mechanic=normalizeRoleName(user?.role)==="mechanic";
 return (await executor.query(`SELECT s.* FROM maintenance_forecast_snapshots s JOIN vehiclemaintenance vm ON vm.maintenance_id=s.maintenance_id
 WHERE s.maintenance_id=$1 AND vm.deleted_at IS NULL ${mechanic?"AND vm.assigned_mechanic_id=$2":""} ORDER BY s.snapshot_id`,mechanic?[id,user.employeeId]:[id])).rows;
}
export async function inspectionSignalsForVehicles(executor,vehicleIds,user,now) {
 if(!vehicleIds.length) return new Map();
 const mechanic=normalizeRoleName(user?.role)==="mechanic";
 // Mechanic receives evidence only for its assigned item orders, not other work on the vehicle.
 const {rows}=await executor.query(`SELECT v.vehicle_id,
 COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM vehicleinspection i WHERE i.vehicle_id=v.vehicle_id AND i.inspection_type IN ('Pre-Shift','Pre-Trip')
 AND i.inspection_date BETWEEN ($2::timestamptz AT TIME ZONE 'Asia/Manila')::date-29 AND ($2::timestamptz AT TIME ZONE 'Asia/Manila')::date),'[]'::jsonb) inspections,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('maintenance_id',vm.maintenance_id,'status',vm.status,'completed_date',vm.completed_date,'completed_at',vm.completed_at,'source_inspection_id',vm.source_inspection_id,'source_checklist',(SELECT source.checklist FROM vehicleinspection source WHERE source.inspection_id=vm.source_inspection_id),'inspection_items',vm.inspection_items,'inspection_outcomes',vm.inspection_outcomes))
 FROM vehiclemaintenance vm WHERE vm.vehicle_id=v.vehicle_id AND (vm.deleted_at IS NULL OR vm.status='Completed') ${mechanic?"AND vm.assigned_mechanic_id=$3":""}),'[]'::jsonb) orders
 FROM vehicles v WHERE v.vehicle_id=ANY($1::int[])`,mechanic?[vehicleIds,now,user.employeeId]:[vehicleIds,now]);
 return new Map(rows.map(row=>{
  const orders=row.orders.map(order=>({...order,inspection_items:order.inspection_items?.length?order.inspection_items:normalizeInspectionItems([{inspection_id:order.source_inspection_id,checklist:order.source_checklist}])}));
  const signals=recurringInspectionSignals(row.inspections,orders,now);
  return [Number(row.vehicle_id),mechanic?signals.filter(s=>s.active_work_order):signals];
 }));
}
