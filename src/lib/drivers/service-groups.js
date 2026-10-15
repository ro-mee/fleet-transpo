import { serviceLoadFor } from '@/lib/integration/contracts';

// Static driver classification gate (replaces the qualification review
// system): a Passenger driver never takes a cargo service and vice versa.
// The service group still comes from the stored catalog service code, so the
// mapping below is the only shared vocabulary between requests and drivers.

export function groupForService(serviceCode) {
  const load = serviceLoadFor(serviceCode);
  return load === 'Passenger' ? 'PASSENGER' : load === 'Cargo' ? 'CARGO' : null;
}

export function driverTypeForGroup(group) {
  return group === 'CARGO' ? 'Cargo' : group === 'PASSENGER' ? 'Passenger' : null;
}

// Pure, always blocking. Unknown services (legacy/custom rows with no group)
// and drivers with no recorded type are skipped, never blocked — absence of
// data must not brick an assignment.
export function driverTypeFinding({ driver = null, serviceCode = null } = {}) {
  const requiredGroup = groupForService(serviceCode);
  const expectedType = driverTypeForGroup(requiredGroup);
  const driverType = driver?.driver_type ?? null;
  if (!expectedType || !driverType || driverType === expectedType) return null;
  return {
    type: 'driver_type_mismatch',
    severity: 'blocking',
    message: `Driver is classified ${driverType} but ${serviceCode} needs a ${expectedType} driver. Reassign to a ${expectedType} driver or update the driver's classification.`,
    detail: {
      driver_id: driver?.driver_id ?? null,
      driver_type: driverType,
      required_group: requiredGroup,
      service_code: serviceCode ?? null,
    },
  };
}
