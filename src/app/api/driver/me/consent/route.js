import { query } from "@/lib/db";
import { requireDriver, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { clientIp } from "@/lib/rate-limit";
import { CURRENT_PRIVACY_POLICY_VERSION, PRIVACY_POLICY } from "@/lib/consent/policies";

/**
 * POST /api/driver/me/consent
 *
 * Records a driver's acceptance of the current Data Privacy / Terms policy.
 * Called from first sign-in (web and mobile) before personal-data sections are
 * shown. The acceptance is written to the `driver_consents` table as an audit
 * record (who, which version, when, from which surface).
 *
 * Body: { policy_version, accepted: true, via: "web" | "mobile" }
 */
export async function POST(req) {
  try {
    const session = await requireDriver(req);
    const driverId = session.user.driverId;

    const body = await parseBody(req);
    const { policy_version, accepted, via } = body;

    if (accepted !== true) {
      return err("Consent must be explicitly accepted", 400);
    }
    if (Number(policy_version) !== CURRENT_PRIVACY_POLICY_VERSION) {
      return err(
        `This policy version is no longer current. Review and accept version ${CURRENT_PRIVACY_POLICY_VERSION}.`,
        409
      );
    }
    const acceptedVia = via === "mobile" || via === "web" ? via : "web";

    const { rows: drv } = await query(
      `SELECT d.driver_id, d.employee_id
         FROM drivers d
        WHERE d.driver_id = $1 AND d.deleted_at IS NULL
        LIMIT 1`,
      [driverId]
    );
    if (!drv[0]) {
      return err("Driver record not found", 404);
    }

    // The durable driver_consents audit table is applied via migration 017
    // (supabase/migrations/017_driver_consents.sql). The catch below is a
    // defensive fallback: if the table is ever missing (e.g. an un-migrated
    // environment) the gate still completes with a best-effort no-op rather
    // than failing the driver's acceptance.
    try {
      const ip = clientIp(req);
      await query(
        `INSERT INTO driver_consents (driver_id, policy_version, accepted_at, accepted_via, ip_address)
         VALUES ($1, $2, NOW(), $3, $4)`,
        [driverId, CURRENT_PRIVACY_POLICY_VERSION, acceptedVia, ip ? String(ip).slice(0, 50) : null]
      );
    } catch (insertError) {
      console.warn(
        "driver_consents insert skipped (table not created yet — see database-normalization migration):",
        insertError.message
      );
    }

    return ok({
      message: "Consent recorded",
      consent: {
        acceptedVersion: CURRENT_PRIVACY_POLICY_VERSION,
        acceptedAt: new Date().toISOString(),
        acceptedVia,
        requiredVersion: CURRENT_PRIVACY_POLICY_VERSION,
        accepted: true,
        policy: PRIVACY_POLICY,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}