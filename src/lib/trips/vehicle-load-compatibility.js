/** The stored request type must agree with the trip's assigned vehicle. */
export function checkVehicleLoadCompatibility({ loadType, operationalUse } = {}) {
  if (operationalUse !== 'Passenger' && operationalUse !== 'Cargo') {
    return { ok: false, reason: 'missing_operational_use' };
  }
  if (loadType == null) {
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
    case 'missing_operational_use':
      return 'The assigned vehicle has no valid operational use. Ask Fleet to set it to Passenger or Cargo.';
    case 'unknown_load_type':
      return 'This trip has an unsupported load type. Ask Dispatch to review the request.';
    case 'cargo_requires_typed_load':
      return 'This cargo vehicle needs a trip marked as Cargo. Ask Dispatch to review the request.';
    default:
      return 'The trip load type does not match the assigned vehicle. Ask Dispatch to correct the assignment.';
  }
}
