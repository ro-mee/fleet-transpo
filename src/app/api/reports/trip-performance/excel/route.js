import { requireAuth, err, handleError } from "@/lib/api/utils";
import { getTripPerformanceReport, validateReportRange } from "@/lib/reports/operational-reports";
import { buildTripPerformanceWorkbook } from "@/lib/reports/remaining-workbooks";
import { xlsxResponse } from "@/lib/reports/excel-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "management"]);
    const params = new URL(req.url).searchParams;
    const from = params.get("from") || null;
    const to = params.get("to") || null;
    if ((from && !to) || (!from && to)) return err("from and to must be provided together", 400);
    const rangeError = from && to ? validateReportRange(from, to) : null;
    if (rangeError) return err(rangeError, 400);
    return xlsxResponse(await buildTripPerformanceWorkbook(await getTripPerformanceReport(from, to), { from, to }), `trip-performance-${from || "all"}-to-${to || "time"}.xlsx`);
  } catch (error) {
    return handleError(error);
  }
}
