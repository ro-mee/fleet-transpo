import { describe, it, expect } from "vitest";
import { validateDocumentFile, isPdfDocument } from "./document-policy";

describe("document upload policy", () => {
  it("keeps create and edit license scans at 5MB and JPG/PNG", () => {
    for (const kind of ["license_front", "license_back"]) {
      expect(validateDocumentFile({ type: "image/jpeg", size: 5 * 1024 * 1024 }, kind).error).toBeUndefined();
      expect(validateDocumentFile({ type: "image/jpeg", size: 5 * 1024 * 1024 + 1 }, kind).error).toMatch(/5MB/);
      expect(validateDocumentFile({ type: "image/webp", size: 10 }, kind).error).toBeTruthy();
      expect(validateDocumentFile({ type: "application/pdf", size: 10 }, kind).error).toBeTruthy();
    }
  });
  it("allows PDFs up to 10MB only for vehicle documents", () => {
    for (const kind of ["OR_CR", "Insurance"]) {
      expect(validateDocumentFile({ type: "application/pdf", size: 6 }, kind, new Uint8Array([37, 80, 68, 70, 45, 49])).extension).toBe("pdf");
      expect(validateDocumentFile({ type: "application/pdf", size: 10 * 1024 * 1024 + 1 }, kind).error).toMatch(/10MB/);
    }
  });
  it("rejects empty, disguised, mismatched and unknown files", () => {
    expect(validateDocumentFile({ type: "image/png", size: 0 }, "license_front").error).toBeTruthy();
    expect(validateDocumentFile({ type: "image/png", size: 8 }, "license_front", new Uint8Array(8)).error).toBeTruthy();
    expect(validateDocumentFile({ type: "image/jpeg", size: 4 }, "license_front", new Uint8Array([255, 216, 255])).error).toBeTruthy();
    expect(validateDocumentFile({ type: "image/png", size: 8 }, "__proto__").error).toBeTruthy();
  });
  it("recognizes saved, signed and inline PDF previews", () => {
    expect(isPdfDocument("https://fleet.test/document.pdf?token=short")).toBe(true);
    expect(isPdfDocument("data:application/pdf;base64,AA==")).toBe(true);
    expect(isPdfDocument("blob:local", "application/pdf")).toBe(true);
    expect(isPdfDocument("https://fleet.test/image.png")).toBe(false);
  });
});
