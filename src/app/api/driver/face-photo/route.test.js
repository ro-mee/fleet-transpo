// Tests for POST /api/driver/face-photo.
//
// Covers the driver self-service face/profile photo update: a camera/gallery
// image arrives as a base64 data URL (the license-scan contract), is stored
// in the private `face-captures` bucket, and the signed URL is written to the
// driver's OWN face_image_url — the column backing both the profile avatar
// and the attendance face-verification reference.
import { describe, it, expect, vi, afterEach } from "vitest";
import { POST } from "./route";
import * as db from "@/lib/db";
import * as apiUtils from "@/lib/api/utils";
import * as admin from "@/lib/supabase/admin";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockReq(body) {
  return { json: async () => body };
}

/** Minimal bytes with a real JPEG magic header (FF D8 FF). */
const JPEG_DATA_URL = "data:image/jpeg;base64,/9j/AA==";
/** Valid base64 but NOT an image ("hello"). */
const NOT_AN_IMAGE = "data:image/jpeg;base64,aGVsbG8=";

function mockStorage({ uploadError = null, signedUrl = "https://supabase.test/storage/v1/object/sign/face-captures/7/photo.jpg?token=abc" } = {}) {
  const from = vi.fn(() => ({
    upload: vi.fn(async () => ({ error: uploadError })),
    createSignedUrl: vi.fn(async () =>
      signedUrl ? { data: { signedUrl }, error: null } : { data: null, error: { message: "boom" } }
    ),
  }));
  vi.spyOn(admin, "createAdminClient").mockReturnValue({ storage: { from } });
  return from;
}

/** Script the db: staff lookup returns no staff (early return, no push). */
function mockDb() {
  return vi.spyOn(db, "query").mockImplementation(async (sql) => {
    if (sql.includes("FROM drivers d")) return { rows: [{ first_name: "Juan", last_name: "Dela Cruz" }] };
    if (sql.includes("FROM employees")) return { rows: [] };
    return { rows: [] };
  });
}

describe("POST /api/driver/face-photo", () => {
  it("stores the photo and writes the driver's own face_image_url", async () => {
    vi.spyOn(apiUtils, "requireDriver").mockResolvedValue({ user: { driverId: 7 } });
    const from = mockStorage();
    const querySpy = mockDb();

    const res = await POST(mockReq({ file_url: JPEG_DATA_URL }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.driver_id).toBe(7);
    expect(body.face_image_url).toContain("face-captures/7/");

    const update = querySpy.mock.calls.find(([sql]) => sql.includes("SET face_image_url"));
    expect(update).toBeDefined();
    // Session driver_id binds the row — the body can never choose the driver.
    expect(update[1]).toEqual([body.face_image_url, 7]);
    expect(from).toHaveBeenCalledWith("face-captures");
  });

  it("rejects a missing file_url with a validation error", async () => {
    vi.spyOn(apiUtils, "requireDriver").mockResolvedValue({ user: { driverId: 7 } });

    const res = await POST(mockReq({}));
    expect(res.status).toBe(400);
  });

  it("rejects a payload that is not a real image (magic-byte check)", async () => {
    vi.spyOn(apiUtils, "requireDriver").mockResolvedValue({ user: { driverId: 7 } });

    const res = await POST(mockReq({ file_url: NOT_AN_IMAGE }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/match its image type/i);
  });

  it("rejects remote URLs outside fleet storage (SSRF guard)", async () => {
    vi.spyOn(apiUtils, "requireDriver").mockResolvedValue({ user: { driverId: 7 } });

    const res = await POST(mockReq({ file_url: "https://evil.example/photo.jpg" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/captured face photo/i);
  });

  it("returns 500 when the bucket upload fails (writes nothing)", async () => {
    vi.spyOn(apiUtils, "requireDriver").mockResolvedValue({ user: { driverId: 7 } });
    mockStorage({ uploadError: { message: "boom" } });
    const querySpy = mockDb();

    const res = await POST(mockReq({ file_url: JPEG_DATA_URL }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toMatch(/securely store/i);
    expect(querySpy.mock.calls.some(([sql]) => sql.includes("SET face_image_url"))).toBe(false);
  });
});
