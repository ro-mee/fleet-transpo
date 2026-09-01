import { requirePermission, ok, err, handleError } from "@/lib/api/utils";
import { getMaintenanceReport, validateReportRange } from "@/lib/reports/operational-reports";

export async function GET(req) {
  try {
    await requirePermission(req, "reports", "read");
    const params = new URL(req.url).searchParams;
    const from = params.get("from") || "1970-01-01";
    const to = params.get("to") || "2100-01-01";
    const rangeError = validateReportRange(from, to);
    if (rangeError) return err(rangeError, 400);
    return ok(await getMaintenanceReport(from, to));
  } catch (error) {
    return handleError(error);
  }
}
