import { PRE_SHIFT_ITEMS, PRE_TRIP_ITEMS, PRE_TRIP_CARGO_ITEMS } from "@/lib/inspections/checklists";
import { toCalendarDay } from "@/lib/dates";
const KEYS = new Set([...PRE_SHIFT_ITEMS,...PRE_TRIP_ITEMS,...PRE_TRIP_CARGO_ITEMS]);
export const INSPECTION_RULE_VERSION = "recurring-inspection-v1";
const active = row => !row.deleted_at && ["Scheduled","In Progress","Pending Inspection"].includes(row.status);
export function normalizeInspectionItems(inspections = []) {
 const found = new Map();
 for (const inspection of inspections) for (const item of Array.isArray(inspection.checklist) ? inspection.checklist : []) {
  if (item.status !== "FAIL" || !KEYS.has(item.item_id)) continue;
  if (!found.has(item.item_id)) found.set(item.item_id,new Set());
  found.get(item.item_id).add(Number(inspection.inspection_id));
 }
 return [...found].map(([checklist_item_id,ids])=>({checklist_item_id,inspection_ids:[...ids].sort((a,b)=>a-b)})).sort((a,b)=>a.checklist_item_id.localeCompare(b.checklist_item_id));
}
export function mergeInspectionItems(...groups) {
 const byItem = new Map();
 for (const item of groups.flat()) {
  if (!KEYS.has(item.checklist_item_id)) continue;
  const ids=byItem.get(item.checklist_item_id) ?? new Set();
  for (const id of item.inspection_ids) ids.add(Number(id));
  byItem.set(item.checklist_item_id,ids);
 }
 return [...byItem].map(([checklist_item_id,ids])=>({checklist_item_id,inspection_ids:[...ids].sort((a,b)=>a-b)})).sort((a,b)=>a.checklist_item_id.localeCompare(b.checklist_item_id));
}
export function recurringInspectionSignals(inspections = [],orders = [],now = new Date()) {
 const today = new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Manila",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
 const cutoff=new Date(today+"T00:00:00Z"); cutoff.setUTCDate(cutoff.getUTCDate()-29);
 const start=cutoff.toISOString().slice(0,10);
 const rows=inspections.filter(i=>{const day=toCalendarDay(i.inspection_date); return day && day>=start && day<=today;});
 return normalizeInspectionItems(rows).flatMap(item=>{
  const repaired=orders.filter(o=>o.status==="Completed" && o.inspection_outcomes?.some(r=>r.checklist_item_id===item.checklist_item_id && r.outcome==="confirmed"))
   .map(o=>toCalendarDay(o.completed_date ?? o.completed_at)).filter(Boolean).sort().at(-1);
  const dismissed=new Set(orders.filter(o=>o.status==="Completed").flatMap(o=>(o.inspection_outcomes ?? []).filter(r=>r.checklist_item_id===item.checklist_item_id && r.outcome==="not_confirmed").flatMap(r=>r.inspection_ids ?? [])).map(Number));
  const sources=rows.filter(i=>item.inspection_ids.includes(Number(i.inspection_id)) && !dismissed.has(Number(i.inspection_id)) && (!repaired || toCalendarDay(i.inspection_date)>repaired));
  const unique=[...new Map(sources.map(i=>[Number(i.inspection_id),i])).values()].sort((a,b)=>toCalendarDay(a.inspection_date).localeCompare(toCalendarDay(b.inspection_date)) || a.inspection_id-b.inspection_id);
  if(unique.length<2) return [];
  const order=orders.find(o=>active(o) && o.inspection_items?.some(r=>r.checklist_item_id===item.checklist_item_id));
  return [{type:"recurring_inspection",rule_version:INSPECTION_RULE_VERSION,checklist_item_id:item.checklist_item_id,count:unique.length,inspection_ids:unique.map(i=>Number(i.inspection_id)),dates:unique.map(i=>toCalendarDay(i.inspection_date)),sources:unique.map(i=>({inspection_id:Number(i.inspection_id),href:"/maintenance/problems?inspection_id="+i.inspection_id})),review_disposition:order?"work_order_active":"needs_review",active_work_order:order?{maintenance_id:order.maintenance_id,status:order.status}:null}];
 });
}
export function validateInspectionOutcomes(input,items,actorId,now=new Date()) {
 if(!Array.isArray(input) || !input.length || input.length>KEYS.size) throw new Error("Inspection outcomes must be a nonempty list");
 const seen=new Set();
 return input.map(entry=>{
  const item=items.find(i=>i.checklist_item_id===entry?.checklist_item_id);
  if(!item || seen.has(entry.checklist_item_id)) throw new Error("Outcome must name one linked checklist item once");
  seen.add(entry.checklist_item_id);
  if(!["confirmed","not_confirmed","inconclusive"].includes(entry.outcome)) throw new Error("Outcome must be confirmed, not_confirmed or inconclusive");
  if(typeof entry.evidence!=="string" || !entry.evidence.trim() || entry.evidence.length>1000) throw new Error("Outcome evidence is required and must be 1000 characters or fewer");
  return {...item,outcome:entry.outcome,evidence:entry.evidence.trim(),actor_id:actorId,recorded_at:now.toISOString()};
 });
}
export function evaluateServiceOutcome(forecast,completed,crossing=null) {
 const threshold=forecast?.next_service_mileage;
 const reading=completed?.mileage_at_service;
 const earlyMileage=threshold!=null && reading!=null && Number(reading)<Number(threshold);
 const earlyDate=forecast?.next_service_date && completed?.completed_date && toCalendarDay(completed.completed_date)<toCalendarDay(forecast.next_service_date);
 return {evaluation:crossing?"threshold_observed":((threshold==null || earlyMileage) && (!forecast?.next_service_date || earlyDate) && (earlyMileage || earlyDate))?"early_service":"unobserved",prediction_error_days:null};
}
