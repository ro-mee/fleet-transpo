// Driver work-schedule + leave data access (migration 049).
//
// Data shape: `loadDriverScheduleContext` returns context maps consumed by
// `driverBlockReason` (src/lib/scheduling/driver-schedule.js). Everything that
// filters a driver by schedule/leave — the picker endpoints, pairing checks,
// conflict detection, trip-start guard — loads one context for the driver set
// it cares about and calls the pure helper. Load the context once per request,
// never per driver, to keep the query count flat.
import { query, withTransaction } from "@/lib/db";

/** Approved-leave + work-schedule context for a set of driver ids. */
export async function loadDriverScheduleContext(driverIds) {
  const ids = [...new Set((driverIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return { schedules: new Map(), leave: new Map() };

  const [sched, leaveRows] = await Promise.all([
    query(
      `SELECT schedule_id, driver_id, day_of_week, shift_start, shift_end, break_start, break_end, is_rest_day
         FROM driver_work_schedules
        WHERE driver_id = ANY($1)
        ORDER BY day_of_week`,
      [ids]
    ),
    query(
      `SELECT leave_request_id, driver_id, start_date, end_date, start_time, end_time, leave_type, status
         FROM driver_leave_requests
        WHERE driver_id = ANY($1) AND status IN ('Approved', 'Pending')`,
      [ids]
    ),
  ]);

  const schedules = new Map();
  for (const row of sched.rows) {
    const id = Number(row.driver_id);
    if (!schedules.has(id)) schedules.set(id, new Map());
    schedules.get(id).set(Number(row.day_of_week), row);
  }

  const leave = new Map();
  for (const row of leaveRows.rows) {
    const id = Number(row.driver_id);
    if (!leave.has(id)) leave.set(id, []);
    leave.get(id).push(row);
  }

  return { schedules, leave };
}

/** All 7 rows (or fewer, when gaps exist) for one driver, day ascending. */
export async function listWorkSchedules(driverId) {
  const { rows } = await query(
    `SELECT schedule_id, driver_id, day_of_week, shift_start, shift_end, break_start, break_end, is_rest_day
       FROM driver_work_schedules
      WHERE driver_id = $1
      ORDER BY day_of_week`,
    [Number(driverId)]
  );
  return rows;
}

/**
 * Replace a driver's weekly schedule with `days`, atomically.
 *
 * days entries: { day_of_week, shift_start, shift_end, break_start?, break_end?,
 * is_rest_day }. Rest-day rows are stored with a 00:00–00:00 shift so the
 * CHECKs hold; the DB UNIQUE(driver_id, day_of_week) makes the upsert idempotent.
 */
export async function saveWorkSchedule(driverId, days, actorId) {
  const driver = Number(driverId);
  const rows = (Array.isArray(days) ? days : []).filter(
    (d) => Number.isInteger(Number(d.day_of_week)) && Number(d.day_of_week) >= 0 && Number(d.day_of_week) <= 6
  );

  await withTransaction(async (tx) => {
    await tx.query(`DELETE FROM driver_work_schedules WHERE driver_id = $1`, [driver]);
    for (const d of rows) {
      const rest = Boolean(d.is_rest_day);
      await tx.query(
        `INSERT INTO driver_work_schedules
           (driver_id, day_of_week, shift_start, shift_end, break_start, break_end, is_rest_day, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [
          driver,
          Number(d.day_of_week),
          rest ? "00:00:00" : d.shift_start || null,
          rest ? "00:00:00" : d.shift_end || null,
          rest ? null : d.break_start || null,
          rest ? null : d.break_end || null,
          rest,
          actorId ? Number(actorId) : null,
        ]
      );
    }
  });
  return listWorkSchedules(driver);
}

/** A driver's leave requests, newest first. */
export async function listLeaveRequests(driverId) {
  const { rows } = await query(
    `SELECT leave_request_id, driver_id, start_date::text AS start_date, end_date::text AS end_date, start_time, end_time, leave_type, reason, status, requested_at, reviewed_by, reviewed_at, review_notes
       FROM driver_leave_requests
      WHERE driver_id = $1
      ORDER BY requested_at DESC`,
    [Number(driverId)]
  );
  return rows;
}

/** Create a pending leave request for a driver (driver self-service). */
export async function createLeaveRequest(driverId, data, requestedAt = new Date()) {
  const { rows } = await query(
    `INSERT INTO driver_leave_requests
       (driver_id, start_date, end_date, start_time, end_time, leave_type, reason, requested_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      Number(driverId),
      data.start_date,
      data.end_date,
      data.start_time || null,
      data.end_time || null,
      data.leave_type || "Vacation",
      data.reason || null,
      requestedAt,
    ]
  );
  return rows[0];
}

/** All leave requests (optionally for one driver), newest first. */
export async function listAllLeaveRequests({ driverId } = {}) {
  const { rows } = await query(
    `SELECT lr.leave_request_id, lr.driver_id, lr.start_date::text AS start_date, lr.end_date::text AS end_date, lr.start_time, lr.end_time, lr.leave_type, lr.reason, lr.status,
            lr.requested_at, lr.reviewed_by, lr.reviewed_at, lr.review_notes,
            json_build_object('employee_id', e.employee_id, 'first_name', e.first_name, 'last_name', e.last_name) AS driver
       FROM driver_leave_requests lr
       LEFT JOIN drivers d ON d.driver_id = lr.driver_id
       LEFT JOIN employees e ON e.employee_id = d.employee_id
      WHERE ($1::int IS NULL OR lr.driver_id = $1::int)
      ORDER BY lr.requested_at DESC`,
    [driverId ? Number(driverId) : null]
  );
  return rows;
}

/**
 * Approve or decline a leave request. Declining always works; approving is
 * rejected with 409 when an overlapping request is already Approved.
 */
export async function reviewLeaveRequest(leaveRequestId, status, reviewerId, notes = null) {
  if (!["Approved", "Declined"].includes(status)) {
    const e = new Error("status must be Approved or Declined");
    e.status = 400;
    throw e;
  }
  const id = Number(leaveRequestId);

  return withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `SELECT driver_id, start_date, end_date, leave_type FROM driver_leave_requests WHERE leave_request_id = $1`,
      [id]
    );
    const current = rows[0];
    if (!current) {
      const e = new Error("Leave request not found");
      e.status = 404;
      throw e;
    }

    if (status === "Approved") {
      const { rows: overlap } = await tx.query(
        `SELECT leave_request_id FROM driver_leave_requests
          WHERE driver_id = $1 AND status = 'Approved'
            AND leave_request_id <> $2
            AND start_date <= $3 AND end_date >= $4`,
        [current.driver_id, id, current.end_date, current.start_date]
      );
      if (overlap.length) {
        const e = new Error("This driver already has an approved leave that overlaps these dates.");
        e.status = 409;
        throw e;
      }

      // Balance deduction
      const msPerDay = 1000 * 60 * 60 * 24;
      const days = Math.max(1, Math.round((new Date(current.end_date) - new Date(current.start_date)) / msPerDay) + 1);
      await tx.query(
        `UPDATE driver_leave_balances
            SET used_days = used_days + $1
          WHERE driver_id = $2 AND leave_type = $3`,
        [days, current.driver_id, current.leave_type]
      );

      // Auto-reassignment of overlapping trips
      await tx.query(
        `UPDATE dispatchschedules
            SET status = 'Pending Reassignment', driver_id = NULL
          WHERE driver_id = $1 
            AND status IN ('Scheduled', 'In Progress')
            AND DATE(scheduled_departure) <= $2 
            AND DATE(scheduled_arrival) >= $3`,
        [current.driver_id, current.end_date, current.start_date]
      );
    }

    const { rows: updated } = await tx.query(
      `UPDATE driver_leave_requests
          SET status = $2, reviewed_by = $3, reviewed_at = NOW(), review_notes = $4
        WHERE leave_request_id = $1
        RETURNING *`,
      [id, status, reviewerId ? Number(reviewerId) : null, notes]
    );
    return updated[0];
  });
}
