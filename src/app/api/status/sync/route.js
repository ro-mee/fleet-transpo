import { requirePermission, ok, handleError } from "@/lib/api/utils";
import { syncAllVehicleStatuses, syncAllDriverStatuses, syncComplianceNotifications } from "@/services/status.service";

export async function POST(req) {
  try {
    await requirePermission(req, "maintenance", "update");
    const [vehicleResult, driverResult, complianceResult] = await Promise.all([
      syncAllVehicleStatuses(),
      syncAllDriverStatuses(),
      syncComplianceNotifications(),
    ]);
    return ok({
      ...vehicleResult,
      drivers_synced: driverResult.synced,
      notifications_created: complianceResult.created,
      message: `Statuses synced (${vehicleResult.synced} vehicles, ${driverResult.synced} drivers, ${complianceResult.created} notifications)`,
    });
  } catch (e) {
    return handleError(e);
  }
}
