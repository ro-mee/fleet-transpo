import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ user: null, plans: [], orders: [], queries: [], notifications: [], audit: [], outlook: vi.fn(), fuelNotify: vi.fn(), nextId: 10, snapshots: [], failSnapshot: false, serial: Promise.resolve() }));
vi.mock("@/lib/db", () => ({ query: async sql => sql.includes("FROM employees") ? { rows: [{ employee_id: 9 }] } : { rows: [{ plate_number: "TEST" }] }, withTransaction: run => { const result = h.serial.then(() => run(h.tx)); h.serial = result.catch(() => {}); return result; } }));
vi.mock("@/lib/fuel/maintenance", () => ({ notifyFuelDiagnosticTeam: h.fuelNotify }));
vi.mock("@/services/maintenance-outlook.service", () => ({ getMaintenanceOutlook: h.outlook }));
vi.mock("@/services/status.service", () => ({ syncVehicleStatus: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAuditRequired: async (_tx,_req,_session,entry) => h.audit.push(entry) }));
vi.mock("@/lib/maintenance/notifications", () => ({ fanoutMaintenanceNotification: async entry => h.notifications.push(entry) }));
vi.mock("@/lib/api/utils", async importOriginal => ({ ...await importOriginal(), requirePermission: async () => ({ user: h.user }), parseBody: async req => req.body }));
import { POST } from "./route";
import { PUT } from "./[id]/route";
const body = (plan = 1, version = 3) => ({ vehicle_id: 7, service_plan_id: plan, expected_version: version, maintenance_type: "Routine", maintenance_date: "2026-10-24", assigned_mechanic_id: 9, forecast: { risk: "low" }, service_plan_version: 999 });
const post = data => POST({ body: data });
const put = data => PUT({ body: data }, { params: Promise.resolve({ id: 10 }) });
beforeEach(() => {
 h.snapshots=[]; h.failSnapshot=false; h.user = { role: "fleet_manager", employeeId: 888 }; h.orders = []; h.nextId = 10; h.queries = []; h.notifications = []; h.audit = []; h.serial = Promise.resolve(); h.fuelNotify.mockReset();
 h.plans = [{ plan_id: 1, vehicle_id: 7, version: 3, service_code: "routine", interval_days: 30 }, { plan_id: 2, vehicle_id: 7, version: 1, service_code: "brakes" }];
 h.outlook.mockReset().mockImplementation(async (_user,_now,tx) => { expect(tx).toBe(h.tx); return { predictions: [{ vehicle_id: 7, services: h.plans.map(p => ({ ...p, risk: "overdue", evidence: { validTripCount: 5 } })) }] }; });
 h.tx = { query: async (sql, values = []) => {
  h.queries.push(sql);
  if(sql.includes("INSERT INTO maintenance_forecast_snapshots")) { if(h.failSnapshot) throw new Error("Fixture snapshot failure"); const row={snapshot_id:h.snapshots.length+1,vehicle_id:values[0],maintenance_id:values[2],event:values[4],inputs:JSON.parse(values[5]),forecast:JSON.parse(values[6]),outcome:JSON.parse(values[7])};h.snapshots.push(row);return {rows:[row]}; }
  if(sql.includes("FROM maintenance_forecast_snapshots")) return {rows:h.snapshots.filter(s=>s.maintenance_id===values[0] && s.event===(sql.includes("threshold_observed")?"threshold_observed":"reviewed_schedule")).slice(-1)};

  if (sql.includes("FROM vehicles")) return { rows: [{ vehicle_id: 7 }] };
  if (sql.includes("FROM vehicle_service_plans")) return { rows: h.plans.filter(p => p.vehicle_id === Number(values[0]) && (sql.includes("plan_id=$2") ? p.plan_id === Number(values[1]) : p.service_code === "routine")) };
  if (sql.includes("SELECT status")) return { rows: h.orders.filter(p => p.maintenance_id === Number(values[0])) };
  if (sql.includes("FROM vehiclemaintenance")) return { rows: h.orders.filter(p => p.service_plan_id === Number(values[0]) && !p.deleted_at && ["Scheduled","In Progress","Pending Inspection"].includes(p.status)) };
  if (sql.includes("INSERT INTO vehiclemaintenance")) {
   const columns = sql.match(/vehiclemaintenance \((.*?)\)/)[1].split(",").map(s => s.trim());
   const row = { maintenance_id: h.nextId++, ...Object.fromEntries(columns.map((c,i) => [c,values[i]])) }; h.orders.push(row); return { rows: [row] };
  }
  if (sql.includes("UPDATE vehicle_service_plans SET")) {
   const index = h.plans.findIndex(plan => plan.plan_id === Number(values[5]));
   h.plans[index] = { ...h.plans[index], version: h.plans[index].version + 1, last_service_date: values[0], last_service_mileage: values[1], next_service_date: values[2], next_service_mileage: values[3] };
   return { rows: [h.plans[index]] };
  }
  if (sql.includes("UPDATE vehiclemaintenance")) {
   const row = h.orders.find(r => r.maintenance_id === Number(values.at(-1)));
   for (const match of sql.matchAll(/(\w+) = \$(\d+)/g)) row[match[1]] = values[Number(match[2])-1];
   return { rows: [row] };
  }
  return { rows: [] };
 } };
});
describe("reviewed plan work orders", () => {
 it("captures only the server-reviewed schedule once and completed lifecycle evidence", async () => {
  await post(body()); await post({...body(),forecast:{risk:"invented"}});
  expect(h.snapshots).toHaveLength(1);
  expect(h.snapshots[0]).toMatchObject({event:"reviewed_schedule",forecast:{risk:"overdue",evidence:{validTripCount:5}}});
  expect((await put({status:"Completed",completed_date:"2026-10-01"})).status).toBe(200);
  expect(h.snapshots.map(s=>s.event)).toEqual(["reviewed_schedule","completed"]);
 });
 it("serializes repeated scheduling, returns the active order and notifies only once", async () => {
  const responses = await Promise.all([post(body()),post(body())]);
  expect(responses.map(r => r.status)).toEqual([201,200]);
  const [first,second] = await Promise.all(responses.map(r => r.json()));
  expect(second.maintenance_id).toBe(first.maintenance_id); expect(h.orders).toHaveLength(1); expect(h.notifications).toHaveLength(1); expect(h.audit).toHaveLength(1);
  expect(first.service_plan_version).toBe(3); expect(h.outlook).toHaveBeenCalledTimes(1);
  expect(h.queries.findIndex(q => q.includes("FROM vehicles"))).toBeLessThan(h.queries.findIndex(q => q.includes("FROM vehicle_service_plans")));
 });
 it("does not send a fuel notification when a marked replay recovers an ordinary plan order", async () => {
  const first = await (await post(body())).json();
  h.notifications = [];
  const auditCount = h.audit.length;
  const response = await post({ ...body(), maintenance_type: "Inspection", remarks: "[fuel-diagnostic v1] replay metadata" });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ maintenance_id: first.maintenance_id, maintenance_type: "Routine" });
  expect(h.orders).toHaveLength(1);
  expect(h.fuelNotify).not.toHaveBeenCalled();
  expect(h.notifications).toHaveLength(0);
  expect(h.audit).toHaveLength(auditCount);
 });
 it("allows a new linked cycle after approved completion and requires the incremented plan version", async () => {
  const first = await (await post(body())).json();
  expect((await put({ status: "Completed", completed_date: "2026-10-01" })).status).toBe(200);
  expect(h.orders[0].status).toBe("Completed");
  expect(h.plans[0]).toMatchObject({ version: 4, last_service_date: "2026-10-01", next_service_date: "2026-10-31" });
  expect((await post(body())).status).toBe(409);
  const response = await post(body(1,4));
  expect(response.status).toBe(201);
  const next = await response.json();
  expect(next.maintenance_id).not.toBe(first.maintenance_id);
  expect(next).toMatchObject({ service_plan_id: 1, service_plan_version: 4, status: "Scheduled" });
  expect(h.orders).toHaveLength(2);
 });
 it("allows independent tasks and a new order after cancellation or archive", async () => {
  const first = await (await post(body())).json(); const other = await (await post(body(2,1))).json();
  expect(other.maintenance_id).not.toBe(first.maintenance_id);
  expect((await put({ status: "Cancelled" })).status).toBe(200);
  expect((await post(body())).status).toBe(201);
  h.orders.at(-1).deleted_at = "2026-10-24";
  expect((await post(body())).status).toBe(201);
 });
 it.each([undefined,0,2,"3"])("rejects missing, invalid or stale expected_version %s", async version => {
  const data=body(); data.expected_version=version;
  expect((await post(data)).status).toBe(version===2?409:400); expect(h.orders).toHaveLength(0);
 });
 it("rejects a foreign vehicle-plan pair", async () => { h.plans[0].vehicle_id=8; expect((await post(body())).status).toBe(404); expect(h.orders).toHaveLength(0); });
 it.each(["mechanic","driver"])("denies reviewed creation for %s even if generic permission passes", async role => { h.user.role=role; expect((await post(body())).status).toBe(403); expect(h.orders).toHaveLength(0); });
 it("prevents changing a linked vehicle, task, or stored cycle", async () => {
  await post(body()); h.orders[0].status="In Progress";
  for(const patch of [{vehicle_id:8},{service_plan_id:2},{service_plan_version:4}]) expect((await put(patch)).status).toBe(409);
 });
 it("preserves mechanic approval and separation-of-duties rules for linked work", async () => {
  await post(body()); h.user={role:"mechanic",employeeId:9};
  expect((await put({status:"Completed"})).status).toBe(403);
  h.orders[0].status="Pending Inspection"; h.orders[0].repair_completed_by=888; h.user={role:"fleet_manager",employeeId:888};
  expect((await put({status:"Completed"})).status).toBe(403);
  expect(h.orders[0].status).toBe("Pending Inspection");
 });
 it("fails closed when the current service outlook cannot establish the reviewed cycle", async () => {
  h.outlook.mockResolvedValue({predictions:[]}); expect((await post(body())).status).toBe(409); expect(h.orders).toHaveLength(0); expect(h.notifications).toHaveLength(0);
 });
 it("keeps inspection source orders on their original vehicle",async()=>{
  await post(body());delete h.orders[0].service_plan_id;h.orders[0].source_inspection_id=42;
  expect((await put({vehicle_id:8})).status).toBe(409);
 });
 it("takes vehicle, plan, then work-order locks for edits", async () => {
  await post(body()); h.queries=[]; expect((await put({ remarks:"Reviewed" })).status).toBe(200);
  const locks=h.queries.filter(q => q.includes("FOR UPDATE"));
  expect(locks[0]).toContain("FROM vehicles"); expect(locks[1]).toContain("FROM vehicle_service_plans"); expect(locks[2]).toContain("FROM vehiclemaintenance");
 });
});
