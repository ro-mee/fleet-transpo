import { requirePermission, ok, err, handleError } from "@/lib/api/utils";
import { getTripPerformanceReport, validateReportRange } from "@/lib/reports/operational-reports";
import { validateServiceCode } from "@/lib/trips/filters";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req) {
  try {
    await requirePermission(req, "reports", "read");
    const params = new URL(req.url).searchParams;
    const from = params.get("from") || null, to = params.get("to") || null;
    if (!!from !== !!to) return err("from and to must be provided together", 400);
    const rangeError = from && to ? validateReportRange(from, to) : null;
    const serviceCode = params.get("service") || null;
    const error = rangeError || validateServiceCode(serviceCode);
    if (error) return err(error, 400);
    return ok(await getTripPerformanceReport(from, to, { serviceCode, status: params.get("status") || null, search: params.get("search") || null }));
  } catch (error) { return handleError(error); }
}
