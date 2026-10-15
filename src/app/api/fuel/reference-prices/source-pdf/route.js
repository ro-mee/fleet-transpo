import { requirePermission, ok, err, handleError } from "@/lib/api/utils";
import { query } from "@/lib/db";
import { fetchPdfBytes } from "@/lib/fuel/providers/doe-pdf";

// Streams a stored snapshot's PDF through our own origin so it can be previewed
// inline (DOE's CDN forbids framing). Not an open proxy: only URLs already stored
// on snapshots, only allowlisted official origins, permission-gated like history.
function proxyOrigins() {
  const origins = ["https://doe.gov.ph", "https://www.doe.gov.ph"];
  try {
    const cdn = new URL(String(process.env.FUEL_PRICE_PDF_CDN ?? "").trim());
    if (cdn.protocol === "https:") origins.push(cdn.origin);
  } catch { /* unconfigured CDN: official hosts still apply */ }
  return origins;
}

export async function GET(req) {
  try {
    await requirePermission(req, "fuelallocations", "read");
    const id = Number(new URL(req.url).searchParams.get("snapshot_id"));
    if (!Number.isInteger(id) || id <= 0) return err("Unknown snapshot.", 404);
    const { rows } = await query("SELECT source_url FROM fuel_price_snapshots WHERE snapshot_id = $1 LIMIT 1", [id]);
    if (!rows.length) return err("Unknown snapshot.", 404);
    const downloaded = await fetchPdfBytes({ pdfUrl: rows[0].source_url, allowedOrigins: proxyOrigins() });
    if (!downloaded.ok) return err(downloaded.reason, 502);
    if (downloaded.contentType && !downloaded.contentType.includes("pdf")) {
      return err("Preview supports PDFs only — open the dated source in a new tab instead.", 422);
    }
    return new Response(downloaded.bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) { return handleError(error); }
}

export function sourcePreviewUrl(snapshot_id) {
  return `/api/fuel/reference-prices/source-pdf?snapshot_id=${Number(snapshot_id)}`;
}
