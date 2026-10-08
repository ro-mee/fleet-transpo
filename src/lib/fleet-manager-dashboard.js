import { toCalendarDay } from "@/lib/dates";

export function countApprovedLeaveForDay(rows, day) {
  if (!day) return 0;

  const peopleOnLeave = new Set();
  let anonymousRows = 0;

  for (const row of (rows || [])) {
    if (row?.status !== "Approved") continue;

    const start = toCalendarDay(row.start_date ?? row.startDate);
    const end = toCalendarDay(row.end_date ?? row.endDate);
    if (!start || !end || start > day || end < day) continue;

    const driverId = row.driver_id ?? row.driverId;
    if (driverId == null) {
      const leaveId = row.leave_request_id ?? row.id;
      if (leaveId == null) anonymousRows += 1;
      else peopleOnLeave.add(`request:${leaveId}`);
    } else {
      peopleOnLeave.add(`driver:${driverId}`);
    }
  }

  return peopleOnLeave.size + anonymousRows;
}

export function countOverdueScheduledMaintenance(rows, today) {
  if (!today) return 0;
  return (rows || []).filter((row) => {
    if (row?.status !== "Scheduled") return false;
    const maintenanceDay = toCalendarDay(row.maintenance_date);
    return maintenanceDay !== null && maintenanceDay < today;
  }).length;
}

export function getDashboardDispatchRows(dispatches, now = new Date(), limit = 5) {
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) return (dispatches?.pendingReassignment || []).slice(0, limit);

  const futureScheduled = (dispatches?.scheduled || [])
    .filter((item) => {
      const departure = new Date(item?.scheduled_departure).getTime();
      return Number.isFinite(departure) && departure > nowMs;
    })
    .sort((a, b) => new Date(a.scheduled_departure).getTime() - new Date(b.scheduled_departure).getTime());

  return [...(dispatches?.pendingReassignment || []), ...futureScheduled].slice(0, limit);
}
