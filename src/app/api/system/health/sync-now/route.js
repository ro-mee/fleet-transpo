import { requireAuth, ok, err, handleError } from "@/lib/api/utils";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import {
  syncAllVehicleStatuses,
  syncAllDriverStatuses,
  syncComplianceNotifications,
} from "@/services/status.service";
import { pruneAppErrors } from "@/lib/app-errors";
import { recordSyncHeartbeat } from "@/lib/system-health";

/**
 * POST /api/system/health/sync-now
 *
 * Manual run of the scheduled maintenance sync for system_admin. Invokes the
 * SAME service functions as the CRON_SECRET /api/cron/sync job (vehicle +
 * driver + compliance sync, error-log prune, success heartbeat) — the only
 * difference is the gate (human admin session instead of service token), so
 * there is no security bypass and no divergent logic to maintain.
 *
 * Heavier than the other health actions: tighter throttle (5/min/account).
 * Audit-logged. Unexpected failures flow through handleError (a broken sync
 * IS an unexpected application failure worth an app_errors row).
 */
export async function POST(req) {
  try {
    const session = await requireAuth(req, ["system_admin"]);

    const [ipBucket, accountBucket] = await Promise.all([
      rateLimit(`health-run-sync:ip:${clientIp(req)}`, { limit: 15, windowMs: 60_000 }),
      rateLimit(`health-run-sync:account:${session.user.employeeId ?? "none"}`, {
        limit: 5,
        windowMs: 60_000,
      }),
    ]);
    if (!ipBucket.allowed || !accountBucket.allowed) {
      return err("Too many requests. Try again later.", 429);
    }

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
    const heartbeat = await recordSyncHeartbeat();

    const summary = {
      vehicles_synced: vehicleResult.synced,
      drivers_synced: driverResult.synced,
      notifications_created: complianceResult.created,
      errors_pruned: pruneResult.deleted,
      heartbeat_recorded: heartbeat,
    };
    await writeAudit(req, session, {
      action: "health_run_sync",
      resource: "system_settings",
      newValues: summary,
    });
    return ok({
      ...summary,
      message: `Manual sync complete (${summary.vehicles_synced} vehicles, ${summary.drivers_synced} drivers, ${summary.notifications_created} notifications, ${summary.errors_pruned} old error rows pruned)`,
    });
  } catch (e) {
    return handleError(e, { req });
  }
}
