import { query } from "@/lib/db";
import { isExpiredOn, toCalendarDay } from "@/lib/dates";
import { CONFLICT_SEVERITY, CONFLICT_TYPE } from "@/lib/scheduling/conflict-types";
import { getUvvrpPolicy, getExemptVehicleIds } from "@/lib/uvvrp/uvvrp.service";
import { isRestricted, weekdayFor, plateLastDigit } from "@/lib/uvvrp/policy";

// Double-booking prevention.
//
// These helpers detect when a vehicle or driver is already committed to an
// overlapping window. Enforcement is app-layer (check-then-insert), consistent
// with the rest of this codebase — there is an unavoidable TOCTOU race between
// the check and the INSERT under high concurrency. For this single-org,
// low-write workload that is acceptable; a fully race-free fix would require a
// Postgres exclusion constraint (tstzrange + btree_gist), which is noted as
// follow-up work in docs/rbac-model.md rather than done here.

// Statuses that still hold a resource. Completed/Cancelled/Rejected release it.
const ACTIVE_DISPATCH_STATUSES = ["Scheduled", "In Progress"];
const DAY_MS = 24 * 60 * 60 * 1000;

// Active custodial pairings (migration 017), enriched with the plate and driver
// name the warning message needs. `assigned_until IS NULL` is exactly the
// predicate on uq_dva_active_driver / uq_dva_active_vehicle, so this reads the
// same rows those indexes constrain — at most one per driver and per vehicle.
//
// Shared by both entry points below (`$1` = vehicle ids, `$2` = driver ids) so
// the single and batch paths cannot load different rows for the same rule.
const ACTIVE_ASSIGNMENTS_SQL = `
  SELECT a.assignment_id, a.driver_id, a.vehicle_id, a.assigned_from, a.assigned_until,
         v.plate_number, e.first_name, e.last_name
    FROM driver_vehicle_assignments a
    LEFT JOIN vehicles v ON v.vehicle_id = a.vehicle_id
    LEFT JOIN drivers d ON d.driver_id = a.driver_id
    LEFT JOIN employees e ON e.employee_id = d.employee_id
   WHERE a.assigned_until IS NULL
     AND (a.vehicle_id = ANY($1) OR a.driver_id = ANY($2))
`;

/**
 * Find dispatch schedules that overlap the requested departure/arrival window
 * for the same vehicle or driver. A missing scheduled_arrival is coalesced to
 * the departure so the record still blocks its own start instant.
 *
 * @returns {Promise<Array>} conflicting rows (empty = free)
 */
export async function findDispatchConflicts({
  vehicleId,
  driverId,
  departure,
  arrival,
  excludeId = null,
}) {
  if (!departure || (!vehicleId && !driverId)) return [];

  const params = [departure, arrival || departure];
  let idx = 3;

  const resourceClauses = [];
  if (vehicleId) { resourceClauses.push(`vehicle_id = $${idx++}`); params.push(vehicleId); }
  if (driverId) { resourceClauses.push(`driver_id = $${idx++}`); params.push(driverId); }

  let sql = `
    SELECT dispatch_id, dispatch_number, vehicle_id, driver_id, scheduled_departure, scheduled_arrival, status
    FROM dispatchschedules
    WHERE deleted_at IS NULL
      AND status = ANY($${idx++})
      AND (${resourceClauses.join(" OR ")})
      AND (
        scheduled_departure < $2::timestamptz
        AND COALESCE(scheduled_arrival, scheduled_departure) > $1::timestamptz
      )
  `;
  params.push(ACTIVE_DISPATCH_STATUSES);

  if (excludeId) { sql += ` AND dispatch_id <> $${idx++}`; params.push(excludeId); }

  const { rows } = await query(sql, params);
  return rows;
}

// ============================================================================
// Request-level conflict detection (Phase 12 queue chips).
//
// The two functions above answer "is this exact resource free?" and gate the
// dispatch INSERT. This one answers a broader question for the queue UI: given
// a request and its (possibly proposed) vehicle/driver, what could go wrong?
//
// It never blocks anything — it returns typed findings the queue renders as
// chips so a dispatcher sees problems before committing. Enforcement still
// happens at /api/dispatch via findDispatchConflicts.
// ============================================================================

// The type enum lives in ./conflict-types.js — a module with no imports — so a
// client component can name a finding without pulling pg into the browser
// bundle. Re-exported here because every server caller and the verification
// harness import it from this module.
export { CONFLICT_TYPE };

const SEVERITY = CONFLICT_SEVERITY;

// ---------------------------------------------------------------------------
// Pure rule application.
//
// Every conflict rule lives here, operating on already-fetched rows and no
// database handle. Both entry points below feed it: detectRequestConflicts
// fetches for one request, detectConflictsForRequests batch-fetches for a whole
// queue page. Sharing this function is what guarantees a card in the queue and
// the 409 at assign time can never disagree about the rules — only about how
// the rows were loaded.
// ---------------------------------------------------------------------------

/** Half-open overlap, mirroring the SQL in findDispatchConflicts. */
function overlapsWindow(dispatch, startIso, endIso) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso ?? startIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;

  const depart = new Date(dispatch.scheduled_departure).getTime();
  const arrive = new Date(dispatch.scheduled_arrival ?? dispatch.scheduled_departure).getTime();
  if (!Number.isFinite(depart) || !Number.isFinite(arrive)) return false;

  return depart < end && arrive > start;
}

/** Calendar-day containment for a maintenance window, mirroring the SQL. */
function maintenanceCoversDay(row, day) {
  if (!day) return false;
  const from = toCalendarDay(row.maintenance_date);
  const to = toCalendarDay(row.completed_date ?? row.maintenance_date);
  if (!from || !to) return false;
  return from <= day && to >= day;
}

/**
 * Apply every conflict rule to one request against pre-fetched context.
 *
 * @param {object} request  transportation_requests row
 * @param {object} ctx
 * @param {object|null} ctx.vehicle      the vehicles row under consideration
 * @param {object|null} ctx.driver       the drivers row (joined with employees)
 * @param {object[]} ctx.dispatches      active dispatches touching that vehicle/driver
 * @param {object[]} ctx.maintenance     non-completed maintenance rows for that vehicle
 * @param {object[]} ctx.assignments     ACTIVE driver_vehicle_assignments rows for that vehicle/driver
 * @returns {Array<{type: string, severity: string, message: string, detail?: object}>}
 */
export function evaluateRequestConflicts(request, { vehicle = null, driver = null, dispatches = [], maintenance = [], assignments = [], uvvrp = null } = {}) {
  const findings = [];
  const passengers = Number(request?.passenger_count) || 1;
  const pickup = request?.pickup_datetime || null;
  const arrival = request?.scheduled_arrival || null;
  const pickupDay = toCalendarDay(pickup);

  if (pickup) {
    for (const c of dispatches) {
      // A dispatch created FOR this request is not in conflict with it. Both
      // entry points rely on this, so it lives here rather than in either fetch.
      if (c.request_id != null && request?.request_id != null && c.request_id === request.request_id) continue;
      if (!overlapsWindow(c, pickup, arrival)) continue;
      const isVehicle = vehicle && c.vehicle_id === vehicle.vehicle_id;
      const isDriver = driver && c.driver_id === driver.driver_id;
      if (!isVehicle && !isDriver) continue;
      findings.push({
        type: isVehicle ? CONFLICT_TYPE.VEHICLE_CONFLICT : CONFLICT_TYPE.DRIVER_CONFLICT,
        severity: SEVERITY.BLOCKING,
        message: isVehicle
          ? `Vehicle already dispatched (${c.dispatch_number || `#${c.dispatch_id}`}) in this window.`
          : `Driver already dispatched (${c.dispatch_number || `#${c.dispatch_id}`}) in this window.`,
        detail: { dispatch_id: c.dispatch_id, dispatch_number: c.dispatch_number },
      });
    }
  }

  if (vehicle) {
    if (isExpiredOn(vehicle.registration_expiry, request.pickup_datetime)) {
      findings.push({
        type: CONFLICT_TYPE.REGISTRATION_EXPIRED,
        severity: SEVERITY.BLOCKING,
        message: `Vehicle ${vehicle.plate_number} registration ${toCalendarDay(vehicle.registration_expiry)} is not valid for this trip.`,
        detail: { vehicle_id: vehicle.vehicle_id },
      });
    }
    if (isExpiredOn(vehicle.insurance_expiry, request.pickup_datetime)) {
      findings.push({
        type: CONFLICT_TYPE.INSURANCE_EXPIRED,
        severity: SEVERITY.BLOCKING,
        message: `Vehicle ${vehicle.plate_number} insurance ${toCalendarDay(vehicle.insurance_expiry)} is not valid for this trip.`,
        detail: { vehicle_id: vehicle.vehicle_id },
      });
    }
    if (uvvrp?.restricted && !uvvrp.exempt) {
      findings.push({
        type: CONFLICT_TYPE.UVVRP_RESTRICTED,
        severity: uvvrp.response === "warn" ? SEVERITY.WARNING : SEVERITY.BLOCKING,
        message: `Vehicle ${vehicle.plate_number} is number-coding restricted (ends ${uvvrp.digit}) on ${uvvrp.weekday}.`,
        detail: { vehicle_id: vehicle.vehicle_id, weekday: uvvrp.weekday, plate_digit: uvvrp.digit, response: uvvrp.response },
      });
    }
    if ((vehicle.seating_capacity || 0) > 0 && vehicle.seating_capacity < passengers) {
      findings.push({
        type: CONFLICT_TYPE.CAPACITY_MISMATCH,
        severity: SEVERITY.BLOCKING,
        message: `Vehicle seats ${vehicle.seating_capacity}, request needs ${passengers}.`,
        detail: { vehicle_id: vehicle.vehicle_id, seating_capacity: vehicle.seating_capacity, passenger_count: passengers },
      });
    }
  }

  if (driver) {
    const name = `${driver.first_name || ""} ${driver.last_name || ""}`.trim() || `#${driver.driver_id}`;
    if (["Suspended", "On Leave", "Off Duty"].includes(driver.driver_status)) {
      findings.push({
        type: CONFLICT_TYPE.DRIVER_UNAVAILABLE,
        severity: SEVERITY.BLOCKING,
        message: `Driver ${name} is ${driver.driver_status}.`,
        detail: { driver_id: driver.driver_id, driver_status: driver.driver_status },
      });
    }
    if (isExpiredOn(driver.license_expiry, request.pickup_datetime)) {
      findings.push({
        type: CONFLICT_TYPE.LICENSE_EXPIRED,
        severity: SEVERITY.BLOCKING,
        message: `Driver ${name} license ${toCalendarDay(driver.license_expiry)} is not valid for this trip.`,
        detail: { driver_id: driver.driver_id },
      });
    }
  }

  if (vehicle && pickupDay) {
    for (const m of maintenance) {
      if (m.vehicle_id !== vehicle.vehicle_id) continue;
      if (!maintenanceCoversDay(m, pickupDay)) continue;
      findings.push({
        type: CONFLICT_TYPE.MAINTENANCE_CONFLICT,
        severity: SEVERITY.BLOCKING,
        message: `Vehicle is under ${m.maintenance_type || "maintenance"} during this window.`,
        detail: { maintenance_id: m.maintenance_id, status: m.status },
      });
    }
  }

  // Custodial pairing (migration 017). This is the only WARNING-severity rule:
  // when a driver's paired car is in maintenance they MUST take another one, so
  // departing from the pairing can never block a dispatch — it only tells the
  // dispatcher that accountability for fuel/damage is about to move.
  //
  // Both sides are reported independently: taking someone else's car and lending
  // yours out are different facts, and a swap between two paired drivers should
  // surface both. At most one finding per side, since uq_dva_active_* guarantees
  // at most one active row per driver and per vehicle.
  if (vehicle || driver) {
    const active = assignments.filter((a) => a.assigned_until == null);

    if (driver) {
      const driverName = `${driver.first_name || ""} ${driver.last_name || ""}`.trim() || `#${driver.driver_id}`;
      const own = active.find((a) => a.driver_id === driver.driver_id);
      if (own && (!vehicle || own.vehicle_id !== vehicle.vehicle_id)) {
        findings.push({
          type: CONFLICT_TYPE.VEHICLE_NOT_ASSIGNED_TO_DRIVER,
          severity: SEVERITY.WARNING,
          message: `Driver ${driverName} is normally assigned to ${own.plate_number || `vehicle #${own.vehicle_id}`}.`,
          detail: {
            driver_id: driver.driver_id,
            assigned_vehicle_id: own.vehicle_id,
            assigned_plate_number: own.plate_number ?? null,
            proposed_vehicle_id: vehicle?.vehicle_id ?? null,
          },
        });
      }
    }

    if (vehicle) {
      const custodian = active.find((a) => a.vehicle_id === vehicle.vehicle_id);
      if (custodian && (!driver || custodian.driver_id !== driver.driver_id)) {
        const custodianName =
          `${custodian.first_name || ""} ${custodian.last_name || ""}`.trim() || `driver #${custodian.driver_id}`;
        findings.push({
          type: CONFLICT_TYPE.VEHICLE_NOT_ASSIGNED_TO_DRIVER,
          severity: SEVERITY.WARNING,
          message: `Vehicle ${vehicle.plate_number || `#${vehicle.vehicle_id}`} is normally driven by ${custodianName}.`,
          detail: {
            vehicle_id: vehicle.vehicle_id,
            assigned_driver_id: custodian.driver_id,
            assigned_driver_name: custodianName,
            proposed_driver_id: driver?.driver_id ?? null,
          },
        });
      }
    }
  }

  return findings;
}

/**
 * Number-coding (UVVRP) finding context for a vehicle + departure. Failure-
 * tolerant: a policy/exemption read error degrades to no finding.
 */
async function buildUvvrpCtx(vehicle, date) {
  if (!vehicle || !date) return null;
  try {
    const policy = await getUvvrpPolicy();
    if (!policy.enabled) return null;
    const restricted = isRestricted(vehicle.plate_number, policy, new Date(date));
    if (!restricted) return null;
    const exemptVehicleIds = await getExemptVehicleIds();
    return {
      restricted: true,
      response: policy.response,
      exempt: exemptVehicleIds.has(vehicle.vehicle_id),
      weekday: weekdayFor(date),
      digit: plateLastDigit(vehicle.plate_number),
    };
  } catch (e) {
    console.warn("uvvrp ctx failed:", e?.message || e);
    return null;
  }
}

/**
 * Inspect a request (plus any assigned/proposed vehicle & driver) for problems.
 *
 * Every check is independent and failure-tolerant: a query error on one check
 * degrades that check to "no finding" rather than failing the whole call, so a
 * transient DB hiccup can't blank the queue.
 *
 * @param {object} request  transportation_requests row (pickup_datetime, passenger_count, vehicle_id, driver_id)
 * @param {object} [opts]
 * @param {number} [opts.vehicleId]  override — check a proposed vehicle instead of the assigned one
 * @param {number} [opts.driverId]   override — check a proposed driver
 * @returns {Promise<Array<{type: string, severity: string, message: string, detail?: object}>>}
 */
export async function detectRequestConflicts(request, opts = {}) {
  if (!request) return [];

  const vehicleId = opts.vehicleId ?? request.vehicle_id ?? null;
  const driverId = opts.driverId ?? request.driver_id ?? null;
  const pickup = request.pickup_datetime || null;

  // Run every probe concurrently; each resolves to rows or a null/[] fallback.
  const [overlap, vehicleRow, driverRow, maintenance, assignments] = await Promise.all([
    // 1+2. Vehicle / driver already committed to an overlapping dispatch.
    pickup && (vehicleId || driverId)
      ? findDispatchConflicts({
          vehicleId,
          driverId,
          departure: pickup,
          arrival: request.scheduled_arrival || null,
        }).catch(() => [])
      : Promise.resolve([]),

    // 6. Vehicle registration + 7. capacity.
    vehicleId
      ? query(
          `SELECT vehicle_id, plate_number, seating_capacity, registration_expiry, insurance_expiry, vehicle_status
             FROM vehicles WHERE vehicle_id = $1 AND deleted_at IS NULL`,
          [vehicleId]
        )
          .then((r) => r.rows[0] || null)
          .catch(() => null)
      : Promise.resolve(null),

    // 4. Driver availability + 5. license.
    driverId
      ? query(
          `SELECT d.driver_id, d.license_expiry, d.driver_status, e.first_name, e.last_name
             FROM drivers d
             LEFT JOIN employees e ON e.employee_id = d.employee_id
            WHERE d.driver_id = $1 AND d.deleted_at IS NULL`,
          [driverId]
        )
          .then((r) => r.rows[0] || null)
          .catch(() => null)
      : Promise.resolve(null),

    // 3. Vehicle in an open maintenance window covering the pickup date.
    // maintenance_date/completed_date are DATEs (001_schema.sql); an unfinished
    // record with no completed_date is treated as covering its own day only.
    vehicleId && pickup
      ? query(
          `SELECT maintenance_id, maintenance_type, maintenance_date, completed_date, status
             FROM vehiclemaintenance
            WHERE vehicle_id = $1
              AND deleted_at IS NULL
              AND status <> 'Completed'
              AND maintenance_date <= $2::date
              AND COALESCE(completed_date, maintenance_date) >= $2::date`,
          [vehicleId, pickup]
        )
          .then((r) => r.rows)
          .catch(() => [])
      : Promise.resolve([]),

    // 8. Custodial pairing (017) for either side. Unlike the checks above this
    // one runs without a pickup time — the pairing is standing, not windowed.
    vehicleId || driverId
      ? query(ACTIVE_ASSIGNMENTS_SQL, [
          vehicleId ? [vehicleId] : [],
          driverId ? [driverId] : [],
        ])
          .then((r) => r.rows)
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  // findDispatchConflicts has already applied the overlap window in SQL, so the
  // rows handed to the evaluator are pre-filtered; re-checking there is
  // harmless and keeps the batch path (which fetches a wider window) honest.
  return evaluateRequestConflicts(request, {
    vehicle: vehicleRow,
    driver: driverRow,
    dispatches: overlap,
    maintenance: maintenance.map((m) => ({ ...m, vehicle_id: vehicleId })),
    assignments,
    uvvrp: await buildUvvrpCtx(vehicleRow, request.pickup_datetime),
  });
}

/**
 * Batch equivalent of detectRequestConflicts for a whole queue page.
 *
 * The per-request function issues up to four queries; running it across a queue
 * would be an N+1 on every poll. This fetches each table once for the union of
 * referenced vehicles and drivers, then applies the same
 * evaluateRequestConflicts rules per row — so the batch and single paths cannot
 * drift apart.
 *
 * Failure-tolerant in the same way: a query error degrades to "no findings for
 * anyone" rather than failing the queue request.
 *
 * @param {object[]} requests transportation_requests rows
 * @returns {Promise<Map<number, Array>>} request_id -> findings
 */
export async function detectConflictsForRequests(requests = []) {
  const out = new Map();
  if (!Array.isArray(requests) || requests.length === 0) return out;

  const vehicleIds = [...new Set(requests.map((r) => r.vehicle_id).filter(Boolean))];
  const driverIds = [...new Set(requests.map((r) => r.driver_id).filter(Boolean))];

  // Nothing is assigned yet — no resource to conflict with.
  if (vehicleIds.length === 0 && driverIds.length === 0) {
    for (const r of requests) out.set(r.request_id, []);
    return out;
  }

  // Bound the dispatch scan to the span the queue actually covers rather than
  // reading the whole table.
  const times = requests
    .map((r) => new Date(r.pickup_datetime).getTime())
    .filter((t) => Number.isFinite(t));
  const windowStart = times.length ? new Date(Math.min(...times) - DAY_MS).toISOString() : null;
  const windowEnd = times.length ? new Date(Math.max(...times) + DAY_MS).toISOString() : null;

  const [vehicles, drivers, dispatches, maintenance, assignments] = await Promise.all([
    vehicleIds.length
      ? query(
          `SELECT vehicle_id, plate_number, seating_capacity, registration_expiry, insurance_expiry, vehicle_status
             FROM vehicles WHERE vehicle_id = ANY($1) AND deleted_at IS NULL`,
          [vehicleIds]
        ).then((r) => r.rows).catch(() => [])
      : Promise.resolve([]),

    driverIds.length
      ? query(
          `SELECT d.driver_id, d.license_expiry, d.driver_status, e.first_name, e.last_name
             FROM drivers d
             LEFT JOIN employees e ON e.employee_id = d.employee_id
            WHERE d.driver_id = ANY($1) AND d.deleted_at IS NULL`,
          [driverIds]
        ).then((r) => r.rows).catch(() => [])
      : Promise.resolve([]),

    windowStart
      ? query(
          `SELECT dispatch_id, dispatch_number, request_id, vehicle_id, driver_id,
                  scheduled_departure, scheduled_arrival, status
             FROM dispatchschedules
            WHERE deleted_at IS NULL
              AND status = ANY($1)
              AND (vehicle_id = ANY($2) OR driver_id = ANY($3))
              AND scheduled_departure < $5::timestamptz
              AND COALESCE(scheduled_arrival, scheduled_departure) > $4::timestamptz`,
          [ACTIVE_DISPATCH_STATUSES, vehicleIds, driverIds, windowStart, windowEnd]
        ).then((r) => r.rows).catch(() => [])
      : Promise.resolve([]),

    vehicleIds.length
      ? query(
          `SELECT maintenance_id, vehicle_id, maintenance_type, maintenance_date, completed_date, status
             FROM vehiclemaintenance
            WHERE vehicle_id = ANY($1) AND deleted_at IS NULL AND status <> 'Completed'`,
          [vehicleIds]
        ).then((r) => r.rows).catch(() => [])
      : Promise.resolve([]),

    // Custodial pairings (017) for every vehicle/driver on the page, fetched
    // once. Same SQL as the single path so the two cannot load different rows.
    query(ACTIVE_ASSIGNMENTS_SQL, [vehicleIds, driverIds]).then((r) => r.rows).catch(() => []),
  ]);

  const vehicleById = new Map(vehicles.map((v) => [v.vehicle_id, v]));
  const driverById = new Map(drivers.map((d) => [d.driver_id, d]));

  const uvvrpPolicy = await getUvvrpPolicy().catch(() => null);
  const exemptVehicleIds = uvvrpPolicy?.enabled
    ? await getExemptVehicleIds().catch(() => new Set())
    : new Set();

  for (const r of requests) {
    const vehicle = r.vehicle_id ? vehicleById.get(r.vehicle_id) ?? null : null;
    const driver = r.driver_id ? driverById.get(r.driver_id) ?? null : null;

    // Narrow the shared dispatch pool to the ones touching THIS request's
    // resources; evaluateRequestConflicts applies the window and self-exclusion.
    const relevant = dispatches.filter(
      (d) =>
        (vehicle && d.vehicle_id === vehicle.vehicle_id) ||
        (driver && d.driver_id === driver.driver_id)
    );

    let uvvrp = null;
    if (vehicle && uvvrpPolicy?.enabled && r.pickup_datetime) {
      const restricted = isRestricted(vehicle.plate_number, uvvrpPolicy, new Date(r.pickup_datetime));
      if (restricted) {
        uvvrp = {
          restricted: true,
          response: uvvrpPolicy.response,
          exempt: exemptVehicleIds.has(vehicle.vehicle_id),
          weekday: weekdayFor(r.pickup_datetime),
          digit: plateLastDigit(vehicle.plate_number),
        };
      }
    }

    out.set(
      r.request_id,
      // `assignments` is passed whole: the evaluator looks pairings up by exact
      // driver_id/vehicle_id, so unlike `dispatches` there is nothing to narrow.
      evaluateRequestConflicts(r, { vehicle, driver, dispatches: relevant, maintenance, assignments, uvvrp })
    );
  }

  return out;
}
