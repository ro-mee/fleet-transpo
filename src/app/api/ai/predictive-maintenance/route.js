import { requirePermission, ok, handleError } from "@/lib/api/utils";
import { getMaintenanceOutlook } from "@/services/maintenance-outlook.service";

/** Read-only service outlook. The service keeps mechanic assignment scope and
 * one assessment clock for the query, independent plans and vehicle summary. */
export async function GET(req) {
  try {
    const session = await requirePermission(req, "predictive_maintenance", "read");
    return ok(await getMaintenanceOutlook(session.user));
  } catch (error) {
    return handleError(error);
  }
}
