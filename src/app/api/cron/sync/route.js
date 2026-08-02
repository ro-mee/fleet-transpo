import { ok, err, handleError } from "@/lib/api/utils";
import { verifyServiceToken } from "@/lib/api/service-auth";
import { syncAllVehicleStatuses, syncAllDriverStatuses, syncComplianceNotifications } from "@/services/status.service";

// Scheduled compliance & status sync (C4).
//
// Triggered by an EXTERNAL scheduler (e.g. a cron service, GitHub Action, or
// hosting-platform cron) that hits this endpoint on an interval. Authentication
// is a shared secret in CRON_SECRET — NOT a user session — so no human login is
// involved. Configure the scheduler to send:
//     Authorization: Bearer <CRON_SECRET>
// (a `?token=<CRON_SECRET>` query param is also accepted for schedulers that
// cannot set headers).
//
// Fail-closed: if CRON_SECRET is unset, every request is rejected.

async function runSync(req) {
  const authz = verifyServiceToken(req, process.env.CRON_SECRET);
  if (!authz.ok) return err(authz.message, authz.status);

  const [vehicleResult, driverResult, complianceResult] = await Promise.all([
    syncAllVehicleStatuses(),
    syncAllDriverStatuses(),
    syncComplianceNotifications(),
  ]);

  return ok({
    ...vehicleResult,
    drivers_synced: driverResult.synced,
    notifications_created: complianceResult.created,
    message: `Scheduled sync complete (${vehicleResult.synced} vehicles, ${driverResult.synced} drivers, ${complianceResult.created} notifications)`,
  });
}

export async function POST(req) {
  try {
    return await runSync(req);
  } catch (e) {
    return handleError(e);
  }
}

// Some schedulers can only issue GET requests — accept both.
export async function GET(req) {
  try {
    return await runSync(req);
  } catch (e) {
    return handleError(e);
  }
}
