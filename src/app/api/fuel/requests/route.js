import { query, withTransaction } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { toCalendarDay } from "@/lib/dates";
import {
  AuthError,
  requirePermission,
  requireDriver,
  parseBody,
  ok,
  err,
  handleError,
} from "@/lib/api/utils";
import {
  calculateFuelRecommendation,
  assessFuelVariance,
  minimumSafeFromSnapshot,
  evaluateFuelPolicy,
  CURRENT_FUEL_TRIP_STATUSES,
  FORECAST_FUEL_TRIP_STATUSES,
} from "@/lib/fuel/request-policy";
import { isOwnedFuelImageUrl } from "@/lib/fuel/receipt-storage";

const currentAllocationMonth = () => `${toCalendarDay(new Date()).slice(0, 7)}-01`;
const SELECT_REQUESTS = `
  SELECT r.*, t.trip_status,
         v.plate_number, v.vehicle_name, v.tank_capacity_l, v.fuel_efficiency_kmpl,
         e.first_name, e.last_name
    FROM fuelrequests r
    LEFT JOIN trips t ON t.trip_id = r.trip_id
    JOIN vehicles v ON v.vehicle_id = r.vehicle_id
    JOIN drivers d ON d.driver_id = r.driver_id
    JOIN employees e ON e.employee_id = d.employee_id`;

async function allocationUsage(db, vehicleId, month) {
  const { rows } = await db.query(
    `SELECT a.allocation_id, a.allocated_liters,
            COALESCE((
              SELECT SUM(f.liters) FROM fuelrecords f
               WHERE f.vehicle_id = $1 AND f.status = 'Approved' AND f.deleted_at IS NULL
                 AND f.fuel_date >= $2::date AND f.fuel_date < ($2::date + INTERVAL '1 month')
            ), 0) AS consumed_liters,
            COALESCE((
              SELECT SUM(r.approved_liters)
                FROM fuelrequests r
                LEFT JOIN fuelrecords f ON f.fuel_request_id = r.fuel_request_id AND f.deleted_at IS NULL
               WHERE r.vehicle_id = $1 AND r.allocation_month = $2::date
                 AND (r.status = 'Approved' OR (r.status = 'Fulfilled' AND COALESCE(f.status, 'Pending') <> 'Approved'))
            ), 0) AS committed_liters
       FROM fuelallocations a
      WHERE a.vehicle_id = $1 AND a.allocation_month = $2::date`,
    [vehicleId, month]
  );
  if (!rows[0]) return null;
  const allocation = rows[0];
  return {
    ...allocation,
    remaining_liters: Math.max(
      0,
      Number(allocation.allocated_liters) - Number(allocation.consumed_liters) - Number(allocation.committed_liters)
    ),
  };
}

export async function GET(req) {
  try {
    const session = await requirePermission(req, "fuel_requests", "read");
    if (session.user.role === "driver" && !session.user.driverId) {
      throw new AuthError("No driver record is linked to this account", 403);
    }
    const status = new URL(req.url).searchParams.get("status");
    const params = [];
    const where = [];
    if (session.user.role === "driver") {
      params.push(session.user.driverId);
      where.push(`r.driver_id = $${params.length}`);
    }
    if (status && ["Pending", "Approved", "Rejected", "Fulfilled"].includes(status)) {
      params.push(status);
      where.push(`r.status = $${params.length}`);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const { rows } = await query(
      `${SELECT_REQUESTS} ${clause}
       ORDER BY (r.status = 'Pending') DESC, r.created_at DESC`,
      params
    );
    const { rows: countRows } = await query(
      `SELECT
         COUNT(*) FILTER (WHERE r.status = 'Pending')::int AS pending,
         COUNT(*) FILTER (WHERE r.status = 'Approved')::int AS approved,
         COUNT(*) FILTER (WHERE r.status = 'Rejected')::int AS rejected,
         COUNT(*) FILTER (WHERE r.status = 'Fulfilled')::int AS fulfilled
       FROM fuelrequests r ${clause}`,
      params
    );
    return ok({ rows, counts: countRows[0] });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req) {
  try {
    const session = await requireDriver(req);
    const body = await parseBody(req);
    const tripId = body.trip_id == null ? null : Number(body.trip_id);
    const fuelLevel = Number(body.current_fuel_level_percent);
    if (tripId !== null && (!Number.isInteger(tripId) || tripId <= 0)) return err("Invalid trip_id", 400);
    if (!Number.isFinite(fuelLevel) || fuelLevel < 0 || fuelLevel > 100) return err("current_fuel_level_percent must be between 0 and 100", 400);
    if (body.purpose && String(body.purpose).length > 500) return err("purpose is too long", 400);
    if (typeof body.gauge_photo_url !== "string" || !body.gauge_photo_url.trim()) {
      return err("A fuel gauge photo is required for every request", 400);
    }
    if (!isOwnedFuelImageUrl(body.gauge_photo_url, session.user.driverId, "gauge")) {
      return err("The gauge photo is not a valid upload for this driver", 400);
    }
    const gaugeScanEstimate = Number(body.gauge_scan_estimate);
    const gaugeScan = Number.isFinite(gaugeScanEstimate) && gaugeScanEstimate >= 0 && gaugeScanEstimate <= 100
      ? { estimated_level_percent: Math.round(gaugeScanEstimate) }
      : null;
    if (typeof body.client_submission_id !== "string" || !/^[0-9a-z-]{16,64}$/i.test(body.client_submission_id)) {
      return err("client_submission_id is required", 400);
    }

    const { rows: duplicates } = await query(
      `SELECT * FROM fuelrequests WHERE driver_id = $1 AND client_submission_id = $2 LIMIT 1`,
      [session.user.driverId, body.client_submission_id]
    );
    if (duplicates[0]) return ok(duplicates[0]);

    const vehicleResult = tripId
      ? await query(
          `SELECT t.trip_id, t.vehicle_id, v.tank_capacity_l, v.fuel_efficiency_kmpl
             FROM trips t
             JOIN vehicles v ON v.vehicle_id = t.vehicle_id AND v.deleted_at IS NULL
            WHERE t.trip_id = $1 AND t.driver_id = $2 AND t.deleted_at IS NULL
              AND t.trip_status = ANY($3::text[])
            LIMIT 1`,
          [tripId, session.user.driverId, FORECAST_FUEL_TRIP_STATUSES]
        )
      : await query(
          `SELECT NULL::int AS trip_id, a.vehicle_id, v.tank_capacity_l, v.fuel_efficiency_kmpl
             FROM driver_vehicle_assignments a
             JOIN vehicles v ON v.vehicle_id = a.vehicle_id AND v.deleted_at IS NULL
            WHERE a.driver_id = $1 AND a.assigned_from <= CURRENT_DATE
              AND (a.assigned_until IS NULL OR a.assigned_until >= CURRENT_DATE)
            ORDER BY a.assigned_from DESC LIMIT 1`,
          [session.user.driverId]
        );
    const vehicle = vehicleResult.rows[0];
    if (!vehicle) return err("No active vehicle assignment was found", 404);
    if (!vehicle.tank_capacity_l || !vehicle.fuel_efficiency_kmpl) {
      return err("The vehicle fuel profile is not configured yet", 409);
    }

    const { rows: forecastRows } = await query(
      `SELECT COALESCE(SUM(COALESCE(rt.estimated_distance, tr.estimated_distance, NULLIF(t.distance, 0), 0)), 0) AS one_way_distance_km
         FROM trips t
         LEFT JOIN dispatchschedules ds ON ds.dispatch_id = t.dispatch_id
         LEFT JOIN transportation_requests tr ON tr.request_id = ds.request_id
         LEFT JOIN routes rt ON rt.route_id = COALESCE(t.route_id, ds.route_id)
        WHERE t.vehicle_id = $1 AND t.deleted_at IS NULL
          AND t.trip_status = ANY($2::text[])
          AND (
            t.trip_status = ANY($3::text[])
            OR COALESCE(t.start_time, ds.scheduled_departure, tr.pickup_datetime)
               BETWEEN NOW() - INTERVAL '12 hours' AND NOW() + INTERVAL '24 hours'
          )`,
      [vehicle.vehicle_id, FORECAST_FUEL_TRIP_STATUSES, CURRENT_FUEL_TRIP_STATUSES]
    );
    const calculation = calculateFuelRecommendation({
      tankCapacityL: vehicle.tank_capacity_l,
      currentFuelLevelPercent: fuelLevel,
      fuelEfficiencyKmpl: vehicle.fuel_efficiency_kmpl,
      oneWayDistanceKm: forecastRows[0].one_way_distance_km,
    });
    if (!calculation.needs_refuel || calculation.recommended_liters <= 0) {
      return err("Fuel is sufficient for the next 24 hours and the required reserve", 409);
    }

    const month = currentAllocationMonth();
    const usage = await allocationUsage({ query }, vehicle.vehicle_id, month);
    if (!usage) return err("No monthly fuel allocation is configured for this vehicle", 409);

    const { rows: lastReportRows } = await query(
      `SELECT current_fuel_level_percent, created_at
         FROM fuelrequests
        WHERE vehicle_id = $1 AND current_fuel_level_percent IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`,
      [vehicle.vehicle_id]
    );
    let variance = { expected_liters: null, variance_liters: null, variance_detected: false };
    const lastReport = lastReportRows[0];
    if (lastReport) {
      const { rows: distanceRows } = await query(
        `SELECT COALESCE(SUM(t.distance), 0) AS distance_km
           FROM trips t
          WHERE t.vehicle_id = $1 AND t.deleted_at IS NULL
            AND t.trip_status = 'Completed'
            AND t.end_time >= $2`,
        [vehicle.vehicle_id, lastReport.created_at]
      );
      variance = assessFuelVariance({
        tankCapacityL: vehicle.tank_capacity_l,
        lastReportedPercent: lastReport.current_fuel_level_percent,
        distanceSinceLastReportKm: distanceRows[0].distance_km,
        efficiencyKmpl: vehicle.fuel_efficiency_kmpl,
        reportedPercent: fuelLevel,
      });
    }

    const snapshot = {
      ...calculation,
      fuel_variance: variance,
      gauge_scan: gaugeScan,
      monthly_allocated_liters: Number(usage.allocated_liters),
      monthly_consumed_liters: Number(usage.consumed_liters),
      monthly_committed_liters: Number(usage.committed_liters),
      monthly_remaining_liters: Number(usage.remaining_liters.toFixed(2)),
    };

    const policy = evaluateFuelPolicy({
      calculation,
      variance,
      monthlyRemainingLiters: usage.remaining_liters,
    });
    const autoAuthorized = policy.within_policy;
    if (autoAuthorized) {
      snapshot.auto_authorized = true;
      snapshot.policy_reasons = [];
    } else {
      snapshot.auto_authorized = false;
      snapshot.policy_reasons = policy.policy_reasons;
    }

    const { rows } = await query(
      `INSERT INTO fuelrequests
         (vehicle_id, driver_id, trip_id, requested_liters, recommended_liters,
          current_fuel_level_percent, forecast_distance_km, allocation_month,
          calculation_snapshot, purpose, client_submission_id, status,
          approved_liters, approved_at, gauge_photo_url)
       VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, $11::varchar,
               CASE WHEN $11::varchar = 'Approved' THEN $12::numeric ELSE NULL END,
               CASE WHEN $11::varchar = 'Approved' THEN NOW() ELSE NULL END,
               $13)
       RETURNING *`,
      [
        vehicle.vehicle_id,
        session.user.driverId,
        vehicle.trip_id,
        calculation.recommended_liters,
        fuelLevel,
        calculation.forecast_distance_km,
        month,
        JSON.stringify(snapshot),
        body.purpose?.trim() || null,
        body.client_submission_id,
        autoAuthorized ? "Approved" : "Pending",
        autoAuthorized ? calculation.recommended_liters : null,
        body.gauge_photo_url.trim(),
      ]
    );
    await query(`UPDATE vehicles SET fuel_level = $2, updated_at = NOW() WHERE vehicle_id = $1`, [vehicle.vehicle_id, fuelLevel]);
    await writeAudit(req, session, {
      action: autoAuthorized ? "auto-authorize" : "create",
      resource: "fuelrequests",
      resourceId: rows[0].fuel_request_id,
      newValues: rows[0],
    });
    return ok(rows[0], 201);
  } catch (e) {
    if (e?.code === "23505") return err("This vehicle already has an open fuel request", 409);
    return handleError(e);
  }
}

export async function PUT(req) {
  try {
    const session = await requirePermission(req, "fuel_requests", "review");
    const body = await parseBody(req);
    const requestId = Number(body.fuel_request_id);
    if (!Number.isInteger(requestId) || requestId <= 0) return err("fuel_request_id is required", 400);
    if (!["Approved", "Rejected"].includes(body.status)) return err("status must be Approved or Rejected", 400);
    if (body.review_notes && String(body.review_notes).length > 500) return err("review_notes is too long", 400);
    if (body.status === "Rejected" && !body.review_notes?.trim()) return err("A rejection reason is required", 400);

    const result = await withTransaction(async (tx) => {
      const { rows } = await tx.query(
        `SELECT r.*, v.tank_capacity_l
           FROM fuelrequests r
           JOIN vehicles v ON v.vehicle_id = r.vehicle_id AND v.deleted_at IS NULL
          WHERE r.fuel_request_id = $1
          FOR UPDATE OF v, r`,
        [requestId]
      );
      const current = rows[0];
      if (!current) throw new AuthError("Fuel request not found", 404);
      if (current.status !== "Pending") throw new AuthError("Only pending fuel requests can be reviewed", 409);

      let approvedLiters = null;
      if (body.status === "Approved") {
        const currentMonth = currentAllocationMonth();
        if (toCalendarDay(current.allocation_month) !== currentMonth) {
          throw new AuthError("This request belongs to a previous monthly allocation and must be rejected", 409);
        }
        approvedLiters = Number(body.approved_liters);
        const tankSpace = Number(current.tank_capacity_l) * (1 - Number(current.current_fuel_level_percent) / 100);
        const hasOverrideReason = Boolean(body.review_notes?.trim());
        if (!Number.isFinite(approvedLiters) || approvedLiters <= 0 || approvedLiters > tankSpace) {
          throw new AuthError(`approved_liters must be between 0 and ${tankSpace.toFixed(2)} L`, 400);
        }

        const minimumSafeLiters = minimumSafeFromSnapshot(current.calculation_snapshot);
        if (minimumSafeLiters != null && approvedLiters < minimumSafeLiters && !hasOverrideReason) {
          throw new AuthError(
            `At least ${minimumSafeLiters.toFixed(2)} L is required to cover the forecast consumption plus the emergency reserve. Provide an override reason to approve less.`,
            400
          );
        }
        if (approvedLiters > Number(current.recommended_liters) && !hasOverrideReason) {
          throw new AuthError("A reason is required when approving above the recommendation", 400);
        }
        const usage = await allocationUsage(tx, current.vehicle_id, current.allocation_month);
        if (!usage) throw new AuthError("No monthly fuel allocation is configured for this vehicle", 409);
        if (approvedLiters > usage.remaining_liters && !hasOverrideReason) {
          const overrun = approvedLiters - Number(usage.remaining_liters);
          throw new AuthError(
            `This approval exceeds the vehicle's monthly fuel budget by ${overrun.toFixed(2)} L. Provide an override reason to approve it anyway.`,
            400
          );
        }
      }

      const { rows: updated } = await tx.query(
        `UPDATE fuelrequests
            SET status = $2::varchar,
                approved_liters = $3,
                review_notes = $4,
                approved_by = CASE WHEN $2::varchar = 'Approved' THEN $5::integer ELSE NULL END,
                approved_at = CASE WHEN $2::varchar = 'Approved' THEN NOW() ELSE NULL END,
                updated_at = NOW()
          WHERE fuel_request_id = $1
          RETURNING *`,
        [requestId, body.status, approvedLiters, body.review_notes?.trim() || null, session.user.employeeId]
      );
      return { old: current, updated: updated[0] };
    });

    await writeAudit(req, session, {
      action: body.status === "Approved" ? "approve" : "reject",
      resource: "fuelrequests",
      resourceId: requestId,
      oldValues: result.old,
      newValues: result.updated,
    });
    return ok(result.updated);
  } catch (e) {
    return handleError(e);
  }
}
