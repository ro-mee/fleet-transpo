import { validateServiceCode } from "@/lib/trips/filters";
import { requirePermission, err, handleError } from "@/lib/api/utils";
import { getTripPerformanceReport, validateReportRange } from "@/lib/reports/operational-reports";
import { buildTripPerformanceWorkbook } from "@/lib/reports/remaining-workbooks";
import { xlsxResponse } from "@/lib/reports/excel-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    await requirePermission(req, "reports", "read");
    const params = new URL(req.url).searchParams;
    const from = params.get("from") || null;
    const to = params.get("to") || null;
    if ((from && !to) || (!from && to)) return err("from and to must be provided together", 400);
    const rangeError = from && to ? validateReportRange(from, to) : null;
    if (rangeError) return err(rangeError, 400);
    // Export equals the visible filtered view: the same service filter feeds
    // the same selector the JSON surface uses, so the workbook cannot drift
    // from what the dispatcher filtered on screen.
    const service = params.get("service") || null;
    const serviceError = validateServiceCode(service);
    if (serviceError) return err(serviceError, 400);
    const report = await getTripPerformanceReport(from, to, { serviceCode: service, status: params.get("status") || null, search: params.get("search") || null });
    return xlsxResponse(await buildTripPerformanceWorkbook(report, { from, to }), `trip-performance-${from || "all"}-to-${to || "time"}.xlsx`);
  } catch (error) {
    return handleError(error);
  }
}
