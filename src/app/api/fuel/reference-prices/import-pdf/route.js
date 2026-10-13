import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { writeAudit } from "@/lib/audit";
import { fuelPrices, fuelSchemaError } from "@/lib/fuel/price-repository";
import { fetchPdfBytes, extractPdfText, buildPdfAnnouncements } from "@/lib/fuel/providers/doe-pdf";

export function parseImportBody(body = {}) {
  const pdf_url = String(body.pdf_url ?? "").trim();
  const week_label = body.week_label == null || String(body.week_label).trim() === "" ? null : String(body.week_label).trim();
  return { pdf_url, week_label };
}

function pdfOrigins() {
  const cdn = String(process.env.FUEL_PRICE_PDF_CDN ?? "").trim();
  try { const url = new URL(cdn); return url.protocol === "https:" ? [url.origin] : []; } catch { return []; }
}

export async function POST(req) {
  try {
    const session = await requirePermission(req, "fuelallocations", "update");
    const { pdf_url, week_label } = parseImportBody(await parseBody(req));
    let pdf;
    try { pdf = new URL(pdf_url); } catch { return err("Paste a valid https PDF URL.", 400); }
    if (pdf.protocol !== "https:" || !pdf.pathname.toLowerCase().endsWith(".pdf")) return err("Paste a valid https PDF URL.", 400);
    const origins = pdfOrigins();
    // Fail closed: with no pinned CDN configured the allowlist must refuse,
    // never fall back to the caller-supplied URL's own origin (that turns a
    // permission-gated endpoint into an open server-side fetcher).
    if (!origins.length) return err("Fuel PDF source is not configured.", 503);
    const downloaded = await fetchPdfBytes({ pdfUrl: pdf.toString(), allowedOrigins: origins });
    if (!downloaded.ok) return ok({ outcome: "retained", reason: downloaded.reason, persisted: false, products: [] });
    let text;
    try { text = await extractPdfText(downloaded.bytes); } catch { return ok({ outcome: "retained", reason: "PDF text unreadable.", persisted: false, products: [] }); }
    let label = week_label ?? "";
    if (!label) { try { label = decodeURIComponent(pdf.pathname.split("/").pop() ?? ""); } catch { label = ""; } }
    const built = buildPdfAnnouncements({ text, pdfUrl: pdf.toString(), weekLabel: label });
    if (!built.ok) return ok({ outcome: "retained", reason: built.reason, persisted: false, products: [] });
    const products = [];
    for (const announcement of built.announcements) {
      try {
        const result = await fuelPrices.record(announcement, { verifierId: session.user.employeeId });
        if (!result.duplicate) await writeAudit(null, session, { action: "create", resource: "fuelallocations", resourceId: result.snapshot.snapshot_id, newValues: { reference_price_snapshot: result.snapshot } });
        products.push({ fuel_product: announcement.fuel_product, outcome: result.duplicate ? "duplicate" : "recorded" });
      } catch (error) {
        if ([400, 409].includes(error.status)) { products.push({ fuel_product: announcement.fuel_product, outcome: "retained", reason: error.message }); continue; }
        throw error;
      }
    }
    const persisted = products.some((p) => p.outcome === "recorded");
    const allDuplicate = products.length > 0 && products.every((p) => p.outcome === "duplicate");
    return ok({ outcome: allDuplicate ? "duplicate" : persisted ? "recorded" : "retained", persisted, products }, allDuplicate || !persisted ? 200 : 201);
  } catch (error) { return handleError(fuelSchemaError(error)); }
}
