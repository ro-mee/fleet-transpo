import { describe, expect, it } from 'vitest';
import * as authority from './cargo-internal-authority';

const actor = { user: { role: 'driver', employeeId: 5, driverId: 3 } };
const trip = { trip_id: 7, driver_id: 3, employee_id: 5, request_id: 11, load_type: 'Cargo', source_system: 'INTERNAL', source_organization_id: 'fleetops', stored_role: 'driver', employee_status: 'Active', driver_deleted_at: null };
const db = row => ({ query: async () => ({ rows: row ? [row] : [] }) });
describe('persisted internal cargo authority', () => {
  it('admits only the current assigned authenticated driver on saved internal cargo', async () => {
    expect(await authority.assertInternalCargoTrip(7, actor, db(trip))).toMatchObject({ trip_id: 7 });
    await expect(authority.assertInternalCargoTrip(7, actor, db({ ...trip, employee_id: 6 }))).rejects.toMatchObject({ status: 404 });
  });
  it('does not accept client origin or a valid external trip', async () => {
    await expect(authority.assertInternalCargoTrip(7, actor, db({ ...trip, source_system: 'PMS' }))).rejects.toMatchObject({ status: 503 });
  });
  it('requires a real current employee role for manager review', async () => {
    const manager = { user: { role: 'fleet_manager', employeeId: 2 } };
    expect(await authority.assertInternalCargoTrip(7, manager, db({ ...trip, stored_role: 'fleet_manager' }), { managerOnly: true })).toMatchObject({ trip_id: 7 });
    await expect(authority.assertInternalCargoTrip(7, manager, db({ ...trip, stored_role: 'dispatcher' }), { managerOnly: true })).rejects.toMatchObject({ status: 403 });
  });
});
