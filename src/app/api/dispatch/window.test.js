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
vi.mock("@/services/driver-schedule.service", () => ({ loadDriverScheduleContext: vi.fn(async () => ({})) }));
vi.mock("@/lib/ai/pair-scoring", () => ({ isDriverUnavailableFor: vi.fn(() => ({ unavailable: false })) }));
vi.mock("@/lib/uvvrp/uvvrp.service", () => ({ enforceCoding: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/scheduling/conflicts", () => ({ findDispatchConflicts: vi.fn(async () => []) }));
vi.mock("@/services/recommendation.service", () => ({ validatePairAvailability: vi.fn() }));
vi.mock("@/services/dispatch-evidence.service", () => ({ commitDispatchEvidence: vi.fn(async (_token, write) => write({ query })) }));

import { validatePairAvailability } from "@/services/recommendation.service";
import { findDispatchConflicts } from "@/lib/scheduling/conflicts";
import { POST } from "./route";
import { PUT } from "./[id]/route";

const departure = "2026-10-08T02:00:00Z";
const planned = "2026-10-08T03:00:00Z";
const buffered = "2026-10-08T04:30:00.000Z";
const before = { dispatch_id: 10, request_id: 3, vehicle_id: 2, driver_id: 7,
  scheduled_departure: departure, scheduled_arrival: planned, status: "Scheduled" };
const request = (body) => new Request("http://localhost/api/dispatch", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const create = (body) => POST(request({ request_id: 3, vehicle_id: 2, driver_id: 7, scheduled_departure: departure, ...body }));
const edit = (body) => PUT(request(body), { params: Promise.resolve({ id: "10" }) });

beforeEach(() => {
  vi.clearAllMocks();
  findDispatchConflicts.mockResolvedValue([]);
  validatePairAvailability.mockResolvedValue({ ok: true, serviceEnd: buffered, commitToken: {} });
  query.mockImplementation(async (sql, values = []) => {
    if (sql.includes("FROM transportation_requests")) return { rows: [{ request_id: 3, fleet_status: "Pending", load_type: "Cargo", cargo_weight_kg: 650 }] };
    if (sql.includes("FROM vehicles")) return { rows: [{ vehicle_id: 2, vehicle_status: "Available", plate_number: "TEST", registration_expiry: "2028-01-01", insurance_expiry: "2028-01-01" }] };
    if (sql.includes("FROM drivers")) return { rows: [{ driver_id: 7, driver_status: "Available" }] };
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
  it.each([departure, "2026-10-08T01:00:00Z"])("rejects create arrival %s before evaluating a pair", async (arrival) => {
    expect((await create({ scheduled_arrival: arrival })).status).toBe(400);
    expect(validatePairAvailability).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT"))).toBe(false);
  });
  it.each([departure, "2026-10-08T01:00:00Z"])("rejects edit arrival %s before evaluating a pair", async (arrival) => {
    expect((await edit({ scheduled_arrival: arrival })).status).toBe(400);
    expect(validatePairAvailability).not.toHaveBeenCalled();
  });
  it("stores and overlap-checks the accepted buffered window on create", async () => {
    const res = await create({ scheduled_arrival: planned });
    expect(res.status).toBe(201);
    expect((await res.json()).scheduled_arrival).toBe(buffered);
    expect(findDispatchConflicts).toHaveBeenLastCalledWith(expect.objectContaining({ arrival: buffered }));
  });
  it("stores and overlap-checks the accepted buffered window on update", async () => {
    const res = await edit({ scheduled_arrival: planned });
    expect(res.status).toBe(200);
    expect((await res.json()).scheduled_arrival).toBe(buffered);
    expect(findDispatchConflicts).toHaveBeenLastCalledWith(expect.objectContaining({ arrival: buffered }));
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
      ? { rows: [{ vehicle_id: 2, vehicle_status: "Available", plate_number: "TEST", registration_expiry: "2020-01-01", insurance_expiry: "2020-01-01" }] }
      : original(sql, values));
    const res = await call({ scheduled_arrival: planned });
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
