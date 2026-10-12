function getOperationalUse(vehicle) {
  return vehicle?.operational_use ?? vehicle?.operationalUse ?? null;
}

function getVehicleId(vehicle, isTrip) {
  if (isTrip) return vehicle?.vehicle_id ?? null;
  return vehicle?.vehicleId ?? vehicle?.vehicle_id ?? vehicle?.id ?? null;
}

export function resolveDriverWorkspace({ driverType, trip, assignedVehicle } = {}) {
  const hasTrip = trip != null;
  const vehicle = hasTrip ? trip : assignedVehicle;
  const source = hasTrip ? 'trip' : vehicle ? 'standing_assignment' : null;
  const vehicleId = getVehicleId(vehicle, hasTrip);
  const operationalUse = getOperationalUse(vehicle);
  const mode = driverType === 'Passenger' ? 'passenger' : driverType === 'Cargo' ? 'cargo' : 'unclassified';
  const tripReady = hasTrip ? false : null;
  const result = (reason, ready = tripReady) => ({
    mode,
    tripReady: ready,
    vehicleId,
    operationalUse,
    source,
    reason,
  });

  if (mode === 'unclassified') {
    return result(driverType == null || driverType === '' ? 'missing_driver_type' : 'unsupported_driver_type');
  }
  if (!vehicleId) return result('no_vehicle');
  if (operationalUse !== 'Passenger' && operationalUse !== 'Cargo') return result('missing_operational_use');
  if (operationalUse !== driverType) return result('driver_vehicle_mismatch');
  if (!hasTrip) return result(null);

  if (trip.load_type == null || trip.load_type === '') {
    return driverType === 'Passenger' ? result(null, true) : result('missing_trip_type');
  }
  if (trip.load_type !== driverType) return result('trip_type_mismatch');

  return result(null, true);
}
