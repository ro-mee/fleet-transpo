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
import * as mediaUrl from "@/lib/security/remote-url";
import { scanDocumentWithGemini } from "@/lib/ai/gemini-document";

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

describe("vehicle PDF scan validation", () => {
  it.each(["OR_CR", "Insurance"])("accepts a valid legacy inline PDF for %s", async documentType => {
    vi.spyOn(apiUtils, "requirePermission").mockResolvedValue({ user: { employeeId: 2 } });
    vi.spyOn(mediaUrl, "isSafeRemoteMediaUrl").mockReturnValue(false);
    const response = await POST({ json: async () => ({ document_type: documentType, file_url: "data:application/pdf;base64,JVBERi0x" }) });
    expect(response.status).toBe(200);
  });

  it.each(["data:application/pdf;base64,AAAA", "data:application/pdf;base64,%%%", "http://127.0.0.1/scan.pdf"])("rejects a disguised PDF or untrusted URL %s", async fileUrl => {
    vi.spyOn(apiUtils, "requirePermission").mockResolvedValue({ user: { employeeId: 2 } });
    vi.spyOn(mediaUrl, "isSafeRemoteMediaUrl").mockReturnValue(false);
    scanDocumentWithGemini.mockClear();
    const response = await POST({ json: async () => ({ document_type: "OR_CR", file_url: fileUrl }) });
    expect(response.status).toBe(400);
    expect(scanDocumentWithGemini).not.toHaveBeenCalled();
  });
});
