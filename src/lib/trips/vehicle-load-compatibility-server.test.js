import { expect, it, vi } from 'vitest';
import { assertStoredVehicleLoadCompatibility } from './vehicle-load-compatibility';

it('allows a matching Cargo custodian and vehicle without a trip request', async () => {
  const db = { query: vi.fn(async () => ({ rows: [{ driver_type: 'Cargo', operational_use: 'Cargo' }] })) };
  await expect(assertStoredVehicleLoadCompatibility({ db, driverId: 7, vehicleId: 9 }))
    .resolves.toMatchObject({ ok: true, reason: null });
  expect(db.query).toHaveBeenCalledOnce();
  expect(db.query.mock.calls[0][0]).toMatch(/FOR SHARE OF d, v/);
});

it('blocks stored untyped Cargo requests using the request row, not caller input', async () => {
  const db = { query: vi.fn()
    .mockResolvedValueOnce({ rows: [{ driver_type: 'Cargo', operational_use: 'Cargo' }] })
    .mockResolvedValueOnce({ rows: [{ request_id: 12, load_type: null }] }) };
  await expect(assertStoredVehicleLoadCompatibility({ db, driverId: 7, vehicleId: 9, requestId: 12 }))
    .rejects.toMatchObject({ status: 409, code: 'VEHICLE_LOAD_INCOMPATIBLE', reason: 'cargo_requires_typed_load' });
  expect(db.query.mock.calls[1][0]).toMatch(/FOR SHARE/);
});

it('blocks driver and vehicle type mismatches even without a request', async () => {
  const db = { query: vi.fn(async () => ({ rows: [{ driver_type: 'Passenger', operational_use: 'Cargo' }] })) };
  await expect(assertStoredVehicleLoadCompatibility({ db, driverId: 7, vehicleId: 9 }))
    .rejects.toMatchObject({ status: 409, code: 'VEHICLE_LOAD_INCOMPATIBLE', reason: 'driver_vehicle_mismatch' });
});

it('blocks a request that disappeared before the final write', async () => {
  const db = { query: vi.fn()
    .mockResolvedValueOnce({ rows: [{ driver_type: 'Passenger', operational_use: 'Passenger' }] })
    .mockResolvedValueOnce({ rows: [] }) };
  await expect(assertStoredVehicleLoadCompatibility({ db, driverId: 7, vehicleId: 9, requestId: 12 }))
    .rejects.toMatchObject({ status: 409, code: 'VEHICLE_LOAD_INCOMPATIBLE', reason: 'request_not_found' });
});

it('blocks an actual Cargo dispatch with no linked typed request', async () => {
  const db = { query: vi.fn(async () => ({ rows: [{ driver_type: 'Cargo', operational_use: 'Cargo' }] })) };
  await expect(assertStoredVehicleLoadCompatibility({ db, driverId: 7, vehicleId: 9, requireTypedLoad: true }))
    .rejects.toMatchObject({ status: 409, code: 'VEHICLE_LOAD_INCOMPATIBLE', reason: 'cargo_requires_typed_load' });
  expect(db.query).toHaveBeenCalledOnce();
});
