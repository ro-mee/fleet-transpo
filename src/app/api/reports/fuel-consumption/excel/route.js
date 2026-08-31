import { requireAuth, err, handleError } from "@/lib/api/utils";
import { getFuelConsumptionReport, validateFuelReportRange } from "@/lib/reports/fuel-consumption";
import { buildFuelWorkbook } from "@/lib/reports/fuel-workbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    await requireAuth(req);
    const params = new URL(req.url).searchParams;
    const from = params.get("from") || "1970-01-01";
    const to = params.get("to") || "2100-01-01";
    const rangeError = validateFuelReportRange(from, to);
    if (rangeError) return err(rangeError, 400);
    const report = await getFuelConsumptionReport(from, to);
    const buffer = await buildFuelWorkbook(report, { from, to });
    const filename = `fuel-consumption-efficiency-${from}-to-${to}.xlsx`;
    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
