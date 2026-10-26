import { VEHICLE_STATUS } from "@/lib/constants";
import { manilaDateKey, toCalendarDay } from "@/lib/dates";

export function getRelativeAssignedDuration(assignedFrom, reference = new Date()) {
  const startDay = toCalendarDay(assignedFrom);
  const today = manilaDateKey(reference);
  if (!startDay || !today) return null;
  const diffDays = Math.round((new Date(today) - new Date(startDay)) / 86400000);
  if (diffDays <= 0) return "Assigned today";
  if (diffDays === 1) return "1 day active";
  if (diffDays < 30) return `${diffDays} days active`;
  const diffMonths = Math.floor(diffDays / 30);
  return diffMonths === 1 ? "1 month active" : `${diffMonths} months active`;
}

export function getScheduleStatus(schedule, reference = new Date()) {
  const todayKey = manilaDateKey(reference);
  const from = toCalendarDay(schedule.effective_from);
  const until = toCalendarDay(schedule.effective_until);
  if (until && until < todayKey) return { label: "Expired", tone: "secondary", activeToday: false };
  if (from && from > todayKey) return { label: "Upcoming", tone: "info", activeToday: false };
  if (!until) return { label: "Open-Ended (Active)", tone: "primary", activeToday: true, openEnded: true };
  return { label: "Active Today", tone: "success", activeToday: true };
}

export function getFleetCustodyCoverage(assignments = [], vehicles = []) {
  const activeVehicleIds = new Set(
    vehicles
      .filter((vehicle) => vehicle?.deleted_at == null
        && vehicle?.vehicle_status !== VEHICLE_STATUS.DECOMMISSIONED
        && vehicle?.vehicle_id != null)
      .map((vehicle) => String(vehicle.vehicle_id))
  );
  const assignedActiveVehicleIds = new Set(
    assignments
      .filter((assignment) => assignment?.assigned_until == null && assignment?.vehicle_id != null)
      .map((assignment) => String(assignment.vehicle_id))
      .filter((vehicleId) => activeVehicleIds.has(vehicleId))
  );
  const totalVehicles = activeVehicleIds.size;
  const assignedVehicles = assignedActiveVehicleIds.size;

  return {
    assignedVehicles,
    totalVehicles,
    percent: totalVehicles > 0 ? Math.round((assignedVehicles / totalVehicles) * 100) : null,
  };
}
