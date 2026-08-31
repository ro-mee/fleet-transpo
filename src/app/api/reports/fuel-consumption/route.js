import { requireAuth, ok, err, handleError } from "@/lib/api/utils";
import { getFuelConsumptionReport, validateFuelReportRange } from "@/lib/reports/fuel-consumption";

export async function GET(req) {
  try {
    await requireAuth(req);
    const params = new URL(req.url).searchParams;
    const from = params.get("from") || "1970-01-01";
    const to = params.get("to") || "2100-01-01";
    const rangeError = validateFuelReportRange(from, to);
    if (rangeError) return err(rangeError, 400);
    return ok(await getFuelConsumptionReport(from, to));
  } catch (error) {
    return handleError(error);
  }
}
