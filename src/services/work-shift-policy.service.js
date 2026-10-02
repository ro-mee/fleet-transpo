// Work shift policy data access and driver application service.
//
// Governs fleet-wide default operating hours, shift routines, and break periods
// stored in `system_settings` under the key 'work_shift_policy'.
import { query, withTransaction } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/system-settings";
import {
  DEFAULT_WORK_SHIFT_POLICY,
  mergeWorkShiftPolicy,
  validateWorkShiftPolicy,
  buildDriverWeeklySchedule,
} from "@/lib/work-shift-policy";

const SETTING_KEY = "work_shift_policy";

/**
 * Read the current work shift policy (falls back to defaults if not yet set).
 *
 * @param {object} [db] optional database runner (for use inside transactions)
 */
export async function getWorkShiftPolicy(db) {
  if (db?.query) {
    const { rows } = await db.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = $1`,
      [SETTING_KEY]
    );
    return mergeWorkShiftPolicy(rows[0]?.setting_value);
  }

  const raw = await getSetting(SETTING_KEY, DEFAULT_WORK_SHIFT_POLICY);
  return mergeWorkShiftPolicy(raw);
}

/**
 * Save a new work shift policy in system_settings.
 *
 * @param {object} policy candidate policy
 * @param {number|null} actorId employees.employee_id of the updater
 */
export async function saveWorkShiftPolicy(policy, actorId = null) {
  const check = validateWorkShiftPolicy(policy);
  if (!check.ok) {
    throw new Error(check.error);
  }

  const merged = mergeWorkShiftPolicy(policy);
  await setSetting(SETTING_KEY, merged, actorId ? Number(actorId) : null);
  return merged;
}

/**
 * Batch-apply the active work shift policy to driver weekly schedules with optional
 * staggered lunch breaks and distributed rest days for continuous 7-day fleet availability.
 *
 * @param {object} opts
 * @param {number[]} [opts.driverIds] optional array of driver_ids; if omitted, targets all active drivers
 * @param {boolean} [opts.staggerBreaks] whether to rotate break slots across drivers
 * @param {boolean} [opts.staggerRestDays] whether to distribute rest days across the week
 * @param {number|null} [opts.actorId] employee_id performing the batch update
 */
export async function applyWorkShiftPolicyToDrivers({
  driverIds,
  staggerBreaks,
  staggerRestDays,
  actorId = null,
} = {}) {
  const policy = await getWorkShiftPolicy();

  let targetSql = `SELECT driver_id FROM drivers WHERE deleted_at IS NULL`;
  const params = [];

  if (Array.isArray(driverIds) && driverIds.length > 0) {
    params.push(driverIds.map(Number));
    targetSql += ` AND driver_id = ANY($1)`;
  }
  targetSql += ` ORDER BY driver_id`;

  const { rows: drivers } = await query(targetSql, params);
  if (!drivers.length) {
    return { updatedCount: 0, driverIds: [], policy };
  }

  const effectiveStaggerBreaks = staggerBreaks !== undefined ? Boolean(staggerBreaks) : (policy.staggerBreaks ?? true);
  const effectiveStaggerRestDays = staggerRestDays !== undefined ? Boolean(staggerRestDays) : (policy.staggerRestDays ?? true);

  await withTransaction(async (tx) => {
    for (let i = 0; i < drivers.length; i++) {
      const d = drivers[i];
      const id = Number(d.driver_id);
      const weeklyRows = buildDriverWeeklySchedule(policy, i, {
        staggerBreaks: effectiveStaggerBreaks,
        staggerRestDays: effectiveStaggerRestDays,
      });

      for (const row of weeklyRows) {
        await tx.query(
          `INSERT INTO driver_work_schedules
             (driver_id, day_of_week, shift_start, shift_end, break_start, break_end, is_rest_day, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
           ON CONFLICT (driver_id, day_of_week) DO UPDATE SET
             shift_start=EXCLUDED.shift_start,
             shift_end=EXCLUDED.shift_end,
             break_start=EXCLUDED.break_start,
             break_end=EXCLUDED.break_end,
             is_rest_day=EXCLUDED.is_rest_day,
             updated_by=EXCLUDED.updated_by,
             updated_at=NOW()`,
          [
            id,
            row.day_of_week,
            row.shift_start,
            row.shift_end,
            row.break_start,
            row.break_end,
            row.is_rest_day,
            actorId ? Number(actorId) : null,
          ]
        );
      }
    }
  });

  return {
    updatedCount: drivers.length,
    driverIds: drivers.map((d) => Number(d.driver_id)),
    policy,
    staggerBreaks: effectiveStaggerBreaks,
    staggerRestDays: effectiveStaggerRestDays,
  };
}
