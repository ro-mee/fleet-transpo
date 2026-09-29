import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "@/lib/api/utils";

vi.mock("@/lib/security/remote-url", () => ({ isSafeRemoteMediaUrl: () => true }));
vi.mock("@/lib/uploads/validator", () => ({
  validateBase64Image: () => ({ buffer: new Uint8Array([1]), contentType: "image/jpeg", extension: "jpg" }),
}));
vi.mock("@/lib/ai/gemini-document", () => ({
  loadScanImage: vi.fn(async () => ({ buffer: new Uint8Array([1]), contentType: "image/jpeg" })),
  scanDocumentWithGemini: vi.fn(async () => ({
    extractedData: { license_number: "A12-34-567890", expiration_date: "2030-12-31" },
    model: "gemini-test",
  })),
}));
vi.mock("@/lib/ai/logger", () => ({ logAiRequest: vi.fn() }));

import { POST } from "./route";
import * as apiUtils from "@/lib/api/utils";

afterEach(() => vi.restoreAllMocks());

function request(documentType = "Driver_License") {
  return {
    json: async () => ({
      document_type: documentType,
      file_url: "data:image/jpeg;base64,AA==",
    }),
  };
}

describe("POST /api/ai/scan-document license response", () => {
  it("returns OCR license text only to staff with driver write permission", async () => {
    vi.spyOn(apiUtils, "requirePermission").mockResolvedValue({ user: { employeeId: 2 } });

    const response = await POST(request());
    const body = await response.json();

    expect(body.extracted_data.license_number).toBe("A12-34-567890");
    expect(apiUtils.requirePermission).toHaveBeenCalledWith(expect.anything(), "drivers", "update");
  });

  it("denies a scan user who cannot create or update driver records", async () => {
    vi.spyOn(apiUtils, "requirePermission").mockImplementation(async (_req, resource, action) => {
      if (resource === "ai" && action === "scan_document") return { user: { employeeId: 2 } };
      throw new AuthError("Forbidden", 403);
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
  });
});
