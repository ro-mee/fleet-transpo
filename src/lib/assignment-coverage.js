import { VEHICLE_STATUS } from "@/lib/constants";

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
