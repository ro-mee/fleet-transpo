import { beforeEach, describe, expect, it, vi } from "vitest";

// Merged 2026-10-01: main tested PATCH (self-service audit) and
// feature/driver-info-edit-sync tested GET (personal details). Both suites
// live here now against one hoisted mock registry so the two vi.mock("@/lib/db")
// factories do not shadow each other.
const mocks = vi.hoisted(() => ({
  query: vi.fn(async () => ({ rows: [] })),
  transaction: vi.fn(),
  withTransaction: vi.fn(),
  requireDriver: vi.fn(),
  writeAuditRequired: vi.fn(async () => ({ log_id: 1 })),
  signDriverMedia: vi.fn(async (row) => row),
  toStoredMediaRef: vi.fn((v) => v),
  syncDriverStatus: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  query: mocks.query,
  transaction: mocks.transaction,
  withTransaction: mocks.withTransaction,
}));
vi.mock("@/lib/api/utils", async () => {
  const actual = await vi.importActual("@/lib/api/utils");
  return { ...actual, requireDriver: mocks.requireDriver };
});
vi.mock("@/lib/audit", () => ({ writeAuditRequired: mocks.writeAuditRequired }));
vi.mock("@/lib/drivers/media", () => ({
  signDriverMedia: mocks.signDriverMedia,
  toStoredMediaRef: mocks.toStoredMediaRef,
}));
vi.mock("@/services/status.service", () => ({ syncDriverStatus: mocks.syncDriverStatus }));

import { GET, PATCH } from "./route";

describe("PATCH /api/driver/me", () => {
  let tx;
  let committed;
  let rolledBack;

  function request(body) {
    return new Request("https://fleet.test/api/driver/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireDriver.mockResolvedValue({ user: { employeeId: 8, driverId: 4 } });
    committed = false;
    rolledBack = false;
    tx = {
      query: vi.fn(async (sql) => {
        if (sql.includes("SELECT d.driver_id")) return { rows: [{ driver_id: 4, employee_id: 3 }] };
        return { rows: [] };
      }),
    };
    mocks.withTransaction.mockImplementation(async (callback) => {
      try {
        const result = await callback(tx);
        committed = true;
        return result;
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    });
  });

  it("records changed profile fields without storing their values", async () => {
    const req = request({ phone: "09171234567" });
    const response = await PATCH(req);

    expect(response.status).toBe(200);
    expect(committed).toBe(true);
    expect(mocks.writeAuditRequired).toHaveBeenCalledWith(tx, req, expect.anything(), expect.objectContaining({
      action: "driver_self_profile_updated",
      resource: "drivers",
      resourceId: 4,
      newValues: expect.objectContaining({ changed_fields: ["phone"], channel: "self_service" }),
    }));
    expect(JSON.stringify(mocks.writeAuditRequired.mock.calls)).not.toContain("09171234567");
  });

  it("rolls back a self-service profile update when audit storage fails", async () => {
    mocks.writeAuditRequired.mockRejectedValueOnce(new Error("audit unavailable"));

    const response = await PATCH(request({ phone: "09171234567" }));

    expect(response.status).toBe(500);
    expect(rolledBack).toBe(true);
    expect(committed).toBe(false);
  });
});

describe("GET /api/driver/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireDriver.mockResolvedValue({ user: { employeeId: 10, role: "driver" } });
  });

  it("returns full personal details including address and emergency contact", async () => {
    const mockDriver = {
      employee_id: 10,
      email: "driver@fleetops.ph",
      first_name: "Threestan",
      last_name: "Bingona",
      phone: "09560344827",
      avatar_url: null,
      position: "Driver",
      driver_id: 59,
      driver_status: "Available",
      license_number: "A01-23-424229",
      license_type: "Professional",
      license_class: "B",
      license_expiry: "2029-09-25",
      years_of_experience: 4,
      face_image_url: null,
      license_image_url: null,
      license_back_image_url: null,
      address: "29 Ninang Virginia, Caloocan",
      sex: "M",
      birthdate: "2005-01-03",
      nationality: "FILIPINO",
      emergency_contact_name: "Maricel Bingona",
      emergency_contact_phone: "09245631640",
      emergency_contact_address: "Caloocan",
    };

    mocks.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes("FROM employees e")) {
        return { rows: [mockDriver] };
      }
      if (text.includes("driver_stats")) {
        return { rows: [{ total_trips: 5, total_distance: 120, total_hours: 10, rating: 4.8, performance_score: 4.5 }] };
      }
      if (text.includes("FROM trips t")) {
        return { rows: [] };
      }
      if (text.includes("FROM driverattendance")) {
        return { rows: [] };
      }
      if (text.includes("FROM vehicleassignments") || text.includes("FROM driver_vehicle_assignments")) {
        return { rows: [] };
      }
      if (text.includes("FROM policy_consents") || text.includes("FROM driver_consents")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const req = {
      url: "http://localhost/api/driver/me",
      headers: new Headers(),
    };

    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.address).toBe("29 Ninang Virginia, Caloocan");
    expect(body.data.emergencyContact.name).toBe("Maricel Bingona");
    expect(body.data.emergencyContact.phone).toBe("09245631640");
    expect(body.data.emergencyContact.address).toBe("Caloocan");
    expect(body.data.birthdate).toBe("2005-01-03");
    expect(body.data.sex).toBe("M");
    expect(body.data.nationality).toBe("FILIPINO");
    expect(body.data.position).toBe("Driver");
    expect(body.address).toBe("29 Ninang Virginia, Caloocan");
    expect(body.emergencyContact.name).toBe("Maricel Bingona");
    expect(body.emergencyContact.phone).toBe("09245631640");
    expect(body.emergencyContact.address).toBe("Caloocan");
    expect(body.birthdate).toBe("2005-01-03");
    expect(body.sex).toBe("M");
    expect(body.nationality).toBe("FILIPINO");
    expect(body.position).toBe("Driver");
  });
});
