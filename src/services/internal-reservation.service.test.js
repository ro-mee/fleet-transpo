import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/db', () => ({ withTransaction: vi.fn(), query: vi.fn(), getPool: vi.fn() }));
const estimates = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('./route-resolver.service', () => ({ resolveRequestEstimate: estimates.resolve }));
import { createInternalCargoReservation } from './internal-reservation.service';
import { adaptRequestManifest } from './cargo-manifest.service';

const session = { user: { employeeId: 12, role: 'dispatcher' } };
const input = () => ({
  submission_id: '11111111-1111-4111-8111-111111111111', load_type: 'Cargo', service_code: 'HOTEL_SUPPLY_TRANSFER',
  pickup_location_id: 1, dropoff_location_id: 2, pickup_datetime: '2026-10-28T15:00:00+08:00',
  priority: 'Normal', cargo_description: 'Kitchen supplies', cargo_weight_kg: '0.3', source_department: 'Kitchen',
  lines: [{ line_id: 'oil', name: 'Cooking oil', source_sku_ref: '', package_description: 'sealed box',
    expected_quantity: '6', quantity_basis: 'UNIT', unit: 'bottles', transport_package_count: '3', gross_weight_kg_per_package: '0.1',
    length_m: '0.2', width_m: '0.2', height_m: '0.2', package_can_rotate: false, handling: [], temperature_mode: 'NONE', temperature_min_c: '', temperature_max_c: '' }],
});

function database({ failOn, inactiveLocation, inactiveService } = {}) {
  let state = { request: null, manifest: null, events: [], audits: [] };
  const tx = { query: vi.fn(async (sql, values = []) => {
    if (failOn && sql.includes(failOn)) throw new Error('Required write failed');
    if (sql.includes('SELECT * FROM transportation_requests')) return { rows: state.request ? [state.request] : [] };
    if (sql.includes('FROM locations')) return { rows: inactiveLocation ? [{ location_id: 1, name: 'Hotel' }] : [{ location_id: 1, name: 'Hotel' }, { location_id: 2, name: 'Airport' }] };
    if (sql.includes('FROM service_types')) return { rows: inactiveService ? [] : [{ service_type_id: 3, default_load_type: 'Cargo' }] };
    if (sql.includes('INSERT INTO transportation_requests')) {
      const columns = sql.match(/transportation_requests\s*\(([^)]+)/)[1].split(',').map(column => column.trim());
      state.request = { request_id: 601, ...Object.fromEntries(columns.map((column, index) => [column, values[index]])), vehicle_id: null, driver_id: null };
      return { rows: [state.request] };
    }
    if (sql.includes('SELECT * FROM request_cargo_manifest_revisions')) return { rows: state.manifest ? [state.manifest] : [] };
    if (sql.includes('INSERT INTO request_cargo_manifest_revisions')) {
      state.manifest = { request_cargo_manifest_revision_id: '22222222-2222-4222-8222-222222222222', request_id: values[0], revision: values[1], manifest_hash: values[2], source_system: values[3], source_organization_id: values[4], source_external_request_id: values[5], source_event_id: values[6], manifest_snapshot: JSON.parse(values[7]) };
      return { rows: [state.manifest] };
    }
    if (sql.includes('INSERT INTO reservation_events')) { state.events.push(values); return { rows: [{ event_id: 1 }] }; }
    if (sql.includes('INSERT INTO audit_logs')) { state.audits.push(values); return { rows: [{ log_id: 1 }] }; }
    return { rows: [] };
  }) };
  const db = { withTransaction: vi.fn(async work => {
    const before = structuredClone(state);
    try { return await work(tx); } catch (error) { state = before; throw error; }
  }) };
  return { db, tx, state: () => state };
}

beforeEach(() => { vi.clearAllMocks(); estimates.resolve.mockResolvedValue({ distanceKm: 14.5, durationMin: 35 }); });

it('saves one Pending INTERNAL request and exact immutable physical item list with required audit/timeline', async () => {
  const fixture = database();
  const result = await createInternalCargoReservation(input(), session, { db: fixture.db });
  expect(result).toMatchObject({ request_id: 601, source_system: 'INTERNAL', fleet_status: 'Pending', passenger_count: null, cargo_weight_kg: 0.3, pickup_location: 'Hotel', dropoff_location: 'Airport', idempotent: false, manifest_ref: { kind: 'REQUEST', revision: 1 } });
  const saved = fixture.state();
  expect(saved.request.vehicle_id).toBeNull();
  expect(saved.request.external_request_id).toBe(`internal:${input().submission_id}`);
  const view = adaptRequestManifest(saved.manifest, { ...saved.request, service_code: 'HOTEL_SUPPLY_TRANSFER' });
  expect(view.lines[0]).toMatchObject({ expected_quantity: '6', unit: 'bottles', reference_image_ref: null, physical: { transport_package_count: 3, gross_weight_kg_per_package: '0.1' } });
  expect(saved.audits).toHaveLength(1);
  expect(saved.events).toHaveLength(1);
  expect(fixture.db.withTransaction).toHaveBeenCalledOnce();
});

it('stores the existing canonical route estimate without creating or guessing a route', async () => {
  const fixture = database();
  const result = await createInternalCargoReservation(input(), session, { db: fixture.db });
  expect(result).toMatchObject({ estimated_distance: 14.5, estimated_duration: 35 });
  expect(estimates.resolve).toHaveBeenCalledWith(expect.objectContaining({ pickup_location_id: 1, dropoff_location_id: 2 }), fixture.tx, { strictRegistry: true, persistRoute: false });
});

it('preserves unknown route estimates as unknown', async () => {
  estimates.resolve.mockResolvedValue({ distanceKm: null, durationMin: null });
  const fixture = database();
  const result = await createInternalCargoReservation(input(), session, { db: fixture.db });
  expect(result.estimated_distance).toBeNull();
  expect(result.estimated_duration).toBeNull();
});

it('returns the same saved request for an exact retry without duplicate manifest, audit or timeline', async () => {
  const fixture = database();
  const first = await createInternalCargoReservation(input(), session, { db: fixture.db });
  const second = await createInternalCargoReservation(input(), session, { db: fixture.db });
  expect(second).toMatchObject({ request_id: first.request_id, manifest_ref: first.manifest_ref, idempotent: true });
  expect(fixture.state().audits).toHaveLength(1);
  expect(fixture.state().events).toHaveLength(1);
});

it('uses one UUID identity regardless of the letter casing in a retry', async () => {
  const fixture = database();
  const submission = { ...input(), submission_id: 'abcdef12-1234-4123-8123-123456abcdef' };
  await createInternalCargoReservation(submission, session, { db: fixture.db });
  const retried = await createInternalCargoReservation({ ...submission, submission_id: submission.submission_id.toUpperCase() }, session, { db: fixture.db });
  expect(retried.idempotent).toBe(true);
  expect(fixture.state().audits).toHaveLength(1);
});

it.each(['cargo_description', 'pickup_location_id'])('rejects changed-content retry for %s', async field => {
  const fixture = database();
  await createInternalCargoReservation(input(), session, { db: fixture.db });
  const changed = { ...input(), [field]: field === 'pickup_location_id' ? 2 : 'Changed contents' };
  await expect(createInternalCargoReservation(changed, session, { db: fixture.db })).rejects.toMatchObject({ code: 'INTERNAL_RESERVATION_REPLAY_CONFLICT', status: 409 });
});

it('binds retries to the creating employee and refuses a deleted source identity', async () => {
  const fixture = database();
  await createInternalCargoReservation(input(), session, { db: fixture.db });
  await expect(createInternalCargoReservation(input(), { user: { role: 'fleet_manager', employeeId: 13 } }, { db: fixture.db })).rejects.toMatchObject({ status: 409 });
  fixture.state().request.deleted_at = '2026-10-28T00:00:00Z';
  await expect(createInternalCargoReservation(input(), session, { db: fixture.db })).rejects.toMatchObject({ status: 409 });
});

it.each(['request_cargo_manifest_revisions', 'reservation_events', 'audit_logs'])('rolls the request back when required %s insert fails', async table => {
  const fixture = database({ failOn: `INSERT INTO ${table}` });
  await expect(createInternalCargoReservation(input(), session, { db: fixture.db })).rejects.toThrow('Required write failed');
  expect(fixture.state()).toEqual({ request: null, manifest: null, events: [], audits: [] });
});

it.each([{ inactiveLocation: true }, { inactiveService: true }])('rejects unavailable registry entries before inserting', async flags => {
  const fixture = database(flags);
  await expect(createInternalCargoReservation(input(), session, { db: fixture.db })).rejects.toMatchObject({ status: 422 });
  expect(fixture.state().request).toBeNull();
});

it.each([
  { source_system: 'POS' }, { load_type: 'Passenger' }, { cargo_weight_kg: '0.301' }, { lines: [] },
  { pickup_datetime: '2026-10-28T15:00' }, { submission_id: 'not-a-uuid' }, { driver_id: 98 },
  { pickup_location_id: 2147483648 }, { dropoff_location_id: 2147483648 }, { requested_category_id: 2147483648 },
])('rejects invalid or client-controlled authority before opening a transaction: %j', async patch => {
  const fixture = database();
  await expect(createInternalCargoReservation({ ...input(), ...patch }, session, { db: fixture.db })).rejects.toMatchObject({ status: 400 });
  expect(fixture.db.withTransaction).not.toHaveBeenCalled();
});

it.each(['driver', 'management'])('denies %s even when called outside the route', async role => {
  const fixture = database();
  await expect(createInternalCargoReservation(input(), { user: { employeeId: 98, role } }, { db: fixture.db })).rejects.toMatchObject({ status: 403 });
  expect(fixture.db.withTransaction).not.toHaveBeenCalled();
});
