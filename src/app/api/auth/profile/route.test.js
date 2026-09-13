import { describe, it, expect, vi, afterEach } from "vitest";
import { GET } from "./route";
import * as db from "@/lib/db";
import * as apiUtils from "@/lib/api/utils";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/auth/profile", () => {
  it("returns profile with resolved avatar_url prioritizing face_image_url", async () => {
    vi.spyOn(apiUtils, "requireAuth").mockResolvedValue({
      user: { employeeId: 41 },
    });

    vi.spyOn(db, "query").mockResolvedValue({
      rows: [
        {
          employee_id: 41,
          email: "jack@gmail.com",
          first_name: "Jack",
          last_name: "Mors",
          phone: "09507155059",
          position: "Driver",
          status: "Active",
          avatar_url: "https://example.com/avatar.jpg",
          role_name: "driver",
          driver_id: 21,
          driver_status: "Available",
          face_image_url: "https://example.com/face.jpg",
          license_image_url: null,
        },
      ],
    });

    const res = await GET({});
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.employee_id).toBe(41);
    expect(body.email).toBe("jack@gmail.com");
    expect(body.avatar_url).toBe("https://example.com/face.jpg");
    expect(body.face_image_url).toBe("https://example.com/face.jpg");
    expect(body.driver_status).toBe("Available");
  });

  it("falls back to employee avatar_url when face_image_url is null", async () => {
    vi.spyOn(apiUtils, "requireAuth").mockResolvedValue({
      user: { employeeId: 10 },
    });

    vi.spyOn(db, "query").mockResolvedValue({
      rows: [
        {
          employee_id: 10,
          email: "admin@fleet.com",
          first_name: "Fleet",
          last_name: "Admin",
          phone: "09123456789",
          position: "Fleet Manager",
          status: "Active",
          avatar_url: "https://example.com/admin.jpg",
          role_name: "fleet_manager",
          driver_id: null,
          driver_status: null,
          face_image_url: null,
          license_image_url: null,
        },
      ],
    });

    const res = await GET({});
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.avatar_url).toBe("https://example.com/admin.jpg");
  });

  it("returns 404 when profile record does not exist", async () => {
    vi.spyOn(apiUtils, "requireAuth").mockResolvedValue({
      user: { employeeId: 999 },
    });

    vi.spyOn(db, "query").mockResolvedValue({ rows: [] });

    const res = await GET({});
    expect(res.status).toBe(404);
  });
});
