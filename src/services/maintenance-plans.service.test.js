import { describe, it, expect, vi } from "vitest";
import { SERVICE_CODES, validateIntervals, validateOdometerObservation } from "@/lib/maintenance/service-catalog";
import { saveServicePlan, recordOdometerObservation, listServicePlans } from "./maintenance-plans.service";
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
const plan = { plan_id: 4, vehicle_id: 7, service_code: "routine", version: 2, interval_days: 30, interval_km: 5000 };
function executor({ existing = plan, active = false, mileage = 1000 } = {}) {
 return { query: vi.fn(async (sql, values) => {
  if (sql.includes("FROM vehicles")) return { rows: [{ vehicle_id: 7, mileage }] };
  if (sql.includes("FROM vehiclemaintenance")) return { rows: active ? [{ maintenance_id: 9 }] : [] };
  if (sql.includes("SELECT") && sql.includes("vehicle_service_plans")) return { rows: existing ? [existing] : [] };
  if (sql.includes("vehicle_service_plans")) return { rows: [{ ...existing, plan_id: 4, vehicle_id: 7, service_code: "routine", version: 3, interval_days: values[0], interval_km: values[1] }] };
  if (sql.includes("vehicle_odometer_observations")) return { rows: [{ observation_id: 1, reading_km: values[1] }] };
  return { rows: [] };
 }) };
}
describe("service configuration", () => {
 it("offers only the approved independently tracked services", () => expect(SERVICE_CODES).toEqual(["routine", "brakes", "tires"]));
 it.each([-1, 0, 1.5, "bad", true])("rejects invalid interval days %s", interval_days => expect(validateIntervals({ interval_days }).ok).toBe(false));
 it("accepts a positive interval or an explicit manual due threshold", () => {
  expect(validateIntervals({ interval_days: 30, interval_km: null }).ok).toBe(true);
  expect(validateIntervals({ next_service_mileage: 0 }).ok).toBe(true);
  expect(validateIntervals({ interval_days: null, interval_km: -1 }).ok).toBe(false);
  expect(validateIntervals({}).ok).toBe(false);
 });
 it("rejects impossible dates and a deferral without a reason", () => {
  expect(validateIntervals({ next_service_date: "2026-02-30" }).ok).toBe(false);
  expect(validateIntervals({ interval_days: 30, deferred_until: "2026-12-01" }).ok).toBe(false);
 });
 it("rejects stale configuration before writing", async () => {
  const tx=executor(); await expect(saveServicePlan(tx,7,"routine",{ interval_days: 60 },1)).rejects.toMatchObject({status:409});
  expect(tx.query.mock.calls.some(([s])=>s.startsWith("UPDATE"))).toBe(false);
 });
 it("rejects active linked work instead of replacing its cycle", async () => {
  await expect(saveServicePlan(executor({active:true}),7,"routine",{interval_days:60},2)).rejects.toMatchObject({status:409});
 });
 it.each([[0,"routine"],[7,"oil"]])("rejects invalid vehicle/code %s %s", async (id,code) => {
  await expect(saveServicePlan(executor(),id,code,{interval_days:30},0)).rejects.toMatchObject({status:400});
 });
 it("keeps routine legacy columns synchronized using the same connection", async () => {
  const tx=executor(); await saveServicePlan(tx,7,"routine",{interval_days:60},2);
  expect(tx.query.mock.calls.some(([s])=>s.includes("UPDATE vehicles SET service_interval_days"))).toBe(true);
 });
 it("scopes mechanic reads to assigned non-deleted work", async () => {
  const tx=executor(); await listServicePlans({role:"mechanic",employeeId:8},7,tx);
  const call=tx.query.mock.calls[0]; expect(call[0]).toContain("assigned_mechanic_id"); expect(call[1]).toEqual([7,8]);
 });
});
describe("dated manual odometer evidence", () => {
 const observation={reading_km:1001,observed_at:"2026-10-01T12:00:00+08:00",reason:"Fleet check"};
 it.each([-1,2000001,"",null,true])("rejects reading %s", reading_km=>expect(validateOdometerObservation({...observation,reading_km}).ok).toBe(false));
 it("rejects future evidence and missing dated reason",()=>{
  expect(validateOdometerObservation({...observation,observed_at:"2099-01-01T00:00:00Z"}).ok).toBe(false);
  expect(validateOdometerObservation({...observation,reason:""}).ok).toBe(false);
 });
 it("rejects readings below the locked current odometer",async()=>{
  await expect(recordOdometerObservation(executor(),7,{...observation,reading_km:999},8)).rejects.toMatchObject({status:409});
 });
 it("inserts dated evidence and updates the vehicle on the supplied transaction",async()=>{
  const tx=executor(); await recordOdometerObservation(tx,7,observation,8);
  expect(tx.query.mock.calls.some(([s])=>s.includes("INSERT INTO vehicle_odometer_observations"))).toBe(true);
  expect(tx.query.mock.calls.some(([s])=>s.includes("UPDATE vehicles SET mileage"))).toBe(true);
 });
});

it("rejects Routine kilometre intervals that cannot mirror the legacy integer column",async()=>{
 for(const interval_km of [5000.5,2147483648]) await expect(saveServicePlan(executor(),7,"routine",{interval_km},2)).rejects.toMatchObject({status:400});
});
it("rejects values outside the plan numeric storage range",()=>{
 expect(validateIntervals({interval_km:1e20}).ok).toBe(false);
 expect(validateIntervals({next_service_mileage:1e20}).ok).toBe(false);
});
