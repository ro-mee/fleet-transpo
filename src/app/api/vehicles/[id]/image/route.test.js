import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  requirePermission: vi.fn(async () => ({ user: { employeeId: 8 } })),
  writeAudit: vi.fn(async () => null),
  upload: vi.fn(async () => ({ error: null })),
  remove: vi.fn(async () => ({ error: null })),
}));

vi.mock("@/lib/db", () => ({ query: mocks.query }));
vi.mock("@/lib/api/utils", async () => {
  const actual = await vi.importActual("@/lib/api/utils");
  return { ...actual, requirePermission: mocks.requirePermission };
});
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/lib/uploads/validator", () => ({ validateImage: vi.fn(() => ({ extension: "jpg", contentType: "image/jpeg" })) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: mocks.upload,
        remove: mocks.remove,
        getPublicUrl: vi.fn(() => ({ data: { publicUrl: "https://fleet.test/vehicle-image.jpg" } })),
      })),
    },
  })),
}));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query
    .mockResolvedValueOnce({ rows: [{ vehicle_id: 29 }] })
    .mockResolvedValueOnce({ rowCount: 1, rows: [] });
});

describe("POST /api/vehicles/[id]/image", () => {
  it("writes a best-effort reference event after the image reference is saved", async () => {
    const form = new FormData();
    form.set("image", new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), "vehicle.jpg");
    const req = new Request("https://fleet.test/api/vehicles/29/image", { method: "POST", body: form });
    const response = await POST(req, { params: Promise.resolve({ id: "29" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.image_url).toBe("https://fleet.test/vehicle-image.jpg");
    expect(mocks.writeAudit).toHaveBeenCalledWith(req, expect.anything(), expect.objectContaining({
      action: "update",
      resource: "vehicles",
      resourceId: 29,
      newValues: { changed_fields: ["image_url"], outcome: "updated" },
    }));
    expect(JSON.stringify(mocks.writeAudit.mock.calls)).not.toContain("vehicle-image.jpg");
  });
});
