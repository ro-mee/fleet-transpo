import { handleError, ok, requirePermission } from "@/lib/api/utils";
import { listSupplyShipments } from "@/lib/supply/sandbox-integration";

export async function GET(req) {
  try {
    await requirePermission(req, "dispatch", "read_all");
    const shipments = await listSupplyShipments();
    return ok({ shipments });
  } catch (error) {
    return handleError(error);
  }
}
