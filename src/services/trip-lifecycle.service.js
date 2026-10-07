import { query, withTransaction } from "@/lib/db";
import { AuthError } from "@/lib/api/utils";
import { syncVehicleStatus, syncDriverStatus } from "@/services/status.service";
import { writeAudit } from "@/lib/audit";
import { RESERVATION_LIFECYCLE as L, RESERVATION_EVENT as E } from "@/lib/constants";
import { advanceReservation, findRequestForDispatch } from "@/services/reservation-lifecycle.service";
import { validateOdometerReading } from "@/lib/vehicles/odometer";
import { resolveEstimateDistance, estimateFuelCost } from "@/lib/fuel/trip-estimate";
import { fuelPrices, fuelSchemaError } from "@/lib/fuel/price-repository";
import { trailDistanceKm } from "@/lib/geo/geofence";
import { resolveMonitorAlerts } from "@/services/live-trip-monitor.service";

const TERMINAL = new Set(["Completed", "Cancelled"]);

/**
 * Complete a trip.
 *
 * Extracted verbatim from PUT /api/trips/[id]/complete. The route hands us the
 * already-parsed, boundary-narrowed inputs (endOdometer, distance) plus the
 * authenticated session; the service owns the odometer validation, the single
 * UPDATE, the odometer/driver/dispatch cascade and the request completion.
 *
 * @param {number|string} tripId
 * @param {object}        session
 * @param {object}        [params]
 * @param {number|string} [params.endOdometer]
 * @param {number|string} [params.distance]
 * @param {number|string} [params.startOdometer] legacy fallback when the locked trip
 *                                               has no real stored start reading
 * @param {string|null}   [params.completionReason] PR #3: required reason when
 *                                               completing away from the destination
 * @param {boolean}       [params.geofenceOverride] PR #3: deliberate far-from-
 *                                               destination completion (gate lives
 *                                               in the complete route; recorded here)
 * @param {object|null}   [params.destinationCheck] PR #3: proximity verdict at
 *                                               completion time, for the timeline
 * @returns {Promise<object>} the updated trip row
 */
export async function completeTrip(tripId, session, { endOdometer, distance, startOdometer, completionReason = null, geofenceOverride = false, destinationCheck = null } = {}) {
  let before;
  let odo;
  let completedNow = false;
  const { rows } = await withTransaction(async (tx) => {
    const initial = await tx.query(
      `SELECT t.*, t.distance AS planned_distance,
              v.mileage AS vehicle_mileage, v.fuel_efficiency_kmpl, v.fuel_type
         FROM trips t
         LEFT JOIN vehicles v ON v.vehicle_id = t.vehicle_id AND v.deleted_at IS NULL
        WHERE t.trip_id = $1
        LIMIT 1 FOR UPDATE OF t`,
      [tripId]
    );
    before = initial.rows;
    if (!before[0]) throw new AuthError("Trip not found", 404);
    if (before[0].trip_status === "Completed") return { rows: [before[0]] };
    if (TERMINAL.has(before[0].trip_status)) {
      throw new AuthError(`Trip is already ${before[0].trip_status} and cannot be completed.`, 409);
    }
    // Narrowed at the boundary first: Number() coerces `true` to 1 and `[]` to
    // 0, so an untyped body could otherwise pass as a plausible reading.
    if (endOdometer != null && !["number", "string"].includes(typeof endOdometer)) {
      throw new AuthError("End odometer must be a number of kilometers.", 400);
    }
    const rawEndOdometer =
      typeof endOdometer === "number" || typeof endOdometer === "string" ? endOdometer : null;
    // Validate only when an end reading is actually present. A null/undefined/""
    // reading is a legitimate distance-only completion — legacy trips often
    // never recorded a start odometer — so it is skipped rather than rejected:
    // validateOdometerReading requires a reading and would otherwise 400 the
    // whole completion. A present reading below current mileage would walk the
    // odometer backwards and silently defer every due-date on this vehicle.
    const hasEndOdometer =
      rawEndOdometer !== null && rawEndOdometer !== "" && rawEndOdometer !== undefined;
    odo = hasEndOdometer
      ? validateOdometerReading({
          reading: rawEndOdometer,
          currentMileage: before[0].vehicle_mileage,
        })
      : { ok: true, error: null, flagged: false, reason: null };
    if (!odo.ok) throw new AuthError(odo.error, 400);

    // The locked stored reading is authoritative. Only legacy NULL/zero starts
    // may use a client fallback; unknown scalar types cannot become kilometers.
    const storedStart = before[0].start_odometer;
    const hasStoredStart = storedStart != null && storedStart !== "" && storedStart !== 0 && storedStart !== "0";
    const rawStart = hasStoredStart ? storedStart : startOdometer;
    const startPresent = rawStart != null && rawStart !== "";
    if (startPresent && (!["number", "string"].includes(typeof rawStart) || !Number.isFinite(Number(rawStart)) || Number(rawStart) < 0)) {
      throw new AuthError("Start odometer must be a nonnegative number of kilometers.", 400);
    }
    const startOdo = startPresent ? Number(rawStart) : null;
    const hasStart = Number.isFinite(startOdo) && startOdo > 0;
    const derived = hasStart && hasEndOdometer ? Number(rawEndOdometer) - startOdo : null;
    const suppliedDistance = distance == null || distance === "" ? NaN : Number(distance);
    if (distance != null && distance !== "" && (!["number", "string"].includes(typeof distance) || !Number.isFinite(suppliedDistance) || suppliedDistance < 0)) {
      throw new AuthError("Distance must be a nonnegative number of kilometers.", 400);
    }
    const dist =
      derived !== null && derived >= 0
        ? derived
        : Number.isFinite(suppliedDistance)
          ? suppliedDistance
          : null;
    // COALESCE keeps whatever distance the trip already had: an unusable
    // reading must not clear a figure someone already recorded.
    //
    // PR #3: the server-derived GPS trail distance fills the gap only when
    // neither odometer math nor a supplied figure produced one — it never
    // overrides them, and it is always persisted to gps_distance_km for the
    // planned-vs-actual story regardless of which figure wins.
    let gpsTrailKm = null;
    try {
      const { rows: trail } = await tx.query(
        `SELECT latitude, longitude, recorded_at
           FROM gpstracking
          WHERE trip_id = $1
          ORDER BY recorded_at ASC`,
        [tripId]
      );
      gpsTrailKm = trailDistanceKm(trail);
    } catch {
      gpsTrailKm = null;
    }
    //
    // Task 11: per-trip estimated fuel/cost snapshot, written once at
    // completion. Planned is the distance the trip carried into completion;
    // actual prefers odometer math, then the validated trip distance, then the
    // GPS trail. Planned route distance never becomes actual by fallback.
    // The repository resolves a verified price for the configured region inside
    // this transaction. The trip row lock serializes completion retries, and a
    // captured-at latch preserves the entire first basis, including unavailable
    // values, efficiency and separate planned estimates. Receipts remain separate.
    //
    // Release hold: the estimate columns exist only after migration 155 (and
    // the snapshots table after 154) — do not deploy this revision before
    // both are applied.
    const plannedKm = before[0]?.planned_distance ?? null;
    const odoKm = derived !== null && derived >= 0 ? derived : null;
    const tripKm = Number.isFinite(suppliedDistance) ? suppliedDistance : null;
    const estimateDistance = resolveEstimateDistance({ odometerKm: odoKm, tripDistanceKm: tripKm, gpsTrailKm });
    const efficiency = before[0]?.fuel_efficiency_kmpl ?? null;
    const { rows: settings } = await tx.query("SELECT setting_value FROM system_settings WHERE setting_key = 'fuel_price_region' LIMIT 1");
    const basisRegion = String(settings[0]?.setting_value ?? "").trim() || null;
    const capturedAt = new Date();
    const snapshot = await fuelPrices.applicable({ fuelType: before[0]?.fuel_type, region: basisRegion, at: capturedAt }, tx);
    const basisPrice = snapshot?.reference_price ?? null;
    const basisSnapshotId = snapshot?.snapshot_id ?? null;
    const fuelEstimate = estimateFuelCost({
      distanceKm: estimateDistance.km,
      efficiencyKmpl: efficiency,
      pricePerLiter: basisPrice,
    });
    const plannedEstimate = estimateFuelCost({ distanceKm: plannedKm, efficiencyKmpl: efficiency, pricePerLiter: basisPrice });
    //
    // actual_duration is derived in the same statement rather than a follow-up
    // query, so it can never drift from end_time — NOW() is one value per
    // statement. The CASE leaves trips that never started untouched: a duration
    // measured from a NULL start_time is a number with nothing behind it, and a
    // dimension with no data should stay absent rather than read as zero.
    // GREATEST(0, ...) absorbs clock skew between the two timestamps.
    //
    // The trip, its vehicle mileage and its dispatch are the AUTHORITATIVE rows
    // of this transition — permanent facts that cannot be re-derived later. They
    // must commit or roll back together, or a crash between them would leave a
    // trip marked Completed with a stale vehicle mileage and an in-flight
    // dispatch. The derived statuses (vehicle/driver availability, booking
    // request) are recomputed on demand and run after COMMIT, best-effort.
    const r = await tx.query(
      `UPDATE trips
          SET trip_status = 'Completed',
              end_time = NOW(),
              end_odometer = $1,
              distance = COALESCE($2, $4, distance),
              gps_distance_km = COALESCE($4, gps_distance_km),
              planned_distance_km = $5,
              actual_distance_km = $6,
              distance_provenance = $7,
              estimated_fuel_l = $8,
              estimated_fuel_cost = $9,
              fuel_reference_price = $10,
              fuel_price_snapshot_id = $11,
              fuel_region = $12,
              fuel_efficiency_snapshot_kmpl = $13,
              planned_estimated_fuel_l = $14,
              planned_estimated_fuel_cost = $15,
              fuel_estimate_reason = $16,
              fuel_estimate_captured_at = $17,
              actual_duration = CASE
                WHEN start_time IS NOT NULL
                  THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (NOW() - start_time)) / 60))::int
                ELSE actual_duration
              END
        WHERE trip_id = $3 AND trip_status NOT IN ('Completed', 'Cancelled')
          AND fuel_estimate_captured_at IS NULL
        RETURNING *`,
      [
        rawEndOdometer,
        dist,
        tripId,
        gpsTrailKm,
        plannedKm,
        estimateDistance.km,
        estimateDistance.provenance,
        fuelEstimate.liters,
        fuelEstimate.cost,
        basisPrice != null ? Number(basisPrice) : null,
        basisSnapshotId,
        basisRegion,
        efficiency,
        plannedEstimate.liters,
        plannedEstimate.cost,
        fuelEstimate.reason,
        capturedAt,
      ]
    );
    if (!r.rows[0]) throw new AuthError("Trip not found", 404);
    completedNow = true;
    const txWrites = [];
    // Feed the odometer back into the vehicle. GREATEST is a second guard
    // beyond the validation above: a late-arriving low reading from a retried
    // request must never regress mileage, because that defers every
    // mileage-based service due-date on the vehicle.
    if (before[0]?.vehicle_id && r.rows[0]?.end_odometer !== null) {
      txWrites.push(tx.query(
        `UPDATE vehicles SET mileage = GREATEST(COALESCE(mileage, 0), $1), updated_at = NOW() WHERE vehicle_id = $2`,
        [r.rows[0].end_odometer, before[0].vehicle_id]
      ));
    }
    if (before[0]?.dispatch_id) {
      txWrites.push(tx.query(`UPDATE dispatchschedules SET status = 'Completed' WHERE dispatch_id = $1`, [before[0].dispatch_id]));
    }
    // PR #4: a trip leaving the live lifecycle resolves its monitor alerts
    // HERE, atomically with the status flip — whether or not anyone ever opens
    // Live Operations again. The fleet summary's sweep is only a backstop.
    txWrites.push(resolveMonitorAlerts(tx, tripId, "trip_completed"));
    await Promise.all(txWrites);
    return r;
  }).catch((error) => { throw fuelSchemaError(error); });
  if (!rows[0]) throw new AuthError("Trip not found", 404);
  if (!completedNow) return rows[0];

  // Derived statuses — recomputed on demand, so a failure here self-heals on
  // the next sync. Deliberately outside the transaction above.
  const p = [];
  if (before[0]?.vehicle_id) p.push(syncVehicleStatus(before[0].vehicle_id));
  if (before[0]?.driver_id) p.push(syncDriverStatus(before[0].driver_id));
  await Promise.all(p);
  await writeAudit(null, session, { action: "update", resource: "trips", resourceId: tripId, oldValues: { trip_status: before[0].trip_status }, newValues: { trip_status: "Completed" } });

  // A flagged reading is accepted — an implausible jump is not proof of an
  // error, and refusing it would strand a driver who cannot close their trip.
  // But it has to leave a record someone can find. A console.warn does not:
  // it lives in a server process nobody reads, and the reading it describes
  // has already been fed into vehicles.mileage, where it shifts every
  // mileage-based due-date on the vehicle. This writes it to audit_logs
  // against the vehicle, which is the row the anomaly is about and the one a
  // reviewer would be looking at. Best-effort by design: writeAudit never
  // throws, so a failed audit cannot block trip completion.
  if (odo.flagged) {
    await writeAudit(null, session, {
      action: "flag",
      resource: "vehicles",
      resourceId: before[0].vehicle_id,
      oldValues: { mileage: before[0].vehicle_mileage },
      newValues: { end_odometer: rows[0]?.end_odometer ?? null, trip_id: rows[0]?.trip_id ?? tripId, reason: odo.reason },
    });
  }

  // A completed trip closes the Booking request. advanceReservation walks
  // In Progress→Completed, writing the timeline and notifying Booking.
  // Best-effort: the trip is already completed regardless of sync outcome.
  if (before[0]?.dispatch_id) {
    try {
      const request = await findRequestForDispatch(before[0].dispatch_id);
      if (request) {
        await advanceReservation({
          requestId: request.request_id,
          toStatus: L.COMPLETED,
          session,
          eventType: E.TRIP_COMPLETED,
          description: `Trip completed.`,
          metadata: {
            trip_id: rows[0]?.trip_id,
            dispatch_id: before[0].dispatch_id,
            end_odometer: rows[0]?.end_odometer ?? null,
            distance: rows[0]?.distance ?? null,
            gps_distance_km: rows[0]?.gps_distance_km ?? null,
            geofence_override: geofenceOverride || undefined,
            completion_reason: completionReason || undefined,
            destination_distance_m: destinationCheck?.distanceM ?? undefined,
          },
        });
      }
    } catch (e) {
      console.warn("trip-complete -> request Completed sync failed:", e?.message || e);
    }
  }

  return rows[0];
}

/**
 * Cancel a trip.
 *
 * Terminal trips are locked. Non-terminal trips flip to Cancelled, then the
 * dispatch, vehicle, driver and request are reconciled best-effort — a failed
 * sync must never block the cancellation itself.
 *
 * @param {number|string} tripId
 * @param {object}        session
 * @param {object}        [params]
 * @param {string|null}   [params.reason]
 * @returns {Promise<object>} the updated trip row
 */
export async function cancelTrip(tripId, session, { reason = null } = {}) {
  const { rows: before } = await query(
    `SELECT vehicle_id, driver_id, dispatch_id, trip_status FROM trips WHERE trip_id = $1 LIMIT 1`,
    [tripId]
  );
  if (!before[0]) throw new AuthError("Trip not found", 404);
  if (TERMINAL.has(before[0].trip_status)) {
    throw new AuthError(`Trip is already ${before[0].trip_status} and cannot be cancelled.`, 409);
  }

  const { rows } = await withTransaction(async (tx) => {
    const r = await tx.query(
      `UPDATE trips SET trip_status = 'Cancelled', updated_at = NOW() WHERE trip_id = $1 RETURNING *`,
      [tripId]
    );
    if (!r.rows[0]) throw new AuthError("Trip not found", 404);
    // The dispatch flip is authoritative too — nothing recomputes it from the
    // cancelled trip afterward, so it must commit with the trip or not at all.
    if (before[0]?.dispatch_id) {
      await tx.query(`UPDATE dispatchschedules SET status = 'Cancelled' WHERE dispatch_id = $1`, [before[0].dispatch_id]);
    }
    // PR #4: cancellation also leaves the live lifecycle — same atomic alert
    // resolution contract as completion.
    await resolveMonitorAlerts(tx, tripId, "trip_cancelled");
    return r;
  });
  if (!rows[0]) throw new AuthError("Trip not found", 404);

  // Best-effort cascade: the trip row is already committed, so a failure here
  // is logged and swallowed rather than rolled back — cancellation stands.
  // These are derived statuses, recomputed on demand, so they self-heal.
  try {
    const p = [];
    if (before[0]?.vehicle_id) p.push(syncVehicleStatus(before[0].vehicle_id));
    if (before[0]?.driver_id) p.push(syncDriverStatus(before[0].driver_id));
    await Promise.all(p);
  } catch (e) {
    console.warn("trip-cancel -> status sync failed:", e?.message || e);
  }

  // A cancelled trip cancels the underlying Booking request. Best-effort:
  // the trip is already cancelled regardless of sync outcome.
  if (before[0]?.dispatch_id) {
    try {
      const request = await findRequestForDispatch(before[0].dispatch_id);
      if (request) {
        await advanceReservation({
          requestId: request.request_id,
          toStatus: L.CANCELLED,
          session,
          eventType: E.CANCELLED,
          description: reason || "Trip cancelled.",
          metadata: { trip_id: rows[0]?.trip_id, dispatch_id: before[0].dispatch_id, reason },
          patch: { status_reason: reason },
        });
      }
    } catch (e) {
      console.warn("trip-cancel -> request Cancelled sync failed:", e?.message || e);
    }
  }

  await writeAudit(null, session, {
    action: "update",
    resource: "trips",
    resourceId: tripId,
    oldValues: { trip_status: before[0].trip_status },
    newValues: { trip_status: "Cancelled" },
  });

  return rows[0];
}

/**
 * Sync the resources behind a trip that is now busy (Trip Started / En Route /
 * Arrived / In Progress). Mirrors the tail of PUT /api/trips/[id]/start: the
 * dispatch moves to In Progress and the vehicle, driver and request are
 * reconciled. The trip row itself is written by the caller — this only keeps
 * everything downstream consistent.
 *
 * @param {number|string} tripId
 * @param {object}        session
 * @returns {Promise<object>} the trip row
 */
export async function syncBusyTrip(tripId, session) {
  const { rows: before } = await query(
    `SELECT trip_id, vehicle_id, driver_id, dispatch_id, start_odometer FROM trips WHERE trip_id = $1 LIMIT 1`,
    [tripId]
  );
  if (!before[0]) throw new AuthError("Trip not found", 404);

  // The dispatch flip is an authoritative row — nothing recomputes it from the
  // started trip — so it commits on its own client; the trip row itself is
  // written by the caller. Derived vehicle/driver/reservation statuses are
  // recomputed on demand and stay best-effort outside this transaction.
  await withTransaction(async (tx) => {
    if (before[0]?.dispatch_id) {
      await tx.query(`UPDATE dispatchschedules SET status = 'In Progress' WHERE dispatch_id = $1`, [before[0].dispatch_id]);
    }
  });

  const p = [];
  if (before[0]?.vehicle_id) p.push(syncVehicleStatus(before[0].vehicle_id));
  if (before[0]?.driver_id) p.push(syncDriverStatus(before[0].driver_id));
  await Promise.all(p);

  // A started trip means the underlying Booking request is now In Progress.
  // Before this hop existed, nothing advanced a request past Assigned, so
  // In Progress was unreachable. advanceReservation walks Scheduled→Assigned→
  // In Progress if the request is behind, so a trip started from a partially
  // assigned dispatch still lands correctly.
  // Best-effort: the trip has already started regardless of sync outcome.
  if (before[0]?.dispatch_id) {
    try {
      const request = await findRequestForDispatch(before[0].dispatch_id);
      if (request) {
        await advanceReservation({
          requestId: request.request_id,
          toStatus: L.IN_PROGRESS,
          session,
          eventType: E.TRIP_STARTED,
          description: `Trip #${before[0].trip_id} started.`,
          metadata: {
            trip_id: before[0].trip_id,
            dispatch_id: before[0].dispatch_id,
            start_odometer: before[0].start_odometer ?? null,
          },
        });
      }
    } catch (e) {
      console.warn("trip-busy -> request In Progress sync failed:", e?.message || e);
    }
  }

  return before[0];
}
