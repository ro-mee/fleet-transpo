/** The stored driver, vehicle, and request types must agree before work is assigned. */
export function checkVehicleLoadCompatibility(input = {}) {
  const { driverType, operationalUse, loadType, requireTypedLoad = true } = input;
  const hasDriverType = Object.hasOwn(input, 'driverType');
  if (hasDriverType) {
    if (driverType == null || driverType === '') return { ok: false, reason: 'missing_driver_type' };
    if (driverType !== 'Passenger' && driverType !== 'Cargo') return { ok: false, reason: 'unsupported_driver_type' };
  }
  if (operationalUse !== 'Passenger' && operationalUse !== 'Cargo') {
    return { ok: false, reason: 'missing_operational_use' };
  }
  if (hasDriverType && driverType !== operationalUse) {
    return { ok: false, reason: 'driver_vehicle_mismatch' };
  }
  if (loadType == null) {
    if (requireTypedLoad === false) return { ok: true, reason: null };
    return operationalUse === 'Passenger'
      ? { ok: true, reason: null }
      : { ok: false, reason: 'cargo_requires_typed_load' };
  }
  if (loadType !== 'Passenger' && loadType !== 'Cargo') {
    return { ok: false, reason: 'unknown_load_type' };
  }
  return loadType === operationalUse
    ? { ok: true, reason: null }
    : { ok: false, reason: 'type_mismatch' };
}

export function vehicleLoadCompatibilityMessage(reason) {
  switch (reason) {
    case 'missing_driver_type':
      return 'Driver classification needs setup. Ask Fleet to set it to Passenger or Cargo.';
    case 'unsupported_driver_type':
      return 'Driver classification is not supported. Ask Fleet to correct it before assigning work.';
    case 'driver_vehicle_mismatch':
      return 'Driver classification does not match this vehicle. Ask Fleet to correct the pairing.';
    case 'missing_operational_use':
      return 'The assigned vehicle has no valid operational use. Ask Fleet to set it to Passenger or Cargo.';
    case 'unknown_load_type':
      return 'This trip has an unsupported load type. Ask Dispatch to review the request.';
    case 'cargo_requires_typed_load':
      return 'This cargo vehicle needs a trip marked as Cargo. Ask Dispatch to review the request.';
    case 'assignment_not_found':
      return 'The selected driver or vehicle is no longer available. Reload and try again.';
    case 'request_not_found':
      return 'The selected request is no longer available. Reload and try again.';
    default:
      return 'The trip load type does not match the assigned vehicle. Ask Dispatch to correct the assignment.';
  }
}

/** Recheck the stored classification rows while the caller's write transaction is open. */
export async function assertStoredVehicleLoadCompatibility({ db, driverId, vehicleId, requestId = null, requireTypedLoad = requestId != null }) {
  const { rows: assignments } = await db.query(
    `SELECT d.driver_type, v.operational_use
       FROM drivers d
       JOIN vehicles v ON v.vehicle_id = $2 AND v.deleted_at IS NULL
      WHERE d.driver_id = $1 AND d.deleted_at IS NULL
      FOR SHARE OF d, v`,
    [driverId, vehicleId]
  );
  if (!assignments[0]) throw vehicleLoadCompatibilityError('assignment_not_found');

  let loadType = null;
  if (requestId != null) {
    const { rows } = await db.query(
      `SELECT request_id, load_type
         FROM transportation_requests
        WHERE request_id = $1 AND deleted_at IS NULL
        FOR SHARE`,
      [requestId]
    );
    if (!rows[0]) throw vehicleLoadCompatibilityError('request_not_found');
    loadType = rows[0].load_type ?? null;
  }

  const verdict = checkVehicleLoadCompatibility({
    driverType: assignments[0].driver_type,
    operationalUse: assignments[0].operational_use,
    loadType,
    requireTypedLoad,
  });
  if (!verdict.ok) throw vehicleLoadCompatibilityError(verdict.reason);
  return verdict;
}

function vehicleLoadCompatibilityError(reason) {
  return Object.assign(new Error(vehicleLoadCompatibilityMessage(reason)), {
    status: 409,
    code: 'VEHICLE_LOAD_INCOMPATIBLE',
    reason,
  });
}
