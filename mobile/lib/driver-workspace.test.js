import { describe, expect, it } from 'vitest';
import { resolveDriverWorkspace } from './driver-workspace.js';

const result = (mode, overrides = {}) => ({
  mode,
  tripReady: null,
  vehicleId: null,
  operationalUse: null,
  source: null,
  reason: null,
  ...overrides,
});

describe('resolveDriverWorkspace', () => {
  it.each([
    ['Passenger driver and Passenger trip', { driverType: 'Passenger', trip: { vehicle_id: 'p1', operational_use: 'Passenger', load_type: 'Passenger' } }, result('passenger', { tripReady: true, vehicleId: 'p1', operationalUse: 'Passenger', source: 'trip' })],
    ['Cargo driver and Cargo trip', { driverType: 'Cargo', trip: { vehicle_id: 'c1', operational_use: 'Cargo', load_type: 'Cargo' } }, result('cargo', { tripReady: true, vehicleId: 'c1', operationalUse: 'Cargo', source: 'trip' })],
    ['Passenger driver with Cargo vehicle', { driverType: 'Passenger', assignedVehicle: { id: 'c2', operational_use: 'Cargo' } }, result('passenger', { vehicleId: 'c2', operationalUse: 'Cargo', source: 'standing_assignment', reason: 'driver_vehicle_mismatch' })],
    ['Cargo driver with Passenger vehicle', { driverType: 'Cargo', assignedVehicle: { id: 'p2', operational_use: 'Passenger' } }, result('cargo', { vehicleId: 'p2', operationalUse: 'Passenger', source: 'standing_assignment', reason: 'driver_vehicle_mismatch' })],
    ['Passenger driver with Cargo trip', { driverType: 'Passenger', trip: { vehicle_id: 'c3', operational_use: 'Cargo', load_type: 'Cargo' } }, result('passenger', { tripReady: false, vehicleId: 'c3', operationalUse: 'Cargo', source: 'trip', reason: 'driver_vehicle_mismatch' })],
    ['Cargo driver with Passenger trip', { driverType: 'Cargo', trip: { vehicle_id: 'p3', operational_use: 'Passenger', load_type: 'Passenger' } }, result('cargo', { tripReady: false, vehicleId: 'p3', operationalUse: 'Passenger', source: 'trip', reason: 'driver_vehicle_mismatch' })],
    ['Hotel service uses shared Cargo mode', { driverType: 'Cargo', trip: { vehicle_id: 'c4', operational_use: 'Cargo', load_type: 'Cargo', service_code: 'HOTEL' } }, result('cargo', { tripReady: true, vehicleId: 'c4', operationalUse: 'Cargo', source: 'trip' })],
    ['Restaurant service uses shared Cargo mode', { driverType: 'Cargo', trip: { vehicle_id: 'c5', operational_use: 'Cargo', load_type: 'Cargo', service_code: 'RESTAURANT' } }, result('cargo', { tripReady: true, vehicleId: 'c5', operationalUse: 'Cargo', source: 'trip' })],
    ['Missing driver type fails closed', {}, result('unclassified', { reason: 'missing_driver_type' })],
    ['Unsupported driver type fails closed', { driverType: 'Other', assignedVehicle: { id: 'v1', operational_use: 'Passenger' } }, result('unclassified', { vehicleId: 'v1', operationalUse: 'Passenger', source: 'standing_assignment', reason: 'unsupported_driver_type' })],
    ['No trip keeps driver-selected Home mode', { driverType: 'Cargo' }, result('cargo', { reason: 'no_vehicle' })],
    ['No trip uses assigned vehicle', { driverType: 'Passenger', assignedVehicle: { vehicleId: 'v2', operational_use: 'Passenger' } }, result('passenger', { vehicleId: 'v2', operationalUse: 'Passenger', source: 'standing_assignment' })],
    ['Trip without its own vehicle does not borrow standing assignment', { driverType: 'Cargo', trip: { load_type: 'Cargo' }, assignedVehicle: { id: 'c6', operational_use: 'Cargo' } }, result('cargo', { tripReady: false, source: 'trip', reason: 'no_vehicle' })],
    ['Vehicle with missing operational use blocks work', { driverType: 'Cargo', assignedVehicle: { id: 'v3', operational_use: null } }, result('cargo', { vehicleId: 'v3', source: 'standing_assignment', reason: 'missing_operational_use' })],
    ['Typed trip load mismatch blocks work', { driverType: 'Passenger', trip: { vehicle_id: 'p4', operational_use: 'Passenger', load_type: 'Cargo' } }, result('passenger', { tripReady: false, vehicleId: 'p4', operationalUse: 'Passenger', source: 'trip', reason: 'trip_type_mismatch' })],
    ['Cargo vehicle with Passenger trip load blocks work without changing mode', { driverType: 'Cargo', trip: { vehicle_id: 'c10', operational_use: 'Cargo', load_type: 'Passenger' } }, result('cargo', { tripReady: false, vehicleId: 'c10', operationalUse: 'Cargo', source: 'trip', reason: 'trip_type_mismatch' })],
    ['Untyped Passenger trip keeps the legacy exception', { driverType: 'Passenger', trip: { vehicle_id: 'p5', operational_use: 'Passenger' } }, result('passenger', { tripReady: true, vehicleId: 'p5', operationalUse: 'Passenger', source: 'trip' })],
    ['Untyped Cargo trip is blocked', { driverType: 'Cargo', trip: { vehicle_id: 'c7', operational_use: 'Cargo' } }, result('cargo', { tripReady: false, vehicleId: 'c7', operationalUse: 'Cargo', source: 'trip', reason: 'missing_trip_type' })],
    ['Untyped Passenger trip with wrong vehicle use is blocked', { driverType: 'Passenger', trip: { vehicle_id: 'c8', operational_use: 'Cargo' } }, result('passenger', { tripReady: false, vehicleId: 'c8', operationalUse: 'Cargo', source: 'trip', reason: 'driver_vehicle_mismatch' })],
    ['Source text cannot select mode', { driverType: 'Cargo', trip: { vehicle_id: 'c9', operational_use: 'Cargo', load_type: 'Cargo', source: 'Passenger booking' } }, result('cargo', { tripReady: true, vehicleId: 'c9', operationalUse: 'Cargo', source: 'trip' })],
  ])('%s', (_name, input, expected) => {
    expect(resolveDriverWorkspace(input)).toEqual(expected);
  });
});
