import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PUT } from "./route";
import * as db from "@/lib/db";
import { AuthError } from "@/lib/api/utils";
import * as utils from "@/lib/api/utils";
import * as statusService from "@/services/status.service";
import * as pushService from "@/services/push.service";
import * as maintenanceScheduleService from "@/services/maintenance-schedule.service";

vi.mock("@/services/status.service", () => ({ syncVehicleStatus: vi.fn() }));
vi.mock("@/services/push.service", () => ({ sendPush: vi.fn() }));
vi.mock("@/services/maintenance-schedule.service", () => ({ recomputeVehicleSchedule: vi.fn() }));

describe("PUT /api/vehicle-maintenance/[id]", () => {
  const maintenanceId = 123;
  let querySpy;
  let identitySpy;
  let mockRecord;

  beforeEach(() => {
    // Mirrors the columns the route's pre-check actually reads. This mock used
    // to carry only status/completed_*, so `beforeRow.created_by` and
    // `beforeRow.inspection_required` both resolved to `undefined` and NEITHER
    // completion guard ever armed — which is how a gate that denied every real
    // user shipped with a green suite.
    mockRecord = {
      maintenance_id: maintenanceId,
      vehicle_id: 1,
      status: "Scheduled",
      created_by: null,
      repair_completed_by: null,
      completed_by: null,
      completed_at: null
    };

    querySpy = vi.spyOn(db, "query").mockImplementation(async (sql) => {
      if (sql.includes("SELECT status FROM vehiclemaintenance")) {
        return { rows: [mockRecord] };
      }
      if (sql.includes("UPDATE vehiclemaintenance")) {
        return { rows: [mockRecord] };
      }
      if (sql.includes("SELECT e.employee_id")) {
        return { rows: [{ employee_id: 999 }] };
      }
      if (sql.includes("SELECT plate_number FROM vehicles")) {
        return { rows: [{ plate_number: "ABC-123" }] };
      }
      if (sql.includes("INSERT INTO notifications")) {
        return { rows: [] };
      }
      return { rows: [] };
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function mockRequest(body, role = "fleet_manager", employeeId = 888) {
    // Real requirePermission sessions carry a FLAT `role` string (see
    // resolveCurrentIdentity in lib/api/utils.js) — no `roles` object. An
    // earlier version of this mock supplied `roles: { role_name }`, which made
    // hasRole pass here while production denied every role, including admin.
    identitySpy = vi.spyOn(utils, "requirePermission").mockResolvedValue({
      user: { role, employeeId },
    });
    return { json: async () => body };
  }

  it("Test 1: Scheduled → In Progress (completed_by remains NULL)", async () => {
    mockRecord.status = "Scheduled"; // Before status
    
    // Setup the mock to return the updated status
    const updateSpy = vi.spyOn(db, "query").mockImplementation(async (sql) => {
      if (sql.includes("SELECT status")) return { rows: [{ status: "Scheduled" }] };
      if (sql.includes("UPDATE")) return { rows: [{ ...mockRecord, status: "In Progress" }] };
      return { rows: [] };
    });

    const req = mockRequest({ status: "In Progress" });
    const res = await PUT(req, { params: Promise.resolve({ id: maintenanceId }) });
    const json = await res.json();
    
    expect(res.status).toBe(200);
    expect(json.status).toBe("In Progress");
    expect(json.completed_by).toBeFalsy();
    
    // Verify query was called but without completed_by
    const updateCall = updateSpy.mock.calls.find(c => c[0].includes("UPDATE"));
    expect(updateCall[0]).not.toContain("completed_by");
  });

  it("Test 2 & 3: Scheduled/In Progress → Completed (sets completed_by and completed_at)", async () => {
    mockRecord.status = "In Progress"; 
    
    const updateSpy = vi.spyOn(db, "query").mockImplementation(async (sql, values) => {
      if (sql.includes("SELECT status")) return { rows: [{ status: "In Progress" }] };
      // Server stamps completed_by from the session; the record id travels
      // last in values, so don't read it off values[values.length - 1].
      if (sql.includes("UPDATE")) return { rows: [{ ...mockRecord, status: "Completed", completed_by: 777 }] };
      return { rows: [] };
    });

    const req = mockRequest({ status: "Completed", cost: 100 }, "fleet_manager", 777);
    const res = await PUT(req, { params: Promise.resolve({ id: maintenanceId }) });
    const json = await res.json();
    
    expect(res.status).toBe(200);
    expect(json.status).toBe("Completed");
    expect(json.completed_by).toBe(777);

    const updateCall = updateSpy.mock.calls.find(c => c[0].includes("UPDATE"));
    expect(updateCall[0]).toContain("completed_by = $");
    expect(updateCall[0]).toContain("completed_at = CURRENT_TIMESTAMP");
  });

  it("Test 4 & 5: Completed → Scheduled/In Progress (BLOCKED)", async () => {
    mockRecord.status = "Completed"; 
    
    const updateSpy = vi.spyOn(db, "query").mockImplementation(async (sql) => {
      if (sql.includes("SELECT status")) return { rows: [{ status: "Completed" }] };
      return { rows: [] }; // UPDATE should not be called
    });

    let req = mockRequest({ status: "Scheduled" });
    let res = await PUT(req, { params: Promise.resolve({ id: maintenanceId }) });
    expect(res.status).toBe(409);
    
    req = mockRequest({ status: "In Progress" });
    res = await PUT(req, { params: Promise.resolve({ id: maintenanceId }) });
    expect(res.status).toBe(409);
    
    const updateCall = updateSpy.mock.calls.find(c => c[0].includes("UPDATE"));
    expect(updateCall).toBeUndefined(); // Ensure UPDATE was never executed
  });

  it("Test 6: Completed → Completed (TERMINAL)", async () => {
    mockRecord.status = "Completed"; 
    mockRecord.completed_by = 123;
    
    const updateSpy = vi.spyOn(db, "query").mockImplementation(async (sql) => {
      if (sql.includes("SELECT status")) return { rows: [{ status: "Completed" }] };
      if (sql.includes("UPDATE")) return { rows: [mockRecord] };
      return { rows: [] };
    });

    const req = mockRequest({ status: "Completed", cost: 500 }, "fleet_manager", 888);
    const res = await PUT(req, { params: Promise.resolve({ id: maintenanceId }) });
    expect(res.status).toBe(200);
    
    const updateCall = updateSpy.mock.calls.find(c => c[0].includes("UPDATE"));
    // Ensure it didn't inject completed_by
    expect(updateCall[0]).not.toContain("completed_by = $");
  });

  it("Test 7: Client Spoofing", async () => {
    mockRecord.status = "Scheduled"; 
    
    const updateSpy = vi.spyOn(db, "query").mockImplementation(async (sql, values) => {
      if (sql.includes("SELECT status")) return { rows: [{ status: "Scheduled" }] };
      // Same note as Test 2 & 3: completed_by comes from the session (555),
      // not from the last values entry (the record id).
      if (sql.includes("UPDATE")) return { rows: [{ ...mockRecord, status: "Completed", completed_by: 555 }] };
      return { rows: [] };
    });

    const req = mockRequest({ 
      status: "Completed", 
      completed_by: 99999, // Fake
      completed_at: "2020-01-01T00:00:00Z" // Fake
    }, "fleet_manager", 555);
    
    const res = await PUT(req, { params: Promise.resolve({ id: maintenanceId }) });
    const json = await res.json();
    
    expect(res.status).toBe(200);
    expect(json.status).toBe("Completed");
    expect(json.completed_by).toBe(555); // Overridden by server auth

    const updateCall = updateSpy.mock.calls.find(c => c[0].includes("UPDATE"));
    expect(updateCall[0]).toContain("completed_by = $");
    // The fake completed_by is stripped because it's not in FIELD_TO_COLUMN.
    // Ensure the query uses session employeeId
    expect(updateCall[1]).toContain(555); 
    expect(updateCall[1]).not.toContain(99999);
  });

  it("Test 9: pre-check SELECT uses only [id] (no untyped $1 params)", async () => {
    const selectSpy = vi.spyOn(db, "query").mockImplementation(async (sql, values) => {
      if (sql.includes("SELECT status")) return { rows: [{ status: "In Progress" }] };
      if (sql.includes("UPDATE")) return { rows: [{ ...mockRecord, status: "Completed" }] };
      return { rows: [] };
    });

    // Multi-field body like the real Edit dialog sends on Complete: before the
    // fix, the SELECT carried all SET values and Postgres rejected the parse
    // with "could not determine data type of parameter $1" (500 on every PUT).
    // This body used to also carry `inspection_required: false` — a field the
    // real UI never sent, and the only reason the assertion below passed while
    // production rejected every completion.
    const req = mockRequest(
      { status: "Completed", cost: 1500, mileage_at_service: 45000 },
      "fleet_manager",
      777
    );
    const res = await PUT(req, { params: Promise.resolve({ id: maintenanceId }) });
    expect(res.status).toBe(200);

    const selectCall = selectSpy.mock.calls.find((c) => c[0].includes("SELECT status"));
    expect(selectCall).toBeDefined();
    expect(selectCall[1]).toEqual([maintenanceId]);

    const updateCall = selectSpy.mock.calls.find((c) => c[0].includes("UPDATE"));
    expect(updateCall).toBeDefined();
    // id goes last so every $n lines up with values[n-1]
    expect(updateCall[1][updateCall[1].length - 1]).toBe(maintenanceId);
    expect(updateCall[0]).toContain(`$${updateCall[1].length}`);
  });

  it("Test 10: flat-role driver session is denied by the completion guard", async () => {
    // requirePermission resolves here (matrix bypassed by the mock) so the
    // hasRole guard itself must reject. Before the hasRole fix this shape —
    // the real production shape — denied EVERYONE, including admin.
    vi.spyOn(db, "query").mockImplementation(async (sql) => {
      if (sql.includes("SELECT status")) return { rows: [{ status: "In Progress" }] };
      return { rows: [] };
    });

    const req = mockRequest({ status: "Completed" }, "driver", 123);
    const res = await PUT(req, { params: Promise.resolve({ id: maintenanceId }) });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Only a Fleet Manager or Admin");
  });

  it("Test 8: Unauthorized User", async () => {
    const req = mockRequest({ status: "Completed" }, "driver", 123);

    vi.spyOn(utils, "requirePermission").mockRejectedValue(new AuthError("Unauthorized", 403));
    const res = await PUT(req, { params: Promise.resolve({ id: maintenanceId }) });
    expect(res.status).toBe(403);
  });

  it("Test 11: separation of duties blocks the repairer, never the ticket's creator", async () => {
    // The repairer is whoever declared the work finished ('Pending Inspection'),
    // which migration 113 records in repair_completed_by. created_by is the
    // ticket's provenance and is deliberately not a fallback: on an
    // incident-sourced work order it names the staff member who resolved the
    // incident, and treating them as the mechanic is what made the old guard
    // deny the admin account its own queue of work orders.
    const updateSpy = vi.spyOn(db, "query").mockImplementation(async (sql) => {
      if (sql.includes("SELECT status")) {
        return { rows: [{ status: "Pending Inspection", created_by: 48, repair_completed_by: 42 }] };
      }
      if (sql.includes("UPDATE")) return { rows: [{ ...mockRecord, status: "Completed" }] };
      return { rows: [] };
    });

    // 42 performed the repair and tries to approve it → blocked, no UPDATE.
    const blocked = await PUT(
      mockRequest({ status: "Completed" }, "fleet_manager", 42),
      { params: Promise.resolve({ id: maintenanceId }) }
    );
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error).toContain("cannot approve its completion");
    expect(updateSpy.mock.calls.find((c) => c[0].includes("UPDATE"))).toBeUndefined();

    // 6 repaired nothing and opened nothing → allowed.
    const allowed = await PUT(
      mockRequest({ status: "Completed" }, "fleet_manager", 6),
      { params: Promise.resolve({ id: maintenanceId }) }
    );
    expect(allowed.status).toBe(200);

    // 48 opened this work order by resolving an incident but did not repair it →
    // allowed. This is the exact case the created_by guard denied in production.
    const resolver = await PUT(
      mockRequest({ status: "Completed" }, "admin", 48),
      { params: Promise.resolve({ id: maintenanceId }) }
    );
    expect(resolver.status).toBe(200);
  });

  it("Test 12: a record with no repairer on file is not blocked", async () => {
    // Every row predating migration 113 has repair_completed_by NULL, as does any
    // record that skipped 'Pending Inspection'. There is no evidence of who did
    // the work, so the guard must not fire — this is what unblocks the incident
    // work orders that had been stuck since 2026-09-04.
    vi.spyOn(db, "query").mockImplementation(async (sql) => {
      if (sql.includes("SELECT status")) {
        return { rows: [{ status: "In Progress", created_by: 48, repair_completed_by: null }] };
      }
      return { rows: [{ ...mockRecord, status: "Completed" }] };
    });

    const req = mockRequest({ status: "Completed" }, "admin", 48);
    const res = await PUT(req, { params: Promise.resolve({ id: maintenanceId }) });
    expect(res.status).toBe(200);
  });

  it("Test 13: 'Pending Inspection' records who finished the repair", async () => {
    const updateSpy = vi.spyOn(db, "query").mockImplementation(async (sql) => {
      if (sql.includes("SELECT status")) {
        return { rows: [{ status: "In Progress", repair_completed_by: null }] };
      }
      if (sql.includes("UPDATE")) return { rows: [{ ...mockRecord, status: "Pending Inspection" }] };
      return { rows: [] };
    });

    const req = mockRequest({ status: "Pending Inspection" }, "fleet_manager", 42);
    const res = await PUT(req, { params: Promise.resolve({ id: maintenanceId }) });
    expect(res.status).toBe(200);

    const updateCall = updateSpy.mock.calls.find((c) => c[0].includes("UPDATE"));
    expect(updateCall[0]).toContain("repair_completed_by = $");
    expect(updateCall[0]).toContain("repair_completed_at = CURRENT_TIMESTAMP");
    expect(updateCall[1]).toContain(42);
  });

  it("Test 14: inspection fields are no longer writable (gate removed)", async () => {
    // The gate was removed because no UI, service, or endpoint in the app could
    // ever write inspection_completed_at, so it blocked every user. The fields
    // must leave the allowlist too, or a client could still send them and leave
    // a row looking inspected after the requirement was dropped.
    const updateSpy = vi.spyOn(db, "query").mockImplementation(async (sql) => {
      if (sql.includes("SELECT status")) {
        return { rows: [{ status: "In Progress", repair_completed_by: null }] };
      }
      if (sql.includes("UPDATE")) return { rows: [{ ...mockRecord, status: "Completed" }] };
      return { rows: [] };
    });

    const req = mockRequest(
      {
        status: "Completed",
        inspection_required: true,
        inspection_completed_at: "2026-09-16T00:00:00Z",
        inspection_notes: "looks fine",
      },
      "fleet_manager",
      6
    );
    const res = await PUT(req, { params: Promise.resolve({ id: maintenanceId }) });
    expect(res.status).toBe(200);

    const updateCall = updateSpy.mock.calls.find((c) => c[0].includes("UPDATE"));
    expect(updateCall[0]).not.toContain("inspection_required");
    expect(updateCall[0]).not.toContain("inspection_completed_at");
    expect(updateCall[0]).not.toContain("inspection_notes");
    expect(updateCall[0]).not.toContain("inspected_by");
  });
});
