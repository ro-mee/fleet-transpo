import { ok, err, handleError } from "@/lib/api/utils";
import { verifyServiceToken } from "@/lib/api/service-auth";
import { syncAllVehicleStatuses, syncAllDriverStatuses, syncComplianceNotifications } from "@/services/status.service";
import { pruneAppErrors } from "@/lib/app-errors";

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
//
// DEPLOY CHECK (2026-09-06): this route does nothing by itself — an EXTERNAL
// scheduler (hosting-platform cron, GitHub Action, cron service) must be
// configured to hit it on an interval with CRON_SECRET, and CRON_SECRET must
// be set in the deployment environment. Without that, neither the
// vehicle/driver/compliance sync NOR the app_errors 90-day prune below runs.

async function runSync(req) {
  const authz = verifyServiceToken(req, process.env.CRON_SECRET);
  if (!authz.ok) return err(authz.message, authz.status);

  // pruneAppErrors never throws by contract, but it runs in its own isolated
  // step anyway: retention cleanup must never fail vehicle/driver/compliance
  // sync just because pruning had a bad day.
  const [vehicleResult, driverResult, complianceResult, pruneResult] = await Promise.all([
    syncAllVehicleStatuses(),
    syncAllDriverStatuses(),
    syncComplianceNotifications(),
    (async () => {
      try {
        return await pruneAppErrors({ olderThanDays: 90 });
      } catch {
        return { deleted: 0 };
      }
    })(),
  ]);

  return ok({
    ...vehicleResult,
    drivers_synced: driverResult.synced,
    notifications_created: complianceResult.created,
    errors_pruned: pruneResult.deleted,
    message: `Scheduled sync complete (${vehicleResult.synced} vehicles, ${driverResult.synced} drivers, ${complianceResult.created} notifications, ${pruneResult.deleted} old error rows pruned)`,
  });
}

export async function POST(req) {
  try {
    return await runSync(req);
  } catch (e) {
    return handleError(e, { req });
  }
}

// Some schedulers can only issue GET requests — accept both.
export async function GET(req) {
  try {
    return await runSync(req);
  } catch (e) {
    return handleError(e, { req });
  }
}
