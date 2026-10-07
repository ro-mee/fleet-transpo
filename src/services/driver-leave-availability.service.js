import { query } from "@/lib/db";

/**
 * Transitional local provider for the operational leave data used by Fleet
 * availability checks. HR is the intended owner, but no HR contract or feed is
 * approved or connected yet. Keep this source behind one service boundary so a
 * future HR adapter can supply the same fields without changing dispatch
 * consumers.
 *
 * This intentionally returns only fields needed for availability. It does not
 * expose leave reasons, balances, reviewer notes, or request audit details.
 */
export async function loadDriverLeaveAvailability(driverIds) {
  const ids = [...new Set((driverIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return [];

  const { rows } = await query(
    `SELECT driver_id, start_date, end_date, start_time, end_time, status
       FROM driver_leave_requests
      WHERE driver_id = ANY($1) AND status IN ('Approved', 'Pending')`,
    [ids]
  );

  return rows;
}
