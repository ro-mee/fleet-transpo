import { describe, expect, it } from "vitest";
import { recurringInspectionSignals, normalizeInspectionItems, validateInspectionOutcomes, evaluateServiceOutcome } from "./inspection-signals";
const now = new Date("2026-10-24T04:00:00Z");
const inspection = (id, date, item = "brakes_tires") => ({ inspection_id:id, inspection_date:date, checklist:[{item_id:item,status:"FAIL",remarks:"Driver observation"}] });
describe("recurring inspection evidence", () => {
 it("counts distinct inspections by canonical key in a 30 Manila-calendar-day window without splitting brakes/tires", () => {
  const rows=[inspection(1,"2026-10-01"),inspection(2,"2026-10-24"),inspection(2,"2026-10-24"),inspection(3,"2026-09-23"),inspection(4,"2026-10-20","brakes")];
  expect(recurringInspectionSignals(rows,[],now)).toEqual([expect.objectContaining({type:"recurring_inspection",checklist_item_id:"brakes_tires",count:2,inspection_ids:[1,2],dates:["2026-10-01","2026-10-24"],review_disposition:"needs_review"})]);
 });
 it("excludes only explicitly confirmed item repairs, leaving unrelated and generic completed repairs alone", () => {
  const rows=[inspection(1,"2026-10-01"),inspection(2,"2026-10-24")];
  const orders=[{status:"Completed",completed_at:"2026-10-10T04:00:00Z",inspection_outcomes:[{checklist_item_id:"lights",outcome:"confirmed"}]},{status:"Completed",completed_at:"2026-10-15T04:00:00Z",inspection_outcomes:[]}];
  expect(recurringInspectionSignals(rows,orders,now)).toHaveLength(1);
  orders.push({status:"Completed",completed_at:"2026-10-10T04:00:00Z",inspection_outcomes:[{checklist_item_id:"brakes_tires",outcome:"confirmed"}]});
  expect(recurringInspectionSignals(rows,orders,now)).toEqual([]);
  orders.at(-1).deleted_at="2026-10-23";
  expect(recurringInspectionSignals(rows,orders,now)).toEqual([]);
 });
 it("dismisses only explicitly reviewed not-confirmed sources after approval while inconclusive remains unresolved", () => {
  const rows=[inspection(1,"2026-10-01"),inspection(2,"2026-10-10"),inspection(3,"2026-10-20"),inspection(4,"2026-10-24")];
  const order={status:"Completed",completed_at:"2026-10-15T04:00:00Z",inspection_outcomes:[{checklist_item_id:"brakes_tires",inspection_ids:[1,2],outcome:"not_confirmed"}]};
  expect(recurringInspectionSignals(rows,[order],now)[0].inspection_ids).toEqual([3,4]);
  order.inspection_outcomes[0].outcome="inconclusive";
  expect(recurringInspectionSignals(rows,[order],now)[0].inspection_ids).toEqual([1,2,3,4]);
 });
 it("retains per-item original inspection identities and active review disposition", () => {
  const rows=[inspection(1,"2026-10-01"),inspection(2,"2026-10-24")];
  expect(normalizeInspectionItems([...rows,{...inspection(3,"2026-10-20","lights")}])).toEqual([{checklist_item_id:"brakes_tires",inspection_ids:[1,2]},{checklist_item_id:"lights",inspection_ids:[3]}]);
  expect(recurringInspectionSignals(rows,[{maintenance_id:9,status:"In Progress",inspection_items:[{checklist_item_id:"brakes_tires",inspection_ids:[1]}]}],now)[0]).toMatchObject({review_disposition:"work_order_active",active_work_order:{maintenance_id:9,status:"In Progress"}});
 });
 it("requires a linked canonical item and nonblank evidence and injects actor/time", () => {
  const items=[{checklist_item_id:"brakes_tires",inspection_ids:[1,2]}];
  expect(()=>validateInspectionOutcomes([{checklist_item_id:"lights",outcome:"confirmed",evidence:"fixed"}],items,8,now)).toThrow(/linked/);
  expect(()=>validateInspectionOutcomes([{checklist_item_id:"brakes_tires",outcome:"confirmed",evidence:" "}],items,8,now)).toThrow(/evidence/);
  expect(validateInspectionOutcomes([{checklist_item_id:"brakes_tires",outcome:"not_confirmed",evidence:"Inspection did not reproduce the noise",actor_id:99}],items,8,now)).toEqual([{checklist_item_id:"brakes_tires",inspection_ids:[1,2],outcome:"not_confirmed",evidence:"Inspection did not reproduce the noise",actor_id:8,recorded_at:now.toISOString()}]);
 });
 it("keeps early service out of prediction error and absent crossings unobserved", () => {
  const forecast={next_service_mileage:1000};
  expect(evaluateServiceOutcome(forecast,{mileage_at_service:900})).toEqual({evaluation:"early_service",prediction_error_days:null});
  expect(evaluateServiceOutcome({...forecast,next_service_date:"2026-10-01"},{mileage_at_service:900,completed_date:"2026-10-24"}).evaluation).toBe("unobserved");
  expect(evaluateServiceOutcome(forecast,{mileage_at_service:1100})).toEqual({evaluation:"unobserved",prediction_error_days:null});
  expect(recurringInspectionSignals([],[],now)).toEqual([]);
 });
});
