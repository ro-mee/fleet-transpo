import { beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@/lib/db";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/api/utils", () => ({
  requirePermission: vi.fn(async () => ({ user: { employeeId: 1, role: "admin" } })),
  parseBody: (req) => req.json(),
  ok: (body, status = 200) => Response.json(body, { status }),
  err: (error, status = 400) => Response.json({ error }, { status }),
  errValidation: (errors) => Response.json({ errors }, { status: 400 }),
  handleError: (e) => Response.json({ error: e.message }, { status: e.status || 500 }),
}));
vi.mock("@/services/status.service", () => ({ syncVehicleStatus: vi.fn(), syncDriverStatus: vi.fn(), ensureTripForDispatch: vi.fn() }));
vi.mock("@/services/transition.service", () => ({ setDispatchStatus: vi.fn() }));
vi.mock("@/lib/api/ownership", () => ({ assertDispatchOwnership: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/services/push.service", () => ({ flushOutbox: vi.fn() }));
vi.mock("@/services/reservation-lifecycle.service", () => ({ advanceReservation: vi.fn() }));
vi.mock("@/services/driver-schedule.service", () => ({ loadDriverScheduleContext: vi.fn(async () => ({schedules:new Map([[7,new Map(Array.from({length:7},(_,day)=>[day,{shift_start:"00:00",shift_end:"23:59",is_rest_day:false}]))]]),leave:new Map()})) }));
vi.mock("@/lib/ai/pair-scoring", async importOriginal => ({...await importOriginal(), isDriverUnavailableFor: vi.fn(() => ({ unavailable: false })) }));
vi.mock("@/lib/uvvrp/uvvrp.service", () => ({ enforceCoding: vi.fn(async () => ({ ok: true })),getUvvrpPolicy:vi.fn(async()=>({enabled:false})),getExemptVehicleIds:vi.fn(async()=>new Set()) }));
vi.mock("@/lib/scheduling/conflicts", async importOriginal => ({...await importOriginal(),findDispatchConflicts: vi.fn(async () => []) }));
vi.mock("@/services/recommendation.service", async importOriginal => {const actual=await importOriginal();return {...actual,validatePairAvailability:vi.fn(actual.validatePairAvailability)};});
vi.mock("@/services/route-resolver.service",()=>({resolveRequestEstimate:vi.fn(async()=>({durationMin:60,distanceKm:20,source:"Manual"}))}));
vi.mock("@/services/dispatch-evidence.service", () => ({ readDispatchRevision:vi.fn(async()=>"revision"),commitDispatchEvidence: vi.fn(async (_token, write) => write({ query })) }));

import { validatePairAvailability } from "@/services/recommendation.service";
import { findDispatchConflicts } from "@/lib/scheduling/conflicts";
import { POST } from "./route";
import { PUT } from "./[id]/route";

const departure = new Date(Date.now()+2*86400000);departure.setUTCHours(2,0,0,0);
const planned = new Date(+departure+60*60000).toISOString();
const buffered = new Date(+departure+150*60000).toISOString();
const adequate = new Date(+departure+240*60000).toISOString();
const before = { dispatch_id: 10, request_id: 3, vehicle_id: 2, driver_id: 7,
  scheduled_departure: departure.toISOString(), scheduled_arrival: adequate, status: "Scheduled" };
const request = (body) => new Request("http://localhost/api/dispatch", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const create = (body) => POST(request({ request_id: 3, vehicle_id: 2, driver_id: 7, scheduled_departure: departure.toISOString(), ...body }));
const edit = (body) => PUT(request(body), { params: Promise.resolve({ id: "10" }) });

beforeEach(async () => {
  vi.clearAllMocks();
  findDispatchConflicts.mockResolvedValue([]);
  validatePairAvailability.mockReset();
  const {validatePairAvailability:realGate}=await vi.importActual("@/services/recommendation.service");
  validatePairAvailability.mockImplementation(realGate);
  query.mockImplementation(async (sql, values = []) => {
    if (sql.includes("FROM transportation_requests")) return { rows: [{ request_id: 3, fleet_status: "Pending", load_type: "Cargo", cargo_weight_kg: 650,passenger_count:null,cargo_description:"Supplies",requested_category_id:1,pickup_datetime:departure.toISOString(),pickup_location:"Review pickup",dropoff_location:"Review dropoff" }] };
    if (sql.includes("FROM vehicles")) return { rows: [{ vehicle_id: 2, vehicle_status: "Available", plate_number: "TEST", fleet_asset_code:"REVIEW-002",category_id:1,required_license_class:"B",operational_use:"Cargo",cargo_capacity_kg:1000,commissioning_status:"Ready",fuel_level:90,registration_expiry: "2099-01-01", insurance_expiry: "2099-01-01" }] };
    if (sql.includes("FROM drivers")) return { rows: [{ driver_id: 7, driver_status: "Available",license_number:"N04-19-013583",license_type:"Professional",license_class:"B",license_expiry:"2099-01-01",license_verified_at:"2026-01-01T00:00:00Z",license_verified_by:8,license_verification_method:"physical_card",_schedule_load:0 }] };
    if (sql.includes("FROM vehicledocuments")) return {rows:["OR_CR","Insurance"].map(document_type=>({document_type,verification_status:"Verified",verified_by:8,verified_at:"2026-01-01T00:00:00Z",expiry_date:"2099-01-01"}))};
    if (sql.includes("FROM driver_vehicle_assignments")) return {rows:[{assignment_id:1,vehicle_id:2,driver_id:7,assigned_until:null}]};
    if (sql.includes("SELECT * FROM dispatchschedules")) return { rows: [before] };
    if (sql.includes("INSERT INTO dispatchschedules")) {
      const keys = sql.match(/dispatchschedules \(([^)]+)\)/)[1].split(",").map((s) => s.trim());
      return { rows: [{ ...before, ...Object.fromEntries(keys.map((key, i) => [key, values[i]])) }] };
    }
    if (sql.includes("UPDATE dispatchschedules")) {
      const assignments = [...sql.matchAll(/(\w+) = \$(\d+)/g)];
      return { rows: [{ ...before, ...Object.fromEntries(assignments.map((m) => [m[1], values[Number(m[2]) - 1]])) }] };
    }
    return { rows: [] };
  });
});

describe("dispatch window boundary", () => {
  it.each([departure.toISOString(),new Date(+departure-60000).toISOString()])("rejects create arrival %s before evaluating a pair", async (arrival) => {
    expect((await create({ scheduled_arrival: arrival })).status).toBe(400);
    expect(validatePairAvailability).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT"))).toBe(false);
  });
  it.each([departure.toISOString(),new Date(+departure-60000).toISOString()])("rejects edit arrival %s before evaluating a pair", async (arrival) => {
    expect((await edit({ scheduled_arrival: arrival })).status).toBe(400);
    expect(validatePairAvailability).not.toHaveBeenCalled();
  });
  it("stores and overlap-checks the accepted buffered window on create", async () => {
    const res = await create({ scheduled_arrival: null });
    expect(res.status).toBe(201);
    expect((await res.json()).scheduled_arrival).toBe(buffered);
    expect(findDispatchConflicts).toHaveBeenLastCalledWith(expect.objectContaining({ arrival: buffered }));
  });
  it("stores and overlap-checks the accepted buffered window on update", async () => {
    const res = await edit({ scheduled_arrival: null });
    expect(res.status).toBe(200);
    expect((await res.json()).scheduled_arrival).toBe(buffered);
    expect(findDispatchConflicts).toHaveBeenLastCalledWith(expect.objectContaining({ arrival: buffered }));
  });
  it.each([create,edit])("rejects deficient supplied windows through the real shared gate",async call=>{
    const res=await call({scheduled_arrival:planned});
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Cargo service window must cover/);
    expect(query.mock.calls.some(([sql])=>sql.startsWith("INSERT INTO dispatchschedules")||sql.startsWith("UPDATE dispatchschedules"))).toBe(false);
  });
  it.each([create,edit])("preserves an adequate explicit saved window",async call=>{
    const res=await call({scheduled_arrival:adequate});
    expect(res.status).toBe(call===create?201:200);
    expect(new Date((await res.json()).scheduled_arrival).toISOString()).toBe(adequate);
    expect(findDispatchConflicts).toHaveBeenLastCalledWith(expect.objectContaining({arrival:adequate}));
  });
  it.each([create, edit])("returns the unchanged shared load blocker", async (call) => {
    const blocker = "Vehicle TEST cargo capacity 1000 kg, request needs 1800 kg (over by 800 kg).";
    validatePairAvailability.mockResolvedValue({ ok: false, conflict: { message: blocker } });
    const res = await call({ scheduled_arrival: planned });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(blocker);
  });
  it.each([create, edit])("lets the shared typed document gate decide renewed expiry", async (call) => {
    const original = query.getMockImplementation();
    query.mockImplementation((sql, values) => sql.includes("FROM vehicles")
      ? original(sql,values).then(result=>({rows:result.rows.map(row=>({...row,registration_expiry:"2020-01-01",insurance_expiry:"2020-01-01"}))}))
      : original(sql, values));
    const res = await call({ scheduled_arrival: adequate });
    expect(res.status).toBe(call === create ? 201 : 200);
    expect(validatePairAvailability).toHaveBeenCalled();
  });
  it.each([create, edit])("preserves old expiry rejection for an untyped request", async (call) => {
    const original = query.getMockImplementation();
    query.mockImplementation((sql, values) => {
      if (sql.includes("FROM vehicles")) return { rows: [{ vehicle_id: 2, vehicle_status: "Available", plate_number: "TEST", registration_expiry: "2020-01-01" }] };
      if (sql.includes("FROM transportation_requests")) return { rows: [{ request_id: 3, fleet_status: "Pending", load_type: null, passenger_count: 4 }] };
      return original(sql, values);
    });
    expect((await call({ scheduled_arrival: planned })).status).toBe(400);
    expect(validatePairAvailability).not.toHaveBeenCalled();
  });
});
