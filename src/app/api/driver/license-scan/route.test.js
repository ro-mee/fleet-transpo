import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(async () => ({ rows: [] })),
  withTransaction: vi.fn(),
  requireDriver: vi.fn(async () => ({ user: { employeeId: 8, driverId: 4 } })),
  writeAuditRequired: vi.fn(async () => ({ log_id: 1 })),
  scanDocumentWithGemini: vi.fn(async () => ({ extractedData: { document_is_license_card: true, license_number: "N04-19-013583" } })),
  createAdminClient: vi.fn(() => ({ storage: { from: vi.fn(() => ({ upload: vi.fn(async () => ({ error: null })) })) } })),
}));

vi.mock("@/lib/db", () => ({ query: mocks.query, withTransaction: mocks.withTransaction }));
vi.mock("@/lib/api/utils", async () => {
  const actual = await vi.importActual("@/lib/api/utils");
  return { ...actual, requireDriver: mocks.requireDriver };
});
vi.mock("@/lib/audit", () => ({ writeAuditRequired: mocks.writeAuditRequired }));
vi.mock("@/lib/security/remote-url", () => ({ isSafeRemoteMediaUrl: vi.fn(() => true) }));
vi.mock("@/lib/ai/gemini-document", () => ({
  loadScanImage: vi.fn(),
  scanDocumentWithGemini: mocks.scanDocumentWithGemini,
}));
vi.mock("@/lib/ai/logger", () => ({ logAiRequest: vi.fn() }));
vi.mock("@/lib/ai/license-scan-policy", () => ({ evaluateLicenseScan: vi.fn(() => ({ pass: true, applyExpiry: true, expiryDate: "2027-06-30" })) }));
vi.mock("@/lib/uploads/validator", () => ({ validateBase64Image: vi.fn(() => ({ buffer: new Uint8Array([1, 2, 3]), contentType: "image/jpeg", extension: "jpg" })) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/notifications/recipients", () => ({ notificationRolesFor: vi.fn(() => ["fleet_manager"]) }));
vi.mock("@/lib/storage/object-refs", () => ({ canonicalStoredRef: vi.fn((key) => `driver-licenses/${key}`) }));

import { POST } from "./route";

let tx;
let committed;
let rolledBack;

function request() {
  return new Request("https://fleet.test/api/driver/license-scan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ side: "front", file_url: "data:image/jpeg;base64,YWJj" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  committed = false;
  rolledBack = false;
  tx = { query: vi.fn(async () => ({ rows: [{ driver_id: 4 }] })) };
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

describe("POST /api/driver/license-scan", () => {
  it("audits the accepted scan using field names only", async () => {
    const req = request();
    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(committed).toBe(true);
    expect(mocks.writeAuditRequired).toHaveBeenCalledWith(tx, req, expect.anything(), expect.objectContaining({
      action: "license_scan_updated",
      resource: "drivers",
      resourceId: 4,
      newValues: expect.objectContaining({
        changed_fields: ["license_image_url", "license_expiry"],
        verification_cleared: true,
        outcome: "accepted",
      }),
    }));
    expect(JSON.stringify(mocks.writeAuditRequired.mock.calls)).not.toContain("N04-19-013583");
  });

  it("does not accept the scan when the required audit insert fails", async () => {
    mocks.writeAuditRequired.mockRejectedValueOnce(new Error("audit unavailable"));

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(rolledBack).toBe(true);
    expect(committed).toBe(false);
  });
});
