import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, sourcePreviewUrl } from "./route";

vi.mock("@/lib/api/utils", () => ({ requirePermission: vi.fn(async () => ({ user: { employeeId: 3 } })), ok: (body, status = 200) => Response.json(body, { status }), err: (error, status) => Response.json({ error }, { status }), handleError: (e) => Response.json({ error: e.message }, { status: e.status || 500 }) }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/fuel/providers/doe-pdf", () => ({ fetchPdfBytes: vi.fn() }));

import { requirePermission } from "@/lib/api/utils";
import { query } from "@/lib/db";
import { fetchPdfBytes } from "@/lib/fuel/providers/doe-pdf";

const get = (qs) => GET(new Request(`https://local/api/fuel/reference-prices/source-pdf${qs}`, { method: "GET" }));
beforeEach(() => { vi.clearAllMocks(); delete process.env.FUEL_PRICE_PDF_CDN; });

describe("source pdf proxy", () => {
  it("streams stored allowlisted pdfs same-origin", async () => {
    process.env.FUEL_PRICE_PDF_CDN = "https://cdn.example";
    query.mockResolvedValue({ rows: [{ source_url: "https://cdn.example/f/ncr.pdf" }] });
    fetchPdfBytes.mockResolvedValue({ ok: true, bytes: new Uint8Array([1, 2, 3]), contentType: "application/pdf" });
    const response = await get("?snapshot_id=4");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(fetchPdfBytes).toHaveBeenCalledWith(expect.objectContaining({ pdfUrl: "https://cdn.example/f/ncr.pdf" }));
  });
  it("refuses unknown snapshots, off-allowlist origins and non-pdfs", async () => {
    expect((await get("?snapshot_id=abc")).status).toBe(404);
    query.mockResolvedValue({ rows: [] });
    expect((await get("?snapshot_id=9")).status).toBe(404);
    query.mockResolvedValue({ rows: [{ source_url: "https://evil.example/f/x.pdf" }] });
    fetchPdfBytes.mockResolvedValue({ ok: false, reason: "PDF origin is not an approved source." });
    const evil = await get("?snapshot_id=9");
    expect(evil.status).toBe(502);
    expect(fetchPdfBytes).toHaveBeenCalledWith(expect.objectContaining({ pdfUrl: "https://evil.example/f/x.pdf" }));
    query.mockResolvedValue({ rows: [{ source_url: "https://doe.gov.ph/f/page.html" }] });
    fetchPdfBytes.mockResolvedValue({ ok: true, bytes: new Uint8Array([1]), contentType: "text/html" });
    const nonPdf = await get("?snapshot_id=9");
    expect(nonPdf.status).toBe(422); expect((await nonPdf.json()).error).toContain("new tab");
  });
  it("builds the preview url by snapshot id", () => {
    expect(sourcePreviewUrl(4)).toBe("/api/fuel/reference-prices/source-pdf?snapshot_id=4");
  });
});
