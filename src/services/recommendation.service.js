import { query } from "@/lib/db";
import { resolveDesignatedDriver, isDriverUnavailableFor } from "@/lib/ai/pair-scoring";

// Recommendation snapshot service — the durable store for AI fleet-pair
// recommendations (migration 027).
//
// One snapshot per generation. is_consumed flips once the pair is Accepted &
// Assigned (so the same suggestion isn't reapplied twice); valid_until is the
// hard expiry after which the card surfaces "Recommendation Expired".
//
// Also owns validatePairAvailability(), the designated-driver enforcement rule:
//   - if a vehicle has an active custodian and the chosen driver isn't it, and
//     that custodian is PROVABLY available for the window -> hard block,
//   - only a provably-unavailable custodian legitimizes a substitute.

/** Default snapshot validity window. */
const SNAPSHOT_TTL_MINUTES = 60;

/** Normalize an employee id off a session (same shape used everywhere else). */
function actorId(session) {
  return session?.user?.employeeId ?? null;
}

/** Insert a snapshot, also back-writing the legacy columns for read-back compat. */
export async function saveRecommendationSnapshot({ request, pair, session }) {
  const validUntil = new Date(
    Date.now() + SNAPSHOT_TTL_MINUTES * 60 * 1000
  ).toISOString();

  const pairJson = JSON.stringify(pair);
  const { rows } = await query(
    `INSERT INTO recommendation_snapshots
       (request_id, valid_until, pair_json, vehicle_id, driver_id, designated_driver_id,
        pair_score, confidence, reason_type, replacement_reason, fleet_status, driver_status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      request.request_id,
      validUntil,
      pairJson,
      pair?.vehicle?.vehicle_id ?? null,
      pair?.driver?.driver_id ?? null,
      pair?.designated?.driver_id ?? pair?.designated_driver_id ?? null,
      pair?.score != null ? pair.score : null,
      pair?.confidence != null ? pair.confidence : null,
      pair?.reason_type ?? "designated",
      pair?.replacement_reason ?? null,
      request.fleet_status ?? null,
      pair?.driver?.driver_status ?? null,
      actorId(session),
    ]
  );

  // Back-write the legacy pair columns so any consumer still reading them sees
  // the same pair (kept for backward compatibility; the snapshot is canonical).
  if (rows[0]) {
    await query(
      `UPDATE transportation_requests
          SET ai_vehicle_recommendation = $2, ai_driver_recommendation = $3, updated_at = NOW()
        WHERE request_id = $1`,
      [
        request.request_id,
        JSON.stringify(pair?.vehicle ?? null),
        JSON.stringify(pair?.driver ?? null),
      ]
    ).catch(() => {});
  }

  return rows[0] ?? null;
}

/**
 * The active (unconsumed) recommendation for a request, if any.
 *
 * @returns {Promise<{ snapshot: object|null, expired: boolean, reason?: string }>}
 */
export async function getActiveRecommendation(requestId) {
  const { rows } = await query(
    `SELECT * FROM recommendation_snapshots
      WHERE request_id = $1 AND is_consumed = FALSE
      ORDER BY generated_at DESC
      LIMIT 1`,
    [requestId]
  );
  const snapshot = rows[0] ?? null;
  if (!snapshot) return { snapshot: null, expired: false };

  const now = Date.now();
  const until = snapshot.valid_until ? new Date(snapshot.valid_until).getTime() : null;
  const expired = until != null && Number.isFinite(until) && until < now;
  return {
    snapshot,
    expired,
    reason: expired
      ? "This recommendation is older than its validity window. Regenerate to get a fresh fleet pair."
      : null,
  };
}

/** Mark a snapshot consumed once the recommended pair is assigned. */
export async function markRecommendationConsumed(requestId, snapshotId) {
  await query(
    `UPDATE recommendation_snapshots
        SET is_consumed = TRUE, consumed_at = NOW()
      WHERE snapshot_id = $1 AND request_id = $2 AND is_consumed = FALSE`,
    [snapshotId, requestId]
  );
}

/**
 * Enforce the designated-driver rule for an assign.
 *
 * @param {object} params
 * @param {object} params.request        transportation_requests row
 * @param {number} params.vehicleId
 * @param {number} params.driverId
 * @param {Date} [params.now]
 * @returns {Promise<{ ok:boolean, conflict?:object, reason?:string }>}
 */
export async function validatePairAvailability({ request, vehicleId, driverId, now = new Date() }) {
  if (!vehicleId || !driverId) return { ok: true }; // one-sided assign is fine

  const { rows: pairs } = await query(
    `SELECT driver_id, vehicle_id
       FROM driver_vehicle_assignments
      WHERE assigned_until IS NULL`
  );
  const { rows: drivers } = await query(
    `SELECT d.driver_id, d.driver_status, d.license_expiry,
            COALESCE((
              SELECT COUNT(*)
                FROM dispatchschedules ds
               WHERE ds.driver_id = d.driver_id
                 AND ds.deleted_at IS NULL
                 AND ds.status IN ('Scheduled', 'In Progress')
                 AND ($2::timestamptz IS NULL OR ds.scheduled_departure < $2)
                 AND ($1::timestamptz IS NULL OR COALESCE(ds.scheduled_arrival, ds.scheduled_departure) > $1)
            ), 0)::int AS _schedule_load
       FROM drivers d
      WHERE d.deleted_at IS NULL AND d.driver_id = ANY($3::int[])`,
    [
      request?.pickup_datetime ? new Date(request.pickup_datetime).toISOString() : null,
      request?.pickup_datetime
        ? new Date(
            new Date(request.pickup_datetime).getTime() + 60 * 60 * 1000
          ).toISOString()
        : null,
      [driverId],
    ]
  );
  const driverById = new Map(drivers.map((d) => [d.driver_id, d]));

  const designated = resolveDesignatedDriver(vehicleId, pairs, driverById);
  if (!designated) return { ok: true }; // vehicle has no custodian -> any driver OK

  if (Number(driverId) === Number(designated.driver_id)) return { ok: true };

  // A substitute is only legitimate when the custodian is provably unavailable.
  const unavail = isDriverUnavailableFor(designated, now);
  if (unavail.unavailable) {
    return {
      ok: true,
      reason: `Designated driver ${designated.driver_id} is unavailable: ${unavail.reason}. Substitute allowed.`,
    };
  }

  return {
    ok: false,
    conflict: {
      type: "designated_driver",
      severity: "blocking",
      message: `Vehicle #${vehicleId} is designated to driver #${designated.driver_id}, who is available. Assign that driver, or release the pairing first.`,
      detail: { vehicle_id: vehicleId, designated_driver_id: designated.driver_id, proposed_driver_id: driverId },
    },
  };
}
