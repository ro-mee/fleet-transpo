import { query, getAdminClient } from "@/lib/db";
import { isExpiredOn } from "@/lib/dates";
import {
  mergePolicy,
  weekdayFor,
  plateLastDigit,
  isRestricted,
  isExemptionActive,
  restrictedDigitsFor,
} from "@/lib/uvvrp/policy";

const POLICY_KEY = "uvvrp_policy";

/** Read the stored coding policy (defaults when unset). */
export async function getUvvrpPolicy() {
  const { rows } = await query(
    `SELECT setting_value FROM system_settings WHERE setting_key = $1`,
    [POLICY_KEY]
  );
  return mergePolicy(rows[0]?.setting_value);
}

/** Upsert the coding policy. Returns the merged (persisted) policy. */
export async function saveUvvrpPolicy(policy, actorId) {
  const merged = mergePolicy({
    ...policy,
    weekdayRestrictions: policy?.weekdayRestrictions || undefined,
    exemptionCategories: policy?.exemptionCategories || undefined,
  });
  await query(
    `INSERT INTO system_settings (setting_key, setting_value, updated_at, updated_by)
     VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (setting_key)
     DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
    [POLICY_KEY, JSON.stringify(merged), actorId || null]
  );
  return merged;
}

async function listActiveExemptions() {
  const { rows } = await query(
    `SELECT e.exemption_id, e.vehicle_id, e.category, e.reason, e.approved_by,
            e.approved_at, e.expires_on, e.active, v.plate_number
       FROM uvvrp_exemptions e
       LEFT JOIN vehicles v ON v.vehicle_id = e.vehicle_id
      WHERE e.active = TRUE
        AND (e.expires_on IS NULL OR e.expires_on >= CURRENT_DATE)
      ORDER BY e.approved_at DESC`
  );
  return rows;
}

/** Whether an active exemption (or an approved violation) covers this vehicle+date. */
async function hasCoverage(vehicleId, date) {
  const day = new Date(date);
  const exemptions = await listActiveExemptions();
  if (exemptions.some((e) => e.vehicle_id === vehicleId && isExemptionActive(e, day))) return true;

  const { rows } = await query(
    `SELECT violation_id FROM uvvrp_violations
      WHERE vehicle_id = $1 AND action = 'approved' AND scheduled_departure::date = $2::date
      LIMIT 1`,
    [vehicleId, day.toISOString()]
  );
  return rows.length > 0;
}

/**
 * Vehicle ids that are exempt from coding: those with an active exemption, or
 * with an approved violation (coarse — not date-scoped). Used by the queue
 * conflict chips; the dispatch gate (enforceCoding) is date-precise.
 */
export async function getExemptVehicleIds() {
  const exemptions = await listActiveExemptions();
  const { rows } = await query(
    `SELECT DISTINCT vehicle_id FROM uvvrp_violations WHERE action = 'approved'`
  );
  return new Set([...exemptions.map((e) => e.vehicle_id), ...rows.map((r) => r.vehicle_id)]);
}/**
 * Evaluate whether a vehicle is coding-restricted for a departure time.
 * Returns { restricted, weekday, digit, response, exempt } — exempt true when an
 * active exemption or an approved violation covers the window (then a retry or
 * an exempt vehicle passes).
 */
export async function evaluateCoding({ vehicleId, plateNumber, scheduledDeparture }) {
  const policy = await getUvvrpPolicy();
  if (!policy.enabled || !scheduledDeparture) {
    return { restricted: false, response: policy.response, weekday: null, digit: null, exempt: false };
  }
  const date = new Date(scheduledDeparture);
  const digit = plateLastDigit(plateNumber);
  const restricted = isRestricted(plateNumber, policy, date);
  const weekday = weekdayFor(date);

  if (!restricted) return { restricted: false, response: policy.response, weekday, digit, exempt: false };

  const exempt = await hasCoverage(vehicleId, date);
  return {
    restricted: true,
    response: policy.response,
    weekday,
    digit,
    exempt,
  };
}

/** Insert a coding violation record (the audit history row). */
export async function recordViolation({
  vehicleId,
  dispatchId = null,
  scheduledDeparture,
  weekday,
  plateDigit,
  action,
  reason = null,
  createdBy = null,
}) {
  const { rows } = await query(
    `INSERT INTO uvvrp_violations
       (vehicle_id, dispatch_id, scheduled_departure, weekday, plate_digit, action, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING violation_id`,
    [
      vehicleId,
      dispatchId,
      scheduledDeparture || null,
      weekday || null,
      plateDigit != null ? plateDigit : null,
      action,
      reason || null,
      createdBy || null,
    ]
  );
  return rows[0]?.violation_id ?? null;
}

/** Notify the given role ids (by employee) of a coding event. */
export async function notifyCoding({ title, message, roleIds = [1, 2, 3, 9] }) {
  try {
    const supabase = getAdminClient();
    const { data: employees } = await supabase
      .from("employees")
      .select("employee_id")
      .in("role_id", roleIds)
      .is("deleted_at", null);
    const empIds = (employees || []).map((emp) => emp.employee_id);
    if (!empIds.length) return;

    // Deduplicate: Don't create duplicate coding alert if an unread or recent notification with the same message was sent in last 15 mins
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from("notifications")
      .select("employee_id, message")
      .in("employee_id", empIds)
      .gte("sent_at", fifteenMinsAgo);

    const recentSet = new Set((recent || []).map((r) => `${r.employee_id}:${r.message}`));

    const rows = empIds
      .filter((id) => !recentSet.has(`${id}:${message}`))
      .map((id) => ({
        employee_id: id,
        title,
        message,
        type: "Warning",
        reference_type: "uvvrp",
      }));

    if (rows.length) await supabase.from("notifications").insert(rows);
  } catch (e) {
    console.warn("notifyCoding failed:", e?.message || e);
  }
}

/**
 * Enforce the coding policy at dispatch time. Records the violation, notifies
 * staff, and returns whether the dispatch may proceed:
 *   block   → { ok:false, status:409 }
 *   warn    → { ok:true }  (violation recorded as warned)
 *   approve → { ok:false, status:409 } + pending_approval violation
 * A restricted vehicle with an active exemption or an approved violation for
 * that date passes ({ ok:true }).
 */
export async function enforceCoding({
  vehicleId,
  plateNumber,
  scheduledDeparture,
  dispatchId = null,
  createdBy = null,
}) {
  const result = await evaluateCoding({ vehicleId, plateNumber, scheduledDeparture });
  if (!result.restricted || result.exempt) return { ok: true, result };

  const { response, weekday, digit } = result;
  const label = plateNumber || `#${vehicleId}`;
  const message = `Vehicle ${label} is number-coding restricted (ends ${digit}) on ${weekday}.`;

  if (response === "block") {
    await recordViolation({ vehicleId, dispatchId, scheduledDeparture, weekday, plateDigit: digit, action: "blocked", reason: message, createdBy });
    await notifyCoding({ title: "Dispatch blocked by number coding", message });
    return { ok: false, status: 409, message };
  }

  if (response === "warn") {
    await recordViolation({ vehicleId, dispatchId, scheduledDeparture, weekday, plateDigit: digit, action: "warned", reason: message, createdBy });
    await notifyCoding({ title: "Number coding warning", message });
    return { ok: true, result };
  }

  // approve → defer the dispatch until an authorized role approves.
  await recordViolation({ vehicleId, dispatchId, scheduledDeparture, weekday, plateDigit: digit, action: "pending_approval", reason: message, createdBy });
  await notifyCoding({ title: "Dispatch requires coding approval", message, roleIds: [1, 2, 9] });
  return {
    ok: false,
    status: 409,
    message: `${message} This dispatch requires approval from Fleet Manager or Admin before it can proceed.`,
  };
}

// ---------------------------------------------------------------------------
// Exemptions
// ---------------------------------------------------------------------------

export async function listExemptions() {
  const { rows } = await query(
    `SELECT e.exemption_id, e.vehicle_id, e.category, e.reason, e.approved_by,
            e.approved_at, e.expires_on, e.active, e.created_at,
            v.plate_number,
            CASE WHEN emp.employee_id IS NULL THEN NULL ELSE
              json_build_object('employee_id', emp.employee_id, 'first_name', emp.first_name, 'last_name', emp.last_name)
            END AS approver
       FROM uvvrp_exemptions e
       LEFT JOIN vehicles v ON v.vehicle_id = e.vehicle_id
       LEFT JOIN employees emp ON emp.employee_id = e.approved_by
      ORDER BY e.active DESC, e.approved_at DESC`
  );
  return rows;
}

export async function createExemption({ vehicleId, category, reason = null, expiresOn = null, approvedBy }) {
  const { rows } = await query(
    `INSERT INTO uvvrp_exemptions (vehicle_id, category, reason, approved_by, expires_on, active)
     VALUES ($1, $2, $3, $4, $5, TRUE)
     RETURNING exemption_id, vehicle_id, category, reason, approved_by, expires_on, active`,
    [vehicleId, category, reason || null, approvedBy || null, expiresOn || null]
  );
  return rows[0];
}

export async function setExemptionActive(id, { active, expiresOn, actorId }) {
  const { rows } = await query(
    `UPDATE uvvrp_exemptions
        SET active = $2,
            expires_on = COALESCE($3, expires_on),
            updated_at = NOW()
      WHERE exemption_id = $1
      RETURNING exemption_id, vehicle_id, category, active, expires_on`,
    [id, active === true, expiresOn ?? null, actorId]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Violations
// ---------------------------------------------------------------------------

export async function listViolations({ limit = 100 } = {}) {
  const { rows } = await query(
    `SELECT v.violation_id, v.vehicle_id, v.dispatch_id, v.scheduled_departure,
            v.weekday, v.plate_digit, v.action, v.reason, v.created_at,
            v.decided_by, v.decided_at, v.decision_reason,
            veh.plate_number,
            CASE WHEN dec.employee_id IS NULL THEN NULL ELSE
              json_build_object('employee_id', dec.employee_id, 'first_name', dec.first_name, 'last_name', dec.last_name)
            END AS decided_by_user
       FROM uvvrp_violations v
       LEFT JOIN vehicles veh ON veh.vehicle_id = v.vehicle_id
       LEFT JOIN employees dec ON dec.employee_id = v.decided_by
      ORDER BY v.created_at DESC
      LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 100, 1), 500)]
  );
  return rows;
}

export async function listPendingApprovals() {
  const { rows } = await query(
    `SELECT v.violation_id, v.vehicle_id, v.scheduled_departure, v.weekday, v.plate_digit,
            v.created_at, veh.plate_number
       FROM uvvrp_violations v
       LEFT JOIN vehicles veh ON veh.vehicle_id = v.vehicle_id
      WHERE v.action = 'pending_approval'
      ORDER BY v.created_at DESC
      LIMIT 100`
  );
  return rows;
}

export async function decideViolation(id, { approve, reason, decidedBy }) {
  const { rows } = await query(
    `UPDATE uvvrp_violations
        SET action = $2, decided_by = $3, decided_at = NOW(), decision_reason = $4
      WHERE violation_id = $1
      RETURNING violation_id, vehicle_id, scheduled_departure, action, decided_by, decided_at, decision_reason`,
    [id, approve === true ? "approved" : "denied", decidedBy || null, reason || null]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Board aggregates (read-only)
// ---------------------------------------------------------------------------

export async function getBoardData({ date } = {}) {
  const policy = await getUvvrpPolicy();
  const target = date ? new Date(date) : new Date();
  const weekday = weekdayFor(target);
  const digits = restrictedDigitsFor(policy, target);

  const { rows: vehicles } = await query(
    `SELECT vehicle_id, plate_number, vehicle_status FROM vehicles WHERE deleted_at IS NULL ORDER BY plate_number`
  );

  const exemptions = await listActiveExemptions();
  const exemptVehicleIds = new Set(exemptions.map((e) => e.vehicle_id));

  const restrictedToday = [];
  for (const v of vehicles) {
    const r = isRestricted(v.plate_number, policy, target);
    if (r) {
      restrictedToday.push({
        vehicle_id: v.vehicle_id,
        plate_number: v.plate_number,
        vehicle_status: v.vehicle_status,
        exempt: exemptVehicleIds.has(v.vehicle_id),
      });
    }
  }

  const upcoming = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(target);
    d.setDate(target.getDate() + i);
    const dayDigits = restrictedDigitsFor(policy, d);
    upcoming.push({
      date: d.toISOString().slice(0, 10),
      weekday: weekdayFor(d),
      digits: dayDigits,
      restrictedCount: dayDigits.length
        ? vehicles.filter((v) => {
            const digit = plateLastDigit(v.plate_number);
            return digit != null && dayDigits.includes(digit) && !exemptVehicleIds.has(v.vehicle_id);
          }).length
        : 0,
    });
  }

  const violations = await listViolations({ limit: 100 });
  const dispatchesAffected = violations.filter((v) => v.dispatch_id != null);

  return {
    enabled: policy.enabled,
    location: policy.location,
    response: policy.response,
    weekday,
    restrictedDigits: digits,
    restrictedToday,
    exemptions,
    upcoming,
    violations,
    dispatchesAffected,
  };
}

// ---------------------------------------------------------------------------
// Pair-coupled travel availability (vehicles + their custodial drivers).
//
// A vehicle and its active paired driver travel as one unit: if either cannot
// operate on the travel date (coding, registration/insurance, license, or duty
// status), the pair is unusable. These helpers let both picker endpoints
// (vehicles/available and drivers) hide a pair when either side is invalid.
// ---------------------------------------------------------------------------

/** Active custodial pairings (migration 017): assigned_until IS NULL = active. */
export async function getActivePairings() {
  const { rows } = await query(
    `SELECT a.driver_id, a.vehicle_id FROM driver_vehicle_assignments a WHERE a.assigned_until IS NULL`
  );
  return rows;
}

/**
 * Context for vehicle travel checks. driverById maps paired driver_id -> the
 * driver's license_expiry + driver_status (the fields travel-ability needs).
 */
export async function loadVehicleTravelContext(date) {
  const policy = await getUvvrpPolicy();
  const exemptVehicleIds = policy?.enabled ? await getExemptVehicleIds() : new Set();
  const pairings = await getActivePairings();
  const driverIds = [...new Set(pairings.map((p) => p.driver_id).filter(Boolean))];
  const driverRows = driverIds.length
    ? (await query(
        `SELECT driver_id, license_expiry, driver_status FROM drivers WHERE driver_id = ANY($1)`,
        [driverIds]
      )).rows
    : [];
  return {
    policy,
    exemptVehicleIds,
    pairings,
    driverById: new Map(driverRows.map((d) => [d.driver_id, d])),
    date: date ? new Date(date) : new Date(),
  };
}

/**
 * Context for driver travel checks. vehicleById maps paired vehicle_id -> the
 * vehicle's plate + registration/insurance expiry (the fields travel-ability needs).
 */
export async function loadDriverTravelContext(date) {
  const policy = await getUvvrpPolicy();
  const exemptVehicleIds = policy?.enabled ? await getExemptVehicleIds() : new Set();
  const pairings = await getActivePairings();
  const vehicleIds = [...new Set(pairings.map((p) => p.vehicle_id).filter(Boolean))];
  const vehicleRows = vehicleIds.length
    ? (await query(
        `SELECT vehicle_id, plate_number, registration_expiry, insurance_expiry FROM vehicles WHERE vehicle_id = ANY($1)`,
        [vehicleIds]
      )).rows
    : [];
  return {
    policy,
    exemptVehicleIds,
    pairings,
    vehicleById: new Map(vehicleRows.map((v) => [v.vehicle_id, v])),
    date: date ? new Date(date) : new Date(),
  };
}

/** Whether a vehicle can travel on the context date (own docs + paired driver). */
export function vehicleCanTravel(v, ctx) {
  const date = ctx?.date ?? new Date();
  if (isExpiredOn(v.registration_expiry, date) || isExpiredOn(v.insurance_expiry, date)) return false;
  if (ctx.policy?.enabled && !ctx.exemptVehicleIds?.has?.(v.vehicle_id) && v.plate_number) {
    if (isRestricted(v.plate_number, ctx.policy, date)) return false;
  }
  const pairing = ctx?.pairings?.find?.((p) => p.vehicle_id === v.vehicle_id);
  if (pairing?.driver_id) {
    const d = ctx?.driverById?.get?.(pairing.driver_id);
    if (!d) return false;
    if (isExpiredOn(d.license_expiry, date)) return false;
    if (["Suspended", "On Leave", "Off Duty"].includes(d.driver_status)) return false;
  }
  return true;
}

/** Whether a driver can travel on the context date (own license + paired vehicle). */
export function driverCanTravel(d, ctx) {
  const date = ctx?.date ?? new Date();
  if (isExpiredOn(d.license_expiry, date)) return false;
  const pairing = ctx?.pairings?.find?.((p) => p.driver_id === d.driver_id);
  if (pairing?.vehicle_id) {
    const v = ctx?.vehicleById?.get?.(pairing.vehicle_id);
    if (!v) return false;
    if (isExpiredOn(v.registration_expiry, date) || isExpiredOn(v.insurance_expiry, date)) return false;
    if (ctx.policy?.enabled && !ctx.exemptVehicleIds?.has?.(v.vehicle_id) && v.plate_number) {
      if (isRestricted(v.plate_number, ctx.policy, date)) return false;
    }
  }
  return true;
}
