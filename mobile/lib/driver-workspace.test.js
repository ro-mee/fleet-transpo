import { describe, expect, it } from 'vitest';
import { resolveDriverWorkspace } from './driver-workspace.js';

describe('resolveDriverWorkspace', () => {
  it.each([
    ['cargo trip and cargo vehicle', { trip: { id: 't1', vehicle_id: 'v1', operational_use: 'Cargo', load_type: 'Cargo' } }, { mode: 'cargo', tripReady: true, vehicleId: 'v1', operationalUse: 'Cargo', source: 'trip', reason: null }],
    ['passenger trip and passenger vehicle', { trip: { id: 't2', vehicle_id: 'v2', operationalUse: 'Passenger', load_type: 'Passenger' } }, { mode: 'passenger', tripReady: true, vehicleId: 'v2', operationalUse: 'Passenger', source: 'trip', reason: null }],
    ['hotel service cargo', { trip: { vehicle_id: 'v3', operational_use: 'Cargo', load_type: 'Cargo', service_code: 'HOTEL' } }, { mode: 'cargo', tripReady: true, vehicleId: 'v3', operationalUse: 'Cargo', source: 'trip', reason: null }],
    ['restaurant service cargo', { trip: { vehicle_id: 'v4', operational_use: 'Cargo', load_type: 'Cargo', service_code: 'RESTAURANT' } }, { mode: 'cargo', tripReady: true, vehicleId: 'v4', operationalUse: 'Cargo', source: 'trip', reason: null }],
    ['trip vehicle takes precedence over standing assignment', { trip: { vehicle_id: 'trip-vehicle', operational_use: 'Cargo', load_type: 'Cargo' }, assignedVehicle: { id: 'standing-vehicle', operational_use: 'Passenger' } }, { mode: 'cargo', tripReady: true, vehicleId: 'trip-vehicle', operationalUse: 'Cargo', source: 'trip', reason: null }],
    ['typed mismatch preserves vehicle mode and blocks trip', { trip: { vehicle_id: 'v5', operational_use: 'Passenger', load_type: 'Cargo' } }, { mode: 'passenger', tripReady: false, vehicleId: 'v5', operationalUse: 'Passenger', source: 'trip', reason: 'trip_type_mismatch' }],
    ['trip without vehicle does not fall back to assignment', { trip: { operational_use: 'Cargo', load_type: 'Cargo' }, assignedVehicle: { id: 'standing', operational_use: 'Cargo' } }, { mode: 'unassigned', tripReady: false, vehicleId: null, operationalUse: 'Cargo', source: 'trip', reason: 'no_vehicle' }],
    ['unsupported operational use is unassigned', { trip: { vehicle_id: 'v6', operational_use: 'Other', load_type: 'Cargo' } }, { mode: 'unassigned', tripReady: false, vehicleId: 'v6', operationalUse: 'Other', source: 'trip', reason: 'missing_operational_use' }],
    ['missing operational use is unassigned', { trip: { vehicle_id: 'v7', load_type: 'Cargo' } }, { mode: 'unassigned', tripReady: false, vehicleId: 'v7', operationalUse: null, source: 'trip', reason: 'missing_operational_use' }],
    ['standing assignment selects workspace when no trip supplied', { assignedVehicle: { id: 'v8', operationalUse: 'Passenger' } }, { mode: 'passenger', tripReady: null, vehicleId: 'v8', operationalUse: 'Passenger', source: 'standing_assignment', reason: null }],
    ['no trip and no assigned vehicle is unassigned', {}, { mode: 'unassigned', tripReady: null, vehicleId: null, operationalUse: null, source: null, reason: 'no_vehicle' }],
    ['untyped trip on passenger vehicle keeps legacy passenger presentation', { trip: { vehicle_id: 'v9', operational_use: 'Passenger' } }, { mode: 'passenger', tripReady: true, vehicleId: 'v9', operationalUse: 'Passenger', source: 'trip', reason: null }],
    ['untyped trip on cargo vehicle is blocked', { trip: { vehicle_id: 'v10', operational_use: 'Cargo' } }, { mode: 'cargo', tripReady: false, vehicleId: 'v10', operationalUse: 'Cargo', source: 'trip', reason: 'missing_trip_type' }],
    ['source text and driver role do not select mode', { trip: { vehicle_id: 'v11', operational_use: 'Cargo', load_type: 'Cargo', source: 'Passenger booking' }, driver: { role: 'passenger' } }, { mode: 'cargo', tripReady: true, vehicleId: 'v11', operationalUse: 'Cargo', source: 'trip', reason: null }],
  ])('%s', (_name, input, expected) => {
    expect(resolveDriverWorkspace(input)).toEqual(expected);
  });
});

