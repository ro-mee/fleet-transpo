import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/api/utils", () => ({
  requireDriver: vi.fn(),
  parseBody: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  err: (message, status) => Response.json({ error: message }, { status }),
  handleError: (e) => Response.json({ error: e.message }, { status: e.status ?? 500 }),
  AuthError: class extends Error {
    constructor(message, status) { super(message); this.status = status; }
  },
}));
vi.mock("@/services/push.service", () => ({ sendPush: vi.fn() }));
vi.mock("@/services/standby.service", () => ({ setDuty: vi.fn() }));
vi.mock("@/lib/notifications/recipients", () => ({ notificationRolesFor: vi.fn(() => ["admin"]) }));

import { query } from "@/lib/db";
import { requireDriver, parseBody } from "@/lib/api/utils";
import { sendPush } from "@/services/push.service";
import { setDuty } from "@/services/standby.service";
import { PRE_SHIFT_ITEMS as FULL_IDS, PRE_TRIP_ITEMS as QUICK_IDS } from "@/lib/inspections/checklists";
import { POST, GET } from "./route";

// The ids are imported rather than hand-copied so the route test cannot drift
// from the module it exercises; their literal values are pinned by Task 1's
// checklists.test.js, which is where the "is this the right set?" assertion
// belongs.
const CID = "abc123def456ghi7"; // 16 chars, matches /^[0-9a-z-]{16,64}$/i

const build = (ids, overrides = {}) =>
  ids.map((item_id) => ({ item_id, label: item_id, status: "PASS", remarks: "", ...overrides[item_id] }));

const baseBody = (extra = {}) => ({
  inspection_type: "Pre-Trip",
  trip_id: 7,
  client_submission_id: CID,
  items: build(QUICK_IDS),
  ...extra,
});

const post = () => POST(new Request("http://localhost/api/mobile/driver/inspections", { method: "POST" }));

function getInsertParams(call) {
  const sql = call[0], values = call[1];
  // The INSERT template breaks the line between the table name and the column
  // list, so the match must tolerate whitespace there, and `[^)]*` keeps the
  // capture inside the parens instead of running on to a later `)`. Written as
  // `/...vehicleinspection \(/` this never matches — `match` returns null and
  // every caller dies on a TypeError instead of letting its assertion fail.
  const cols = sql.match(/INSERT INTO vehicleinspection\s*\(([^)]*)\)/)[1].split(",").map((c) => c.trim());
  return Object.fromEntries(cols.map((c, i) => [c, values[i]]));
}

const defaultQuery = async (sql) => {
  if (sql.includes("t.trip_id = $1")) return { rows: [{ trip_id: 7, vehicle_id: 3, plate_number: "ABC-1234" }] };
  if (sql.includes("FROM driver_vehicle_assignments")) return { rows: [{ vehicle_id: 4, plate_number: "XYZ-987" }] };
  if (sql.includes("trip_status = ANY")) return { rows: [] };
  if (sql.startsWith("INSERT INTO vehicleinspection")) return { rows: [{ inspection_id: 9, trip_id: 7, status: "Passed" }] };
  if (sql.includes("FROM employees")) return { rows: [{ employee_id: 5 }] };
  if (sql.startsWith("INSERT INTO notifications")) return { rows: [] };
  if (sql.includes("SELECT inspection_id, trip_id, inspection_type, status FROM vehicleinspection")) return { rows: [] };
  return { rows: [] };
};

beforeEach(() => {
  vi.clearAllMocks();
  requireDriver.mockResolvedValue({ user: { driverId: 2, employeeId: 1 } });
  query.mockImplementation(defaultQuery);
  setDuty.mockResolvedValue({ checkedIn: true });
});
afterEach(() => vi.clearAllMocks());

const insertCall = () => query.mock.calls.find((c) => c[0].startsWith("INSERT INTO vehicleinspection"));

// The notifications INSERT is (employee_id, title, message, type,
// reference_type, reference_id) — so in a recorded call, values[1] is the TITLE
// and values[2] is the MESSAGE. values[3] is the literal "Alert". Reading [2]
// as the title and [3] as the message is off by one and fails both
// FAIL-notification tests below.
const notifCall = () => query.mock.calls.find((c) => c[0].startsWith("INSERT INTO notifications"));

// Pre-Shift IS Start Duty. There is no separate Start duty toggle in the app, so
// this route is the only path onto duty — and the only thing that turns on
// standby tracking, which is what makes a driver visible on the dispatch radar.
describe("POST — completing Pre-Shift starts duty", () => {
  const preShiftBody = (extra = {}) => ({
    inspection_type: "Pre-Shift",
    client_submission_id: CID,
    items: build(FULL_IDS),
    ...extra,
  });

  it("puts the driver on duty and says so", async () => {
    parseBody.mockResolvedValue(preShiftBody());
    const res = await post();
    expect(res.status).toBe(201);
    expect(setDuty).toHaveBeenCalledWith(2, true);
    expect((await res.json()).duty).toEqual({ started: true, code: null, message: null });
  });

  it("keeps the safety record when duty cannot start, and hands back the reason", async () => {
    // A rest day, approved leave or missing privacy consent blocks duty. None of
    // those may un-record a check the driver already finished, so the inspection
    // must still be 201 and the app must be told why duty did not follow.
    setDuty.mockRejectedValue(Object.assign(new Error("Rest day"), { code: "DUTY_UNAVAILABLE" }));
    parseBody.mockResolvedValue(preShiftBody());
    const res = await post();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.inspection_id).toBe(9);
    expect(body.duty).toEqual({ started: false, code: "DUTY_UNAVAILABLE", message: "Rest day" });
  });

  it("re-attempts duty on a retry, when the first response was lost", async () => {
    // A duplicate submission means the row already exists — and is exactly the
    // case where the first attempt's response never arrived, so duty may not have
    // started. Skipping it here would strand a driver who did the check.
    query.mockImplementation(async (sql) => {
      if (sql.startsWith("INSERT INTO vehicleinspection")) return { rows: [] };
      if (sql.includes("SELECT inspection_id, trip_id, inspection_type, status FROM vehicleinspection")) {
        return { rows: [{ inspection_id: 9, trip_id: null, inspection_type: "Pre-Shift", status: "Passed" }] };
      }
      return defaultQuery(sql);
    });
    parseBody.mockResolvedValue(preShiftBody());
    const res = await post();
    expect(res.status).toBe(200);
    expect(setDuty).toHaveBeenCalledWith(2, true);
  });

  it("does not touch duty for a Pre-Trip check", async () => {
    parseBody.mockResolvedValue(baseBody());
    await post();
    expect(setDuty).not.toHaveBeenCalled();
  });
});

describe("POST /api/mobile/driver/inspections — Pre-Trip", () => {
  it("rejects a missing or unknown inspection_type", async () => {
    parseBody.mockResolvedValue({ ...baseBody(), inspection_type: "Monthly" });
    expect((await post()).status).toBe(400);
    parseBody.mockResolvedValue({ ...baseBody(), inspection_type: undefined });
    expect((await post()).status).toBe(400);
  });
  it("refuses a Post-Shift report here, and says where to file it", async () => {
    // Post-Shift is a known type but not writable on this route: the End Duty
    // report shares one transaction with the duty time_out, so a second write
    // path would let a report exist without the duty having ended.
    parseBody.mockResolvedValue({ ...baseBody(), inspection_type: "Post-Shift" });
    const res = await post();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/ending duty/i);
    expect(query).not.toHaveBeenCalled();
  });
  it("rejects Pre-Trip with null trip_id (regression: Number(null)===0)", async () => {
    parseBody.mockResolvedValue(baseBody({ trip_id: null }));
    const res = await post();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("trip_id is required for a Pre-Trip inspection");
  });
  it("accepts 4 quick items all PASS and inserts type Pre-Trip", async () => {
    parseBody.mockResolvedValue(baseBody());
    const res = await post();
    expect(res.status).toBe(201);
    const params = getInsertParams(insertCall());
    expect(params.inspection_type).toBe("Pre-Trip");
    expect(params.trip_id).toBe(7);
    expect(params.vehicle_id).toBe(3);
    expect(params.status).toBe("Passed");
    expect(params.severity).toBe("None");
    expect(sendPush).not.toHaveBeenCalled();
  });
  it("rejects the legacy 7-item payload for Pre-Trip", async () => {
    parseBody.mockResolvedValue(baseBody({ items: build(FULL_IDS) }));
    const res = await post();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("exactly 4 inspection items are required for Pre-Trip");
  });
  it("requires remarks on FAIL", async () => {
    parseBody.mockResolvedValue(baseBody({
      items: build(QUICK_IDS, { brakes: { status: "FAIL", remarks: "" } }),
    }));
    expect((await post()).status).toBe(400);
  });
  it("FAIL inserts Failed + High severity and notifies dispatch", async () => {
    parseBody.mockResolvedValue(baseBody({
      items: build(QUICK_IDS, { brakes: { status: "FAIL", remarks: "pedal soft" } }),
    }));
    const res = await post();
    expect(res.status).toBe(201);
    const params = getInsertParams(insertCall());
    expect(params.status).toBe("Failed");
    expect(params.severity).toBe("High");
    expect(params.findings).toContain("brakes");
    expect(notifCall()[1][1]).toBe("Failed Pre-Trip Inspection");
    expect(notifCall()[1][2]).toMatch(/ABC-1234 failed the quick pre-trip safety check for Trip #7/);
    expect(notifCall()[1][2]).toMatch(/brakes/);
    expect(sendPush).toHaveBeenCalledWith(expect.objectContaining({ title: "Failed Pre-Trip Inspection" }));
  });
  it("404s a trip the driver does not own", async () => {
    query.mockImplementation(async (sql) =>
      sql.includes("t.trip_id = $1") ? { rows: [] } : defaultQuery(sql));
    parseBody.mockResolvedValue(baseBody());
    expect((await post()).status).toBe(404);
  });
  it("404s (not 400s) a non-owned trip even when the payload is also invalid", async () => {
    // Ownership is answered before payload validity, as it was before this
    // change — answering 400 here would confirm the trip exists to a driver
    // who does not own it.
    query.mockImplementation(async (sql) =>
      sql.includes("t.trip_id = $1") ? { rows: [] } : defaultQuery(sql));
    parseBody.mockResolvedValue(baseBody({ items: build(FULL_IDS) }));
    expect((await post()).status).toBe(404);
  });
  it("400s when the trip has no vehicle assigned", async () => {
    query.mockImplementation(async (sql) =>
      sql.includes("t.trip_id = $1") ? { rows: [{ trip_id: 7, vehicle_id: null }] } : defaultQuery(sql));
    parseBody.mockResolvedValue(baseBody());
    expect((await post()).status).toBe(400);
  });
  it("replayed client_submission_id returns the original row without a second insert or notification", async () => {
    query.mockImplementation(async (sql) => {
      if (sql.includes("t.trip_id = $1")) return { rows: [{ trip_id: 7, vehicle_id: 3, plate_number: "ABC-1234" }] };
      if (sql.startsWith("INSERT INTO vehicleinspection")) return { rows: [] };
      if (sql.includes("SELECT inspection_id, trip_id, inspection_type, status FROM vehicleinspection")) {
        return { rows: [{ inspection_id: 9, trip_id: 7, status: "Failed", inspection_type: "Pre-Trip" }] };
      }
      return { rows: [] };
    });
    parseBody.mockResolvedValue(baseBody({
      items: build(QUICK_IDS, { tires: { status: "FAIL", remarks: "low" } }),
    }));
    const res = await post();
    expect(res.status).toBe(200);
    expect((await res.json()).inspection_id).toBe(9);
    expect(sendPush).not.toHaveBeenCalled();
  });
  it("409s when the submission id was already used for another trip", async () => {
    query.mockImplementation(async (sql) => {
      if (sql.includes("t.trip_id = $1")) return { rows: [{ trip_id: 7, vehicle_id: 3, plate_number: "ABC-1234" }] };
      if (sql.startsWith("INSERT INTO vehicleinspection")) return { rows: [] };
      if (sql.includes("SELECT inspection_id, trip_id, inspection_type, status FROM vehicleinspection")) {
        return { rows: [{ inspection_id: 9, trip_id: 8, status: "Passed", inspection_type: "Pre-Trip" }] };
      }
      return { rows: [] };
    });
    parseBody.mockResolvedValue(baseBody());
    expect((await post()).status).toBe(409);
  });
  it("rejects a malformed client_submission_id", async () => {
    parseBody.mockResolvedValue(baseBody({ client_submission_id: "short" }));
    expect((await post()).status).toBe(400);
  });
});

describe("POST — Pre-Shift", () => {
  const shiftBody = (extra = {}) => baseBody({ inspection_type: "Pre-Shift", trip_id: null, items: build(FULL_IDS), ...extra });

  it("accepts without trip_id and inserts trip_id NULL", async () => {
    parseBody.mockResolvedValue(shiftBody());
    const res = await post();
    expect(res.status).toBe(201);
    const params = getInsertParams(insertCall());
    expect(params.inspection_type).toBe("Pre-Shift");
    expect(params.trip_id).toBeNull();
    expect(params.vehicle_id).toBe(4); // assignment fallback (no live trip)
    expect(params.status).toBe("Passed");
    expect(params.severity).toBe("None");
  });
  it("resolves the vehicle from a live trip when one exists", async () => {
    query.mockImplementation(async (sql) => {
      if (sql.includes("trip_status = ANY")) return { rows: [{ vehicle_id: 3, plate_number: "ABC-1234" }] };
      return defaultQuery(sql);
    });
    parseBody.mockResolvedValue(shiftBody());
    await post();
    expect(getInsertParams(insertCall()).vehicle_id).toBe(3);
  });
  it("rejects trip_id on Pre-Shift", async () => {
    parseBody.mockResolvedValue(shiftBody({ trip_id: 7 }));
    const res = await post();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Pre-Shift inspections must not include trip_id");
  });
  it("rejects the 4-item quick list for Pre-Shift", async () => {
    parseBody.mockResolvedValue(shiftBody({ items: build(QUICK_IDS) }));
    expect((await post()).status).toBe(400);
  });
  it("400s when the driver has no live trip and no assignment", async () => {
    query.mockImplementation(async (sql) =>
      sql.includes("FROM driver_vehicle_assignments") || sql.includes("trip_status = ANY")
        ? { rows: [] } : defaultQuery(sql));
    parseBody.mockResolvedValue(shiftBody());
    const res = await post();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/No vehicle is assigned/);
  });
  it("non-critical FAIL → severity Medium + Failed Pre-Shift Inspection notification", async () => {
    parseBody.mockResolvedValue(shiftBody({
      items: build(FULL_IDS, { cabin: { status: "FAIL", remarks: "spill needs cleaning" } }),
    }));
    const res = await post();
    expect(res.status).toBe(201);
    const params = getInsertParams(insertCall());
    expect(params.status).toBe("Failed");
    expect(params.severity).toBe("Medium");
    expect(notifCall()[1][1]).toBe("Failed Pre-Shift Inspection");
    expect(notifCall()[1][2]).toMatch(/failed the pre-shift inspection/);
    expect(notifCall()[1][2]).toMatch(/cabin/);
    expect(sendPush).toHaveBeenCalledWith(expect.objectContaining({ title: "Failed Pre-Shift Inspection" }));
  });
  it("critical FAIL on Pre-Shift → severity High", async () => {
    parseBody.mockResolvedValue(shiftBody({
      items: build(FULL_IDS, { brakes: { status: "FAIL", remarks: "grinding" } }),
    }));
    await post();
    expect(getInsertParams(insertCall()).severity).toBe("High");
  });
  it("replayed Pre-Shift submission resolves without a false 409 (null trip_id)", async () => {
    query.mockImplementation(async (sql) => {
      if (sql.includes("trip_status = ANY")) return { rows: [] };
      if (sql.includes("FROM driver_vehicle_assignments")) return { rows: [{ vehicle_id: 4, plate_number: "XYZ-987" }] };
      if (sql.startsWith("INSERT INTO vehicleinspection")) return { rows: [] };
      if (sql.includes("SELECT inspection_id, trip_id, inspection_type, status FROM vehicleinspection")) {
        return { rows: [{ inspection_id: 9, trip_id: null, status: "Passed", inspection_type: "Pre-Shift" }] };
      }
      return { rows: [] };
    });
    parseBody.mockResolvedValue(shiftBody());
    const res = await post();
    expect(res.status).toBe(200);
  });
});

describe("GET /api/mobile/driver/inspections", () => {
  const get = (url) => GET(new Request(url));
  it("rejects an unknown inspection_type filter", async () => {
    expect((await get("http://localhost/api/mobile/driver/inspections?inspection_type=Monthly")).status).toBe(400);
  });
  it("passes a valid inspection_type filter into the query", async () => {
    const res = await get("http://localhost/api/mobile/driver/inspections?inspection_type=Pre-Shift");
    expect(res.status).toBe(200);
    const call = query.mock.calls.find((c) => c[0].includes("FROM vehicleinspection"));
    expect(call[1]).toContain("Pre-Shift");
    expect(call[1][0]).toBe(2); // driverId scope stays first
  });
  it("accepts Post-Shift as a filter, so the app can see today's report", async () => {
    // Readable even though it is not writable here — this is how the app knows
    // whether the end-of-shift report is already done.
    const res = await get("http://localhost/api/mobile/driver/inspections?inspection_type=Post-Shift");
    expect(res.status).toBe(200);
    const call = query.mock.calls.find((c) => c[0].includes("FROM vehicleinspection"));
    expect(call[1]).toContain("Post-Shift");
  });

  it("sends NULL — not 0 — for an absent trip_id (regression: Number(null)===0)", async () => {
    // `Number(sp.get("trip_id") ?? null)` is 0 when the param is absent, and 0 is
    // NOT null, so `($2::int IS NULL OR trip_id = $2)` fell through to
    // `trip_id = 0`. That matches nothing, because a Pre-Shift baseline carries
    // trip_id NULL by definition — so every unfiltered call to this route
    // returned zero rows. The write succeeded and the read-back was always
    // empty, which is why a passed Pre-Shift card never cleared on Home.
    const res = await get("http://localhost/api/mobile/driver/inspections?inspection_type=Pre-Shift");
    expect(res.status).toBe(200);
    const call = query.mock.calls.find((c) => c[0].includes("FROM vehicleinspection"));
    expect(call[1][1]).toBeNull();
    expect(call[1][2]).toBe(50); // LIMIT did not shift into the trip_id slot
  });

  it("still passes a real trip_id through as a number", async () => {
    const res = await get("http://localhost/api/mobile/driver/inspections?trip_id=7");
    expect(res.status).toBe(200);
    const call = query.mock.calls.find((c) => c[0].includes("FROM vehicleinspection"));
    expect(call[1][1]).toBe(7);
  });

  it("rejects a non-numeric, zero or negative trip_id", async () => {
    for (const bad of ["abc", "0", "-3"]) {
      const res = await get(`http://localhost/api/mobile/driver/inspections?trip_id=${bad}`);
      expect(res.status, `trip_id=${bad}`).toBe(400);
    }
  });
});
