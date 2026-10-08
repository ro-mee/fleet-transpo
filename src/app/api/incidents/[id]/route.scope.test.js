import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { GET } from "./route";
import * as db from "@/lib/db";
import * as utils from "@/lib/api/utils";

vi.mock("@/lib/driver/incident-storage", () => ({
  getIncidentPhotoUrls: async () => [],
}));

const INCIDENT_ROW = {
  incident_id: 9,
  is_confidential: false,
  reporter_employee_id: 50,
  status: "Resolved",
  responder_driver_id: null,
  response_status: null,
  driver_id: 7,
  photo_urls: null,
  driver_latitude: null,
  latitude: null,
};

function mockSession(role, employeeId) {
  vi.spyOn(utils, "requirePermission").mockResolvedValue({
    user: { role, employeeId },
  });
}

function mockQueries({ owned }) {
  vi.spyOn(db, "query").mockImplementation(async (sql, params) => {
    if (sql.includes("SELECT 1 FROM vehiclemaintenance")) {
      return { rows: owned ? [{ "?column?": 1 }] : [] };
    }
    if (sql.includes("FROM driverincidents i")) {
      return { rows: [{ ...INCIDENT_ROW }] };
    }
    return { rows: [] };
  });
}

const props = { params: Promise.resolve({ id: "9" }) };
const req = () => new Request("http://test/api/incidents/9");

describe("GET /api/incidents/[id] mechanic ownership (G1)", () => {
  beforeEach(() => {
    mockQueries({ owned: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mechanic with an assigned linked WO reads the incident", async () => {
    mockSession("mechanic", 135);
    const res = await GET(req(), props);
    expect(res.status).toBe(200);
  });

  it("mechanic without an assigned linked WO gets 403", async () => {
    mockQueries({ owned: false });
    mockSession("mechanic", 999);
    const res = await GET(req(), props);
    expect(res.status).toBe(403);
  });

  it("staff reads without an ownership check", async () => {
    mockSession("fleet_manager", 20);
    const res = await GET(req(), props);
    expect(res.status).toBe(200);
    const ownershipCalls = db.query.mock.calls.filter(([sql]) =>
      sql.includes("SELECT 1 FROM vehiclemaintenance")
    );
    expect(ownershipCalls).toHaveLength(0);
  });
});
