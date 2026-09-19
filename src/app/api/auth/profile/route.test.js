// GET /api/auth/profile — the response shape the app chrome reads its avatar
// from.
//
// REWRITTEN 2026-09-18 (SEC-UPLOAD-006): the media columns no longer hold URLs.
// They hold object KEYS, and a key is not renderable, so this route signs them
// for the response. The fixtures below changed from `https://example.com/…` to
// stored keys because that is now what the column contains — the assertions did
// not get weaker, they got stronger: they now prove the value was signed rather
// than merely echoed.
import { describe, it, expect, vi, afterEach } from "vitest";
import { GET } from "./route";
import * as db from "@/lib/db";
import * as apiUtils from "@/lib/api/utils";
import * as admin from "@/lib/supabase/admin";

// The reader's allow-list is built from env on first use, and a bogus host here
// would make every signed value in this file unresolvable.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://proj.supabase.co";

/** Record every sign request and answer with a recognisable URL. */
function mockStorage() {
  const signed = [];
  const from = vi.fn((bucket) => ({
    createSignedUrl: vi.fn(async (key, ttl) => {
      signed.push({ bucket, key, ttl });
      return {
        data: { signedUrl: `https://proj.supabase.co/storage/v1/object/sign/${bucket}/${key}?token=t` },
        error: null,
      };
    }),
  }));
  vi.spyOn(admin, "createAdminClient").mockReturnValue({ storage: { from } });
  return signed;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/auth/profile", () => {
  it("returns profile with resolved avatar_url prioritizing face_image_url", async () => {
    vi.spyOn(apiUtils, "requireAuth").mockResolvedValue({
      user: { employeeId: 41 },
    });
    const signed = mockStorage();

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
          avatar_url: "face-captures/41/avatar.jpg",
          role_name: "driver",
          driver_id: 21,
          driver_status: "Available",
          face_image_url: "face-captures/41/face.jpg",
          license_image_url: null,
        },
      ],
    });

    const res = await GET({});
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.employee_id).toBe(41);
    expect(body.email).toBe("jack@gmail.com");
    expect(body.avatar_url).toBe(
      "https://proj.supabase.co/storage/v1/object/sign/face-captures/41/face.jpg?token=t"
    );
    expect(body.face_image_url).toBe(
      "https://proj.supabase.co/storage/v1/object/sign/face-captures/41/face.jpg?token=t"
    );
    expect(body.driver_status).toBe("Available");

    // The stored key itself must never be what the client receives.
    expect(JSON.stringify(body)).not.toContain("face-captures/41/face.jpg\"");
    // …and it is signed with the short-lived default, not a ten-year TTL.
    expect(signed).toContainEqual({ bucket: "face-captures", key: "41/face.jpg", ttl: 3600 });
  });

  it("falls back to employee avatar_url when face_image_url is null", async () => {
    vi.spyOn(apiUtils, "requireAuth").mockResolvedValue({
      user: { employeeId: 10 },
    });
    mockStorage();

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
          avatar_url: "face-captures/10/admin.jpg",
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
    expect(body.avatar_url).toBe(
      "https://proj.supabase.co/storage/v1/object/sign/face-captures/10/admin.jpg?token=t"
    );
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
