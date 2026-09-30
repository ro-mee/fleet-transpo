import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@/lib/drivers/media", () => ({
  signDriverMedia: vi.fn(async (row) => row),
  toStoredMediaRef: vi.fn((v) => v),
}));
vi.mock("@/services/status.service", () => ({ syncDriverStatus: vi.fn() }));
vi.mock("@/lib/api/utils", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    requireDriver: vi.fn(async () => ({
      user: { employeeId: 10, role: "driver" },
    })),
  };
});

import { GET } from "./route";
import * as db from "@/lib/db";

describe("GET /api/driver/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    db.query.mockImplementation(async (sql) => {
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
