import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/lib/api/utils", () => ({
  requirePermission: vi.fn(),
  parseBody: (req) => req.json().catch(() => ({})),
  ok: (data) => Response.json(data),
  err: (error, status) => Response.json({ error }, { status }),
  handleError: (e) => Response.json({ error: e.message }, { status: e.status ?? 500 }),
  AuthError: class extends Error { constructor(message, status, code) { super(message); Object.assign(this, { status, code }); } },
}));
vi.mock("@/services/reservation-lifecycle.service", () => ({
  loadRequest: vi.fn(),
  advanceReservation: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(), writeAuditRequired: vi.fn(async () => ({ log_id: 1 })) }));
vi.mock('@/services/outbound.service', () => ({ emitTransportStatus: vi.fn(async () => null) }));
vi.mock("@/services/status.service", () => ({
  syncVehicleStatus: vi.fn(),
  syncDriverStatus: vi.fn(),
}));

import { query, withTransaction } from "@/lib/db";
import { requirePermission } from "@/lib/api/utils";
import { loadRequest, advanceReservation } from "@/services/reservation-lifecycle.service";
import { PUT } from "./route";
import { writeAuditRequired } from '@/lib/audit';
import { cargoPayloadHash } from '@/services/cargo-execution.repository';

const params = { params: Promise.resolve({ id: "501" }) };
const request = (body = { reason: "Guest cancelled" }) =>
  new Request("http://localhost/api/integration/transport-requests/501/cancel", {
    method: "PUT",
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  withTransaction.mockImplementation(work => work({ query }));
  requirePermission.mockResolvedValue({ user: { employeeId: 1 } });
  loadRequest.mockResolvedValue({ request_id: 501, load_type: 'Passenger', fleet_status: "Assigned" });
  query.mockImplementation(async sql => ({ rows: sql.includes('SELECT request_id, load_type') ? [{ request_id: 501, load_type: 'Passenger' }] : [] }));
});
afterEach(() => vi.unstubAllEnvs());

it('holds cargo request cancellation before any cascade when source coordination is unapproved', async () => {
  vi.stubEnv('CARGO_LIFECYCLE_MODE', 'ENFORCE');
  loadRequest.mockResolvedValue({ request_id: 501, fleet_status: 'Assigned', load_type: 'Cargo' });
  expect((await PUT(request(), params)).status).toBe(503);
  expect(query).not.toHaveBeenCalled();
  expect(advanceReservation).not.toHaveBeenCalled();
});
it('rechecks a request changed to Cargo before cancelling any Passenger cascade', async () => {
  loadRequest.mockResolvedValue({ request_id: 501, fleet_status: 'Assigned', load_type: 'Passenger' });
  query.mockImplementation(async sql => ({ rows: sql.includes('load_type') ? [{ request_id: 501, load_type: 'Cargo' }] : [] }));
  advanceReservation.mockResolvedValue({ ok: true, request: { request_id: 501, fleet_status: 'Cancelled' } });
  expect((await PUT(request(), params)).status).toBe(503);
  expect(query.mock.calls.some(([sql]) => /^UPDATE/.test(sql))).toBe(false);
  expect(advanceReservation).not.toHaveBeenCalled();
});

function internalRequest({ dispatched = false, tripStatus = 'Assigned', historicPickup = false, storedSource = 'INTERNAL' } = {}) {
  vi.stubEnv('DATABASE_URL', 'postgresql://test-only-unused');
  requirePermission.mockResolvedValue({ user: { employeeId: 1, role: 'dispatcher' } });
  loadRequest.mockResolvedValue({ request_id: 501, load_type: 'Cargo', source_system: 'INTERNAL', fleet_status: dispatched ? 'Assigned' : 'Pending' });
  const trip = { trip_id: 3, dispatch_id: 9, driver_id: 7, vehicle_id: 5, trip_status: tripStatus };
  const snapshot = { source_ref: { system: 'INTERNAL', organization_id: 'fleetops', external_request_id: 'internal:test' }, service_code: 'HOTEL_SUPPLY_TRANSFER',
    lines: [{ line_id: 'boxes', name: 'Boxes', quantity_basis: 'TRANSPORT_PACKAGE', expected_quantity: '10', unit: 'boxes', reference_image_ref: null, handling: [] }] };
  const manifest = { request_cargo_manifest_revision_id: '11111111-1111-4111-8111-111111111111', request_id: 501, revision: 1, manifest_hash: cargoPayloadHash(snapshot), manifest_snapshot: snapshot, source_organization_id: 'fleetops' };
  query.mockImplementation(async sql => {
    if (sql.includes('SELECT employee_id FROM employees')) return { rows: [{ employee_id: 1 }] };
    if (sql.includes('e.status AS employee_status')) return { rows: [{ ...trip, request_id: 501, source_system: storedSource, source_organization_id: 'fleetops', load_type: 'Cargo', employee_status: 'Active', stored_role: 'dispatcher' }] };
    if (sql.includes('AS stored_request_id')) return { rows: [{ ...trip, request_id: 501, stored_request_id: 501, stored_dispatch_id: 9, load_type: 'Cargo', source_system: storedSource, service_type: 'PASSENGER' }] };
    if (sql.includes('SELECT request_id, load_type')) return { rows: [{ request_id: 501, load_type: 'Cargo', source_system: storedSource }] };
    if (sql.includes('FROM cargo_receipts')) return { rows: historicPickup ? [{ receipt_id: 'recorded' }] : [] };
    if (sql.includes('SELECT dispatch_id FROM dispatchschedules')) return { rows: dispatched ? [{ dispatch_id: 9 }] : [] };
    if (sql.includes('SELECT * FROM trips')) return { rows: [trip] };
    if (sql.includes('SELECT * FROM dispatchschedules')) return { rows: [{ dispatch_id: 9, request_id: 501, service_type: 'PASSENGER' }] };
    if (sql.includes('SELECT d.request_id')) return { rows: [{ request_id: 501, load_type: 'Cargo', source_system: storedSource, external_request_id: 'internal:test', cargo_weight_kg: '10', service_code: 'HOTEL_SUPPLY_TRANSFER', service_type: 'PASSENGER' }] };
    if (sql.includes('FROM request_cargo_manifest_revisions')) return { rows: [manifest] };
    return { rows: [] };
  });
  advanceReservation.mockResolvedValue({ ok: true, request: { request_id: 501, source_system: 'INTERNAL', fleet_status: 'Cancelled' }, hops: ['Cancelled'] });
}

it('cancels a new unassigned INTERNAL Cargo job under the existing transactional locks', async () => {
  internalRequest();
  const response = await PUT(request(), params);
  expect(response.status).toBe(200);
  expect((await response.json()).fleet_status).toBe('Cancelled');
  expect(advanceReservation).toHaveBeenCalledWith(expect.objectContaining({ toStatus: 'Cancelled', db: expect.anything(), notifyBooking: false }));
  expect(query.mock.calls[0][0]).toContain('LOCK TABLE drivers, vehicles');
});

it('runs the real Cargo checkpoint before cancelling an assigned INTERNAL trip that has no pickup', async () => {
  internalRequest({ dispatched: true });
  const response = await PUT(request(), params);
  expect(await response.clone().json()).toMatchObject({ fleet_status: 'Cancelled' });
  expect(response.status).toBe(200);
  expect(writeAuditRequired).toHaveBeenCalledWith(expect.anything(), null, expect.objectContaining({ user: expect.objectContaining({ role: 'dispatcher' }) }), expect.objectContaining({ action: 'cargo_checkpoint' }));
  expect(query.mock.calls.some(([sql]) => sql.includes("UPDATE trips SET trip_status = 'Cancelled'"))).toBe(true);
});

it('keeps a recorded pickup held even when its previous dispatch is no longer in the active cascade', async () => {
  internalRequest({ historicPickup: true });
  expect((await PUT(request(), params)).status).toBe(409);
  expect(advanceReservation).not.toHaveBeenCalled();
  expect(query.mock.calls.some(([sql]) => /^UPDATE/.test(sql))).toBe(false);
});

it('keeps the actual post-departure checkpoint hold when custody evidence is unavailable', async () => {
  internalRequest({ dispatched: true, tripStatus: 'En Route' });
  const response = await PUT(request(), params);
  expect(response.status).toBe(409);
  expect((await response.json()).error).toMatch(/custody needs review/i);
  expect(advanceReservation).not.toHaveBeenCalled();
  expect(query.mock.calls.some(([sql]) => /^UPDATE/.test(sql))).toBe(false);
});

it('rechecks INTERNAL origin under lock before changing any request or trip', async () => {
  internalRequest({ storedSource: 'PMS', dispatched: true });
  expect((await PUT(request(), params)).status).toBe(503);
  expect(advanceReservation).not.toHaveBeenCalled();
});

it("requires the cancel permission before touching the request", async () => {
  requirePermission.mockRejectedValueOnce(Object.assign(new Error("Forbidden"), { status: 403 }));
  expect((await PUT(request(), params)).status).toBe(403);
  expect(requirePermission).toHaveBeenCalledWith(expect.anything(), "reservations", "cancel");
  expect(advanceReservation).not.toHaveBeenCalled();
});

it("returns the updated row AND what the Booking hand-off actually did", async () => {
  // The UI cannot state the real outcome without this: the toast used to promise
  // "Booking will be notified" unconditionally, while `bookingNotify` already
  // knew the gateway was the local mock.
  advanceReservation.mockResolvedValue({
    ok: true,
    request: { request_id: 501, fleet_status: "Cancelled" },
    hops: ["Cancelled"],
    bookingNotify: { delivered: true, gateway: "mock" },
  });

  const response = await PUT(request(), params);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({
    request_id: 501,
    fleet_status: "Cancelled",
    booking_notify: { delivered: true, gateway: "mock" },
  });
});

it("reports a null hand-off when nothing was attempted", async () => {
  advanceReservation.mockResolvedValue({
    ok: true,
    request: { request_id: 501, fleet_status: "Cancelled" },
    hops: ["Cancelled"],
  });

  const body = await (await PUT(request(), params)).json();
  expect(body.booking_notify).toBeNull();
});

it("surfaces a refused transition as its own status, not a cancel", async () => {
  advanceReservation.mockResolvedValue({ ok: false, status: 409, error: "Request is Cancelled and can no longer change status." });
  const response = await PUT(request(), params);
  expect(response.status).toBe(409);
  expect((await response.json()).error).toMatch(/can no longer change status/);
});

it("stands down an open dispatch and a Pending Reassignment one with the request", async () => {
  query.mockImplementation(async (sql) => {
    if (sql.includes('AS stored_request_id')) return { rows: [{ dispatch_id: 9, request_id: 501, stored_request_id: 501, load_type: 'Passenger' }] };
    if (sql.includes('SELECT request_id, load_type')) return { rows: [{ request_id: 501, load_type: 'Passenger' }] };
    if (sql.includes("SELECT dispatch_id FROM dispatchschedules")) {
      return { rows: [{ dispatch_id: 9 }] };
    }
    if (sql.includes("SELECT vehicle_id, driver_id FROM dispatchschedules")) {
      return { rows: [{ vehicle_id: 5, driver_id: 7 }] };
    }
    return { rows: [] };
  });
  advanceReservation.mockResolvedValue({
    ok: true,
    request: { request_id: 501, fleet_status: "Cancelled" },
    hops: ["Cancelled"],
    bookingNotify: { delivered: false, gateway: "mock", reason: "no-external-booking-id" },
  });

  await PUT(request(), params);

  const sweep = query.mock.calls.find(([sql]) => sql.includes("SELECT dispatch_id FROM dispatchschedules"));
  expect(sweep[0]).toContain("'Pending Reassignment'");
  const calls = query.mock.calls.map(([sql]) => sql);
  expect(calls.some((sql) => sql.includes("UPDATE trips"))).toBe(true);
  expect(calls.some((sql) => sql.includes("UPDATE dispatchschedules SET status = 'Cancelled'"))).toBe(true);
});
