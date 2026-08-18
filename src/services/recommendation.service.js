import { query } from "@/lib/db";
import {
  resolveVehiclePairing,
  resolveSubstituteForDate,
  vehicleOperationallyAvailable,
  PAIRING_KIND,
} from "@/lib/ai/pair-scoring";
import { loadDriverScheduleContext } from "@/services/driver-schedule.service";

// Recommendation snapshot service — the durable store for AI fleet-pair
// recommendations (migration 027).
//
// One snapshot per generation. is_consumed flips once the pair is Accepted &
// Assigned (so the same suggestion isn't reapplied twice); valid_until is the
// hard expiry after which the card surfaces "Recommendation Expired".
//
// Also owns validatePairAvailability(), the assignment-time revalidation:
// a vehicle may only be committed to a driver who is its designated custodian,
// or — when that custodian is unavailable — the substitute explicitly assigned
// to it for the pickup date. It re-derives everything from the live DB rather
// than trusting the snapshot or the UI that proposed the pair.

/** Default snapshot validity window. */
const SNAPSHOT_TTL_MINUTES = 60;

/** Normalize an employee id off a session (same shape used everywhere else). */
function actorId(session) {
  return session?.user?.employeeId ?? null;
}

/**
 * Insert a snapshot, also back-writing the legacy columns for read-back compat.
 *
 * `pair` is the canonical shape the panel consumes: `{ trip, recommended,
 * alternate }` where each half is a full vehicle+driver candidate. The flat
 * columns (vehicle_id, driver_id, score, ...) are derived from `recommended` so
 * the persisted row, the pair_json, and every later reader agree on one shape.
 */
export async function saveRecommendationSnapshot({ request, pair, session }) {
  const validUntil = new Date(
    Date.now() + SNAPSHOT_TTL_MINUTES * 60 * 1000
  ).toISOString();

  const recommended = pair?.recommended ?? null;
  const vehicle = recommended?.vehicle ?? null;
  const driver = recommended?.driver ?? null;

  const pairJson = JSON.stringify({
    trip: pair?.trip ?? null,
    recommended,
    alternate: pair?.alternate ?? null,
  });
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
      vehicle?.vehicle_id ?? null,
      driver?.driver_id ?? null,
      recommended?.designated_driver_id ?? null,
      recommended?.score != null ? recommended.score : null,
      recommended?.confidence != null ? recommended.confidence : null,
      recommended?.reason_type ?? "designated",
      recommended?.replacement_reason ?? null,
      request.fleet_status ?? null,
      driver?.driver_status ?? null,
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
        JSON.stringify(vehicle ?? null),
        JSON.stringify(driver ?? null),
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
 * Independently revalidate a vehicle+driver assignment at commit time.
 *
 * This runs against the CURRENT database, never against the recommendation that
 * proposed the pair: a snapshot can be minutes old, the designated driver may
 * have gone on leave since, a substitute may have been booked or unbooked, and
 * the UI that offered the pair may be stale. Everything is re-derived here.
 *
 * The rule is the shared one (`resolveVehiclePairing`), so the answer cannot
 * disagree with what the assignment screen and the AI recommendation applied:
 *   - the vehicle's own status must permit dispatch (`Reserved` does — it only
 *     records a booking during the day; a genuine clash in the requested window
 *     is the caller's double-booking check, which still runs),
 *   - and the driver must be either the vehicle's designated custodian, or —
 *     when that custodian is unavailable — the substitute explicitly assigned to
 *     this vehicle for the pickup date, who must themselves be eligible.
 *
 * An arbitrary available driver is never accepted: being free is not the same as
 * being assigned to the vehicle.
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

  const windowStart = request?.pickup_datetime ? new Date(request.pickup_datetime).toISOString() : null;
  const windowEnd = windowStart
    ? new Date(new Date(windowStart).getTime() + 60 * 60 * 1000).toISOString()
    : null;

  const [{ rows: pairs }, { rows: substitutes }, { rows: vehicleRows }] = await Promise.all([
    query(
      `SELECT driver_id, vehicle_id
         FROM driver_vehicle_assignments
        WHERE assigned_until IS NULL`
    ),
    query(
      `SELECT vehicle_id, substitute_driver_id, effective_from, effective_until
         FROM substitute_vehicle_schedules`
    ),
    query(
      `SELECT vehicle_id, plate_number, vehicle_status
         FROM vehicles WHERE vehicle_id = $1 AND deleted_at IS NULL`,
      [vehicleId]
    ),
  ]);

  const vehicle = vehicleRows[0] ?? null;
  if (vehicle && !vehicleOperationallyAvailable(vehicle)) {
    return {
      ok: false,
      conflict: {
        type: "vehicle_status",
        severity: "blocking",
        message: `Vehicle ${vehicle.plate_number || `#${vehicleId}`} is ${vehicle.vehicle_status} and cannot be dispatched.`,
        detail: { vehicle_id: vehicleId, vehicle_status: vehicle.vehicle_status },
      },
    };
  }

  const pickupDate = request?.pickup_datetime || now;

  // Load every driver the rule could name — the proposed one, the vehicle's
  // custodian, and its booked substitute — so eligibility is judged on real rows
  // rather than on absence of data.
  const designatedId = pairs.find(
    (p) => p.assigned_until == null && Number(p.vehicle_id) === Number(vehicleId)
  )?.driver_id;
  const substituteId = resolveSubstituteForDate(vehicleId, pickupDate, substitutes);
  const wanted = [...new Set([driverId, designatedId, substituteId].filter((v) => v != null).map(Number))];

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
    [windowStart, windowEnd, wanted]
  );
  const driverById = new Map(drivers.map((d) => [d.driver_id, d]));

  // Work-schedule + approved-leave context (migration 049). Loaded once for the
  // drivers the rule could name, then threaded into resolveVehiclePairing so a
  // no-schedule, rest-day, out-of-shift, or on-approved-leave driver is treated
  // as unavailable exactly like an expired license or off-duty status would be.
  const scheduleCtx = await loadDriverScheduleContext(wanted);

  const pairing = resolveVehiclePairing({
    vehicleId,
    pickupDate,
    activePairs: pairs,
    activeSubstitutes: substitutes,
    driverById,
    now,
    returnAt: windowEnd ? new Date(windowEnd) : null,
    scheduleContext: scheduleCtx,
  });

  if (!pairing.ok) {
    return {
      ok: false,
      conflict: {
        type: "designated_driver",
        severity: "blocking",
        message: `Vehicle #${vehicleId} has no driver cleared to take it: ${pairing.reason}`,
        detail: {
          vehicle_id: vehicleId,
          designated_driver_id: pairing.designated?.driver_id ?? null,
          proposed_driver_id: driverId,
        },
      },
    };
  }

  if (Number(driverId) === Number(pairing.driver.driver_id)) {
    return {
      ok: true,
      reason:
        pairing.kind === PAIRING_KIND.DESIGNATED
          ? `Driver ${driverId} is the designated driver for vehicle #${vehicleId}.`
          : `Driver ${driverId} is the assigned substitute for vehicle #${vehicleId}. ${pairing.reason}`,
    };
  }

  // The vehicle HAS a cleared driver — just not this one. Naming them makes the
  // 409 actionable instead of merely refusing.
  const expected =
    pairing.kind === PAIRING_KIND.DESIGNATED
      ? `its designated driver #${pairing.driver.driver_id}`
      : `its assigned substitute #${pairing.driver.driver_id}`;
  return {
    ok: false,
    conflict: {
      type: "designated_driver",
      severity: "blocking",
      message: `Vehicle #${vehicleId} must be driven by ${expected}, not driver #${driverId}. Assign that driver, or record a substitute assignment first.`,
      detail: {
        vehicle_id: vehicleId,
        designated_driver_id: pairing.designated?.driver_id ?? null,
        expected_driver_id: pairing.driver.driver_id,
        proposed_driver_id: driverId,
      },
    },
  };
}
