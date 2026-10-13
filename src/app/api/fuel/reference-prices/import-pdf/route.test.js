import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/api/utils", () => ({ AuthError: class extends Error { constructor(message, status) { super(message); this.status = status; } }, requirePermission: vi.fn(async () => ({ user: { employeeId: 7 } })), parseBody: vi.fn(), ok: (body, status = 200) => Response.json(body, { status }), err: (error, status) => Response.json({ error }, { status }), handleError: (e) => Response.json({ error: e.message }, { status: e.status || 500 }) }));
vi.mock("@/lib/fuel/providers/doe-pdf", () => ({ fetchPdfBytes: vi.fn(), extractPdfText: vi.fn(), buildPdfAnnouncements: vi.fn() }));
vi.mock("@/lib/fuel/price-repository", () => ({ fuelSchemaError: (e) => e, fuelPrices: { record: vi.fn() } }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/db", () => ({ query: async () => ({ rows: [] }) }));

import { requirePermission, parseBody } from "@/lib/api/utils";
import { fetchPdfBytes, extractPdfText, buildPdfAnnouncements } from "@/lib/fuel/providers/doe-pdf";
import { fuelPrices } from "@/lib/fuel/price-repository";

const pdfUrl = "https://cdn.example/f/NCR%20Sep%201-7%202026.pdf";
const announcement = { fuel_product: "Diesel", region: "NCR", reference_price: 62.25, prior_price: null, announced_at: null, effective_at: "2026-09-01T00:00:00+08:00", source_url: pdfUrl };
const post = (body) => { parseBody.mockResolvedValue(body); return POST(new Request("https://local/api/fuel/reference-prices/import-pdf", { method: "POST" })); };
beforeEach(() => { vi.clearAllMocks(); });

describe("manual pdf import", () => {
  it("records parsed announcements with the signed-in verifier", async () => {
    fetchPdfBytes.mockResolvedValue({ ok: true, bytes: new Uint8Array([9]) });
    extractPdfText.mockResolvedValue("PARSEABLE");
    buildPdfAnnouncements.mockReturnValue({ ok: true, announcements: [announcement] });
    fuelPrices.record.mockResolvedValue({ snapshot: { ...announcement, snapshot_id: 1 }, duplicate: false });
    const response = await post({ pdf_url: pdfUrl });
    expect(response.status).toBe(201);
    expect(fuelPrices.record).toHaveBeenCalledWith(announcement, { verifierId: 7 });
    expect(await response.json()).toMatchObject({ outcome: "recorded", persisted: true });
  });
  it("rejects non-https urls and unparseable pdfs without writing", async () => {
    const bad = await post({ pdf_url: "http://cdn.example/f/x.pdf" });
    expect(bad.status).toBe(400); expect(fuelPrices.record).not.toHaveBeenCalled();
    fetchPdfBytes.mockResolvedValue({ ok: false, reason: "cdn down" });
    expect(await (await post({ pdf_url: pdfUrl })).json()).toMatchObject({ outcome: "retained", persisted: false });
    expect(fuelPrices.record).not.toHaveBeenCalled();
  });
});
