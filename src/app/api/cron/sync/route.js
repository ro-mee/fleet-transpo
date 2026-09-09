import { ok, err, handleError } from "@/lib/api/utils";
import { verifyServiceToken } from "@/lib/api/service-auth";
import { syncAllVehicleStatuses, syncAllDriverStatuses, syncComplianceNotifications } from "@/services/status.service";
import { syncStartWindowNotifications } from "@/services/start-window-notifications.service";
import { pruneAppErrors } from "@/lib/app-errors";
import { recordSyncHeartbeat } from "@/lib/system-health";

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
// Cadence: ~once per minute is the target, so the trip start-window scan's
// thresholds (start window open / time to head to pickup / trip not started)
// land within a minute of crossing. The route itself is NOT a scheduler —
// it only runs when called.
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
  const [vehicleResult, driverResult, complianceResult, pruneResult, startWindowResult] = await Promise.all([
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
    // Isolated best-effort step by the same rule: the trip start-window
    // notification scan must never fail (or be failed by) the status and
    // compliance sync. The service itself also never throws — the guard is
    // defense in depth.
    (async () => {
      try {
        return await syncStartWindowNotifications();
      } catch {
        return { created: 0, pushes_attempted: 0, skipped: 0, errors: 1, stale_locations: 0 };
      }
    })(),
  ]);

  return ok({
    ...vehicleResult,
    drivers_synced: driverResult.synced,
    notifications_created: complianceResult.created,
    errors_pruned: pruneResult.deleted,
    start_window_notifications_created: startWindowResult.created,
    start_window_pushes_attempted: startWindowResult.pushes_attempted,
    start_window_skipped: startWindowResult.skipped,
    // Driver positions older than 10 min (or of unknown age) still fed those
    // trips' ETAs — surfaced for acceptance testing, not an error.
    start_window_stale_locations: startWindowResult.stale_locations,
    heartbeat_recorded: await recordSyncHeartbeat(),
    message: `Scheduled sync complete (${vehicleResult.synced} vehicles, ${driverResult.synced} drivers, ${complianceResult.created} notifications, ${startWindowResult.created} start-window notifications, ${pruneResult.deleted} old error rows pruned)`,
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
