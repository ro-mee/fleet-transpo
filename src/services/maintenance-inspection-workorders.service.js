import { AuthError } from "@/lib/api/utils";
import { normalizeInspectionItems,mergeInspectionItems } from "@/lib/maintenance/inspection-signals";
import { appendMaintenanceSnapshot } from "@/services/maintenance-evidence.service";
// Called under the existing inspection lock. The vehicle lock also serializes different
// inspection IDs for this vehicle; completion already takes vehicle -> work-order.
export async function reuseInspectionItemOrder(tx,inspection,checklistItemId,actorId) {
 const all=normalizeInspectionItems([inspection]);
 if(checklistItemId && !all.some(i=>i.checklist_item_id===checklistItemId)) throw new AuthError("The checklist item is not failed on this inspection",400);
 if(!all.length) return null;
 await tx.query("SELECT vehicle_id FROM vehicles WHERE vehicle_id=$1 FOR UPDATE",[inspection.vehicle_id]);
 const selected=checklistItemId?all.filter(i=>i.checklist_item_id===checklistItemId):all;
 const {rows}=await tx.query(`SELECT vm.*,i.checklist AS source_checklist FROM vehiclemaintenance vm
 LEFT JOIN vehicleinspection i ON i.inspection_id=vm.source_inspection_id
 WHERE vm.vehicle_id=$1 AND vm.deleted_at IS NULL AND vm.status IN ('Scheduled','In Progress','Pending Inspection')
 ORDER BY vm.maintenance_id FOR UPDATE OF vm`,[inspection.vehicle_id]);
 for(const order of rows) {
  const original=order.inspection_items?.length?order.inspection_items:normalizeInspectionItems([{inspection_id:order.source_inspection_id,checklist:order.source_checklist}]);
  if(!selected.some(item=>original.some(i=>i.checklist_item_id===item.checklist_item_id))) continue;
  if(!selected.every(item=>original.some(i=>i.checklist_item_id===item.checklist_item_id))) throw new AuthError("Some failed items already have work. Review one checklist item at a time.",409);
  const merged=mergeInspectionItems(original,selected);
  if(JSON.stringify(merged)!==JSON.stringify(order.inspection_items)) {
   await tx.query("UPDATE vehiclemaintenance SET inspection_items=$1::jsonb WHERE maintenance_id=$2",[JSON.stringify(merged),order.maintenance_id]);
   await appendMaintenanceSnapshot(tx,{event:"inspection_reviewed",order,actorId,inputs:{inspection_items:merged},outcome:{review_disposition:"work_order_active"}});
  }
  return {...order,inspection_items:merged};
 }
 return null;
}
export async function attachOriginalInspectionItems(tx,order,inspection,actorId) {
 const items=normalizeInspectionItems([inspection]);
 if(!items.length) return order;
 // A source-unique generic order represents ALL original failed items, never just
 // the requested item. Only subsequent reports are filtered by requested identity.
 if(!order.inspection_items?.length && ["Scheduled","In Progress","Pending Inspection"].includes(order.status)) {
  await tx.query("UPDATE vehiclemaintenance SET inspection_items=$1::jsonb WHERE maintenance_id=$2",[JSON.stringify(items),order.maintenance_id]);
  await appendMaintenanceSnapshot(tx,{event:"inspection_reviewed",order,actorId,inputs:{inspection_items:items},outcome:{review_disposition:"work_order_active"}});
  return {...order,inspection_items:items};
 }
 return order;
}
