import { apiFetch, buildQuery } from "@/lib/api/client";

// Substitute driver schedules (migration 032) — which driver temporarily covers
// a vehicle while its designated custodian is unavailable. The recommendation
// engine and dispatch guard read these to resolve a vehicle's "effective driver
// for the requested date".

/**
 * List substitute schedules.
 * @param {{vehicle_id?: number, driver_id?: number, date?: string}} [filters]
 */
export async function getSubstituteSchedules(filters = {}) {
  return apiFetch(`/api/substitute-driver-schedules${buildQuery(filters)}`);
}

/**
 * Schedule a substitute driver to cover a vehicle.
 * @param {object} vars
 * @param {number}    vars.substitute_driver_id
 * @param {number}    vars.vehicle_id
 * @param {string}   [vars.effective_from]  YYYY-MM-DD (defaults to today)
 * @param {string}   [vars.effective_until] YYYY-MM-DD (omit for open-ended)
 * @param {string}   [vars.notes]
 */
export async function createSubstituteSchedule(vars) {
  return apiFetch("/api/substitute-driver-schedules", {
    method: "POST",
    body: {
      vehicle_id: vars.vehicle_id,
      substitute_driver_id: vars.substitute_driver_id,
      ...(vars.effective_from ? { effective_from: vars.effective_from } : {}),
      ...(vars.effective_until ? { effective_until: vars.effective_until } : {}),
      ...(vars.notes !== undefined ? { notes: vars.notes } : {}),
    },
  });
}

/**
 * Edit a substitute schedule's driver and/or dates.
 * @param {number} scheduleId
 * @param {object} vars
 */
export async function updateSubstituteSchedule(scheduleId, vars) {
  return apiFetch(`/api/substitute-driver-schedules/${scheduleId}`, {
    method: "PATCH",
    body: vars,
  });
}

/**
 * Remove a substitute schedule.
 * @param {number} scheduleId
 */
export async function deleteSubstituteSchedule(scheduleId) {
  return apiFetch(`/api/substitute-driver-schedules/${scheduleId}`, {
    method: "DELETE",
  });
}