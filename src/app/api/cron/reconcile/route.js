import { ok, err, handleError } from "@/lib/api/utils";
import { verifyServiceToken } from "@/lib/api/service-auth";
import { reconcileFailedDeliveries } from "@/services/outbound.service";

// Scheduled integration reconciliation (Roadmap Phase 5, item 19).
//
// Retries every undelivered outbound status event in integration_log
// (status 'pending' | 'failed'). Delivery is best-effort on the emitter's side,
// so a transient Booking outage can leave real Fleet transitions undelivered;
// this job re-drives those rows through the gateway and marks them processed
// when the retry lands.
//
// Triggered by an EXTERNAL scheduler exactly like /api/cron/sync: shared secret
// in CRON_SECRET (Authorization: Bearer <CRON_SECRET> or ?token=), never a user
// session. Fail-closed: if CRON_SECRET is unset, every request is rejected.

export async function POST(req) {
  try {
    const authz = verifyServiceToken(req, process.env.CRON_SECRET);
    if (!authz.ok) return err(authz.message, authz.status);

    const result = await reconcileFailedDeliveries();
    return ok({
      ...result,
      message: `Reconciliation complete: ${result.retried} retried, ${result.delivered} delivered, ${result.stillFailed} still failed.`,
    });
  } catch (e) {
    return handleError(e);
  }
}

// Some schedulers can only issue GET — accept both, mirroring cron/sync.
export async function GET(req) {
  try {
    const authz = verifyServiceToken(req, process.env.CRON_SECRET);
    if (!authz.ok) return err(authz.message, authz.status);

    const result = await reconcileFailedDeliveries();
    return ok({
      ...result,
      message: `Reconciliation complete: ${result.retried} retried, ${result.delivered} delivered, ${result.stillFailed} still failed.`,
    });
  } catch (e) {
    return handleError(e);
  }
}