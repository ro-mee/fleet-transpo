import { expect, it } from 'vitest';
import { checkVehicleLoadCompatibility } from './vehicle-load-compatibility';

it.each([
  ['Passenger', 'Passenger', 'Passenger'],
  ['Cargo', 'Cargo', 'Cargo'],
])('allows a %s driver, %s vehicle, and %s request', (driverType, operationalUse, loadType) => {
  expect(checkVehicleLoadCompatibility({ driverType, operationalUse, loadType })).toEqual({ ok: true, reason: null });
});

it.each([
  [{ driverType: 'Passenger', operationalUse: 'Cargo', loadType: 'Passenger' }, 'driver_vehicle_mismatch'],
  [{ driverType: 'Cargo', operationalUse: 'Passenger', loadType: 'Cargo' }, 'driver_vehicle_mismatch'],
  [{ driverType: 'Passenger', operationalUse: 'Passenger', loadType: 'Cargo' }, 'type_mismatch'],
  [{ driverType: 'Cargo', operationalUse: 'Cargo', loadType: 'Passenger' }, 'type_mismatch'],
  [{ driverType: null, operationalUse: 'Passenger', loadType: 'Passenger' }, 'missing_driver_type'],
  [{ driverType: '', operationalUse: 'Passenger', loadType: 'Passenger' }, 'missing_driver_type'],
  [{ driverType: 'Heavy', operationalUse: 'Cargo', loadType: 'Cargo' }, 'unsupported_driver_type'],
  [{ driverType: 'Passenger', operationalUse: null, loadType: 'Passenger' }, 'missing_operational_use'],
  [{ driverType: 'Passenger', operationalUse: 'Bus', loadType: 'Passenger' }, 'missing_operational_use'],
  [{ driverType: 'Passenger', operationalUse: 'Passenger', loadType: 'Parcel' }, 'unknown_load_type'],
  [{ driverType: 'Cargo', operationalUse: 'Cargo', loadType: null }, 'cargo_requires_typed_load'],
])('rejects stored assignment %j', (input, reason) => {
  expect(checkVehicleLoadCompatibility(input)).toEqual({ ok: false, reason });
});

it.each([
  [{ driverType: 'Passenger', operationalUse: 'Passenger', loadType: null }, true],
  [{ driverType: 'Passenger', operationalUse: 'Passenger', loadType: undefined }, true],
  [{ driverType: 'Cargo', operationalUse: 'Cargo', loadType: null, requireTypedLoad: false }, true],
  [{ driverType: 'Passenger', operationalUse: 'Cargo', loadType: null, requireTypedLoad: false }, false],
])('handles a legacy request or an unrequested custodian pair: %j', (input, ok) => {
  expect(checkVehicleLoadCompatibility(input).ok).toBe(ok);
});

it.each([
  [{ operationalUse: 'Passenger', loadType: 'Passenger' }, true],
  [{ operationalUse: 'Cargo', loadType: null }, false],
  [{ operationalUse: null, loadType: 'Passenger' }, false],
])('keeps the existing trip-only contract when no driverType was supplied: %j', (input, ok) => {
  expect(checkVehicleLoadCompatibility(input).ok).toBe(ok);
});
