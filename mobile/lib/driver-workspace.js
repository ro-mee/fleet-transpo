function getOperationalUse(vehicle) {
  return vehicle?.operational_use ?? vehicle?.operationalUse ?? null;
}

function getVehicleId(vehicle, isTrip) {
  if (isTrip) return vehicle?.vehicle_id ?? null;
  return vehicle?.vehicleId ?? vehicle?.vehicle_id ?? vehicle?.id ?? null;
}

function getMode(operationalUse) {
  if (operationalUse === 'Cargo') return 'cargo';
  if (operationalUse === 'Passenger') return 'passenger';
  return 'unassigned';
}

export function resolveDriverWorkspace({ trip, assignedVehicle } = {}) {
  const hasTrip = trip != null;
  const vehicle = hasTrip ? trip : assignedVehicle;
  const source = hasTrip ? 'trip' : vehicle ? 'standing_assignment' : null;
  const vehicleId = getVehicleId(vehicle, hasTrip);
  const operationalUse = getOperationalUse(vehicle);
  const mode = getMode(operationalUse);
  const tripReadyWhenSupplied = hasTrip ? false : null;

  if (!vehicleId) {
    return {
      mode: 'unassigned',
      tripReady: tripReadyWhenSupplied,
      vehicleId: null,
      operationalUse,
      source,
      reason: 'no_vehicle',
    };
  }

  if (mode === 'unassigned') {
    return {
      mode,
      tripReady: tripReadyWhenSupplied,
      vehicleId,
      operationalUse,
      source,
      reason: 'missing_operational_use',
    };
  }

  if (!hasTrip) {
    return { mode, tripReady: null, vehicleId, operationalUse, source, reason: null };
  }

  if (trip.load_type == null || trip.load_type === '') {
    if (operationalUse === 'Cargo') {
      return { mode, tripReady: false, vehicleId, operationalUse, source, reason: 'missing_trip_type' };
    }
    return { mode, tripReady: true, vehicleId, operationalUse, source, reason: null };
  }

  if (trip.load_type !== operationalUse) {
    return { mode, tripReady: false, vehicleId, operationalUse, source, reason: 'trip_type_mismatch' };
  }

  return { mode, tripReady: true, vehicleId, operationalUse, source, reason: null };
}
