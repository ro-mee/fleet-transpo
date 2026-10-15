export function normalizeVehicleId(value) {
  return value === null || value === undefined || value === "" ? "" : String(value);
}

export function normalizeMaintenanceMileage(value) {
  return value === null || value === undefined || value === "" ? "" : String(value);
}

export function selectMaintenanceVehicle(formData, vehicleId, vehicles = []) {
  const selectedId = normalizeVehicleId(vehicleId);
  const selectedVehicle = selectedId
    ? vehicles.find((vehicle) => normalizeVehicleId(vehicle.vehicle_id) === selectedId)
    : null;

  return {
    ...formData,
    vehicle_id: selectedId,
    mileage_at_service: normalizeMaintenanceMileage(selectedVehicle?.mileage),
  };
}
