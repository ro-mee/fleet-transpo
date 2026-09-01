import { requirePermission, err, handleError } from "@/lib/api/utils";
import { getFinancialSummary, validateReportRange } from "@/lib/reports/operational-reports";
import { buildFinancialWorkbook } from "@/lib/reports/remaining-workbooks";
import { xlsxResponse } from "@/lib/reports/excel-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    await requirePermission(req, "reports", "read");
    const params = new URL(req.url).searchParams;
    const from = params.get("from") || "1970-01-01";
    const to = params.get("to") || "2100-01-01";
    const rangeError = validateReportRange(from, to);
    if (rangeError) return err(rangeError, 400);
    return xlsxResponse(await buildFinancialWorkbook(await getFinancialSummary(from, to), { from, to }), `financial-summary-${from}-to-${to}.xlsx`);
  } catch (error) {
    return handleError(error);
  }
}
