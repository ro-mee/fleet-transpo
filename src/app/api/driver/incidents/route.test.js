import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route.js";
import * as db from "@/lib/db";
import * as apiUtils from "@/lib/api/utils";
import * as audit from "@/lib/audit";

afterEach(() => vi.restoreAllMocks());

const DRIVER = {
  driver_id: 7,
  first_name: "Sam",
  last_name: "Driver",
  assigned_vehicle_id: null,
};

const SAFE_ANSWERS = {
  immediateDanger: "no",
  vehicleSafety: "safe",
  tripImpact: "delayed",
  hazardToOthers: "no",
};

function request() {
  return { url: "https://fleet.test/api/driver/incidents" };
}

function makePayload(overrides = {}) {
  return {
    incident_type: "other",
    description: "A non-urgent service issue.",
    severity: "Moderate",
    severity_assessment: {
      version: 1,
      answers: SAFE_ANSWERS,
      override_reason_code: null,
      critical_confirmed: false,
      lower_severity_confirmed: false,
    },
    ...overrides,
  };
}

function setup(payload) {
  vi.spyOn(apiUtils, "requireDriver").mockResolvedValue({
    user: { employeeId: 2 },
  });
  vi.spyOn(apiUtils, "parseBody").mockResolvedValue(payload);
  vi.spyOn(audit, "writeAudit").mockResolvedValue();

  const insertCalls = [];
  vi.spyOn(db, "query").mockImplementation(async (sql, params) => {
    if (sql.includes("SELECT d.driver_id, e.first_name")) return { rows: [DRIVER] };
    if (sql.includes("INSERT INTO driverincidents")) {
      insertCalls.push({ sql, params });
      return {
        rows: [{
          incident_id: 101,
          incident_type: payload.incident_type,
          severity: params[9],
          severity_assessment: params[17],
          status: "Open",
          created_at: "2026-10-03T00:00:00.000Z",
          vehicle_id: null,
        }],
      };
    }
    if (sql.includes("SELECT e.employee_id")) return { rows: [] };
    return { rows: [] };
  });
  return { insertCalls };
}

describe("POST /api/driver/incidents severity assessment", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["unknown answer tokens", { answers: { ...SAFE_ANSWERS, immediateDanger: "urgent" } }],
    ["unsupported rule version", { version: 2 }],
  ])("rejects %s before inserting", async (_label, assessmentOverrides) => {
    const payload = makePayload({
      severity_assessment: { ...makePayload().severity_assessment, ...assessmentOverrides },
    });
    const { insertCalls } = setup(payload);

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(insertCalls).toHaveLength(0);
  });

  it("requires Critical confirmation for a guided Critical report", async () => {
    const payload = makePayload({
      severity: "Critical",
      severity_assessment: {
        version: 1,
        answers: { ...SAFE_ANSWERS, immediateDanger: "yes" },
        override_reason_code: null,
        critical_confirmed: false,
        lower_severity_confirmed: false,
      },
    });
    const { insertCalls } = setup(payload);

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(insertCalls).toHaveLength(0);
  });

  it("recomputes the recommendation and persists the coded assessment", async () => {
    const payload = makePayload();
    const { insertCalls } = setup(payload);

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(insertCalls).toHaveLength(1);
    expect(body.severity_assessment).toMatchObject({
      version: 1,
      recommendedSeverity: "Moderate",
      finalSeverity: "Moderate",
      source: "guided",
      reasonCode: "trip_delayed",
    });
    expect(insertCalls[0].sql).toContain("severity_assessment");
  });

  it("keeps the legacy severity-only path", async () => {
    const { insertCalls } = setup(makePayload({
      severity: "Major",
      severity_assessment: undefined,
    }));

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.severity).toBe("Major");
    expect(body.severity_assessment).toBeNull();
    expect(insertCalls[0].params[17]).toBeNull();
  });

  it("keeps SOS direct Critical and records its source", async () => {
    const { insertCalls } = setup({
      incident_type: "Emergency",
      description: "Emergency alert from driver.",
      severity: "Critical",
      severity_source: "sos",
      assistance_needed: ["Medical Assistance"],
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.severity).toBe("Critical");
    expect(body.severity_assessment).toMatchObject({
      source: "sos",
      recommendedSeverity: "Critical",
      finalSeverity: "Critical",
    });
    expect(insertCalls[0].params[17]).toMatchObject({ source: "sos" });
  });
});
