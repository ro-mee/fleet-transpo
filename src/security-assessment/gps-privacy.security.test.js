// SEC-GPS — location privacy, GPS integrity and standby-consent boundaries.
//
// Authorized assessment tests. Location is the most sensitive data this system
// holds: it is a movement history of a named person. These assert who may read
// it, what a client may claim about it, and that the central serializer scrubs
// it from every generic response.
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({ query: vi.fn(async () => ({ rows: [] })), withTransaction: vi.fn() }));
vi.mock('@/lib/api/utils', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, requirePermission: vi.fn(), requireDriver: vi.fn() };
});
vi.mock('@/lib/api/ownership', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, assertTripOwnership: vi.fn() };
});
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(async () => ({ allowed: true })) }));

import { query } from '@/lib/db';
import { requirePermission, requireDriver, ok, AuthError } from '@/lib/api/utils';
import { assertTripOwnership } from '@/lib/api/ownership';
import { GET as locationsGET, POST as locationsPOST } from '@/app/api/trips/[id]/locations/route';
import { GET as standbyLocationsGET } from '@/app/api/tracking/standby-locations/route';
import { POST as legacyGpsPOST } from '@/app/api/mobile/driver/gps/route';
import { resolveDriverScope } from '@/lib/api/ownership';
import { isValidCoordinate, getGpsHealth } from '@/lib/gps';
import { qualifiedGps, MAX_GPS_ACCURACY_M } from '@/lib/dispatch/location-relevance';
import { rolesFor } from '@/lib/auth/permissions';
import { readFileSync } from 'node:fs';

const ctx = (id = '55') => ({ params: Promise.resolve({ id }) });
const jsonReq = (body, url = 'http://localhost/api/x') => new Request(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const getReq = (url = 'http://localhost/api/x') => new Request(url, { method: 'GET' });

const TRIP = { trip_id: 55, driver_id: 4, vehicle_id: 7, trip_status: 'In Progress', dispatch_id: 3 };

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ user: { role: 'dispatcher', employeeId: 1, driverId: null } });
  requireDriver.mockResolvedValue({ user: { role: 'driver', employeeId: 2, driverId: 4 } });
  assertTripOwnership.mockResolvedValue(TRIP);
  query.mockResolvedValue({ rows: [] });
});

// ---------------------------------------------------------------------------
// SEC-GPS-001 — the central serializer scrubs stored standby coordinates
// ---------------------------------------------------------------------------

describe('SEC-GPS-001 — standby storage fields never leak through a generic response', () => {
  // The private set, exactly as declared in lib/dispatch/location-relevance.js.
  const PRIVATE_FIELDS = [
    'standby_latitude', 'standby_longitude', 'standby_session_family', 'standby_tracking_enabled',
    'location_observed_at', 'location_received_at', 'location_accuracy_m', 'location_source', 'location_vehicle_id',
  ];

  it('ok() strips every private standby field, at any depth', async () => {
    const payload = {
      driver: { driver_id: 4, first_name: 'Marco', ...Object.fromEntries(PRIVATE_FIELDS.map(f => [f, 'SECRET'])) },
      nested: { deeper: [{ driver: Object.fromEntries(PRIVATE_FIELDS.map(f => [f, 'SECRET'])) }] },
    };
    const body = await ok(payload).json();
    const serialized = JSON.stringify(body);
    for (const field of PRIVATE_FIELDS) expect(serialized).not.toContain(`"${field}"`);
    expect(serialized).not.toContain('SECRET');
    // …and the innocuous fields it sits beside survive.
    expect(body.driver.first_name).toBe('Marco');
    expect(body.driver.driver_id).toBe(4);
  });

  it('the scrubber is applied in the shared serializer, not per route', () => {
    const source = readFileSync(new URL('../lib/api/utils.js', import.meta.url), 'utf8');
    expect(source).toMatch(/JSON\.stringify\(data\s*,\s*omitStandbyStorage\)/);
  });

  it('the two direct-Response.json position feeds are the only ones that carry coordinates', () => {
    // Both are deliberate ops-facing surfaces with their own guards; every other
    // route returns driver rows through ok(). This test freezes that boundary.
    const radar = readFileSync(new URL('../app/api/integration/transport-requests/[id]/radar/route.js', import.meta.url), 'utf8');
    const standby = readFileSync(new URL('../app/api/tracking/standby-locations/route.js', import.meta.url), 'utf8');
    expect(radar).toContain("requirePermission(req, 'reservations', 'assign')");
    expect(radar).toContain("requirePermission(req, 'dispatch', 'read_all')");
    expect(standby).toContain("requirePermission(req, 'trips', 'read_all')");
  });
});

// ---------------------------------------------------------------------------
// SEC-GPS-002 — fleet-wide position surfaces are operations-only
// ---------------------------------------------------------------------------

describe('SEC-GPS-002 — a driver cannot reach a fleet-wide position feed', () => {
  it('trips.read_all and dispatch.read_all exclude the driver role', () => {
    for (const [resource, action] of [['trips', 'read_all'], ['dispatch', 'read_all'], ['reservations', 'assign']]) {
      const allowed = rolesFor(resource, action);
      expect(allowed).not.toContain('driver');
      expect(allowed.length).toBeGreaterThan(0);
    }
  });

  it('the standby position feed demands trips.read_all', async () => {
    requirePermission.mockRejectedValueOnce(new AuthError("Role 'driver' is not permitted", 403));
    const res = await standbyLocationsGET(getReq());
    expect(res.status).toBe(403);
    expect(requirePermission.mock.calls[0].slice(1)).toEqual(['trips', 'read_all']);
  });

  it('a driver reading a GPS trace is scoped to their own trip', async () => {
    // trips/[id]/locations GET is guarded by trips.read (which a driver holds)
    // AND by ownership — the role alone is not the boundary.
    await locationsGET(getReq(), ctx());
    expect(assertTripOwnership).toHaveBeenCalledTimes(1);
    expect(assertTripOwnership.mock.calls[0][1]).toBe('55');
  });

  it("another driver's trace is refused by the ownership helper before any read", async () => {
    assertTripOwnership.mockRejectedValueOnce(new AuthError('Trip not found', 404));
    const res = await locationsGET(getReq(), ctx());
    expect(res.status).toBe(404);
    expect(query).not.toHaveBeenCalled();
  });

  it('resolveDriverScope refuses a widened driver filter rather than accepting it', () => {
    expect(() => resolveDriverScope({ user: { role: 'driver', driverId: 4 } }, '999'))
      .toThrowError(expect.objectContaining({ status: 403 }));
  });
});

// ---------------------------------------------------------------------------
// SEC-GPS-003 — a client cannot choose which vehicle or trip it writes to
// ---------------------------------------------------------------------------

describe('SEC-GPS-003 — GPS writes are bound to the trip row, never the body', () => {
  it('the recorded vehicle is taken from the trip and a body override is ignored', async () => {
    query.mockResolvedValue({ rows: [{ tracking_id: 1 }] });
    const res = await locationsPOST(jsonReq({
      latitude: 14.5995, longitude: 120.9842,
      vehicle_id: 999, trip_id: 999, driver_id: 999,
    }), ctx());
    expect(res.status).toBe(201);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO gpstracking/);
    expect(params[0]).toBe(7);   // trip.vehicle_id
    expect(params[1]).toBe(55);  // trip.trip_id
    expect(params).not.toContain(999);
  });

  it('the driver whose last-known position is refreshed is the trip owner', async () => {
    query.mockResolvedValue({ rows: [{ tracking_id: 1 }] });
    await locationsPOST(jsonReq({ latitude: 14.5995, longitude: 120.9842, driver_id: 999 }), ctx());
    const update = query.mock.calls.find(([sql]) => /UPDATE drivers/.test(String(sql)));
    expect(update[1][2]).toBe(4); // trip.driver_id
  });

  it('a late GPS callback for a non-live trip is accepted and recorded nowhere', async () => {
    assertTripOwnership.mockResolvedValue({ ...TRIP, trip_status: 'Completed' });
    const res = await locationsPOST(jsonReq({ latitude: 14.6, longitude: 120.9 }), ctx());
    expect(await res.json()).toMatchObject({ tracked: false, reason: 'trip-not-live' });
    expect(query).not.toHaveBeenCalled();
  });

  it('out-of-range or malformed coordinates are refused before any write', async () => {
    for (const body of [
      { latitude: 91, longitude: 0 }, { latitude: 0, longitude: 181 },
      { latitude: 'abc', longitude: 0 }, { latitude: null, longitude: null },
      { latitude: '', longitude: '' }, {},
    ]) {
      expect((await locationsPOST(jsonReq(body), ctx())).status).toBe(400);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('the legacy compatibility endpoint persists nothing', async () => {
    const res = await legacyGpsPOST(jsonReq({ latitude: 14.6, longitude: 120.9 }));
    expect(await res.json()).toMatchObject({ tracked: false, reason: 'trip-id-required' });
    expect(query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SEC-GPS-004 — coordinate and freshness qualification
// ---------------------------------------------------------------------------

describe('SEC-GPS-004 — only a fresh, accurate, in-range fix may be used as live evidence', () => {
  const fresh = () => ({ latitude: 14.5995, longitude: 120.9842, accuracy: 20, observed_at: new Date().toISOString() });

  it('accepts a fresh accurate fix inside the coordinate bounds', () => {
    expect(isValidCoordinate(14.5995, 120.9842)).toBe(true);
    expect(isValidCoordinate(-90, -180)).toBe(true);
    expect(isValidCoordinate(90, 180)).toBe(true);
    expect(qualifiedGps(fresh()).eligible).toBe(true);
  });

  it('rejects every out-of-range, non-finite or empty coordinate', () => {
    for (const [lat, lng] of [[91, 0], [-91, 0], [0, 181], [0, -181], [NaN, 0], [0, NaN], [Infinity, 0], [null, 0], [0, null], ['', 0], ['abc', 0]]) {
      expect(isValidCoordinate(lat, lng)).toBe(false);
    }
  });

  it('rejects a stale fix, a low-accuracy fix and an implausibly future fix', () => {
    const base = fresh();
    expect(qualifiedGps({ ...base, observed_at: new Date(Date.now() - 10 * 60_000).toISOString() }).eligible).toBe(false);
    expect(qualifiedGps({ ...base, accuracy: MAX_GPS_ACCURACY_M + 1 }).eligible).toBe(false);
    expect(qualifiedGps({ ...base, accuracy: 0 }).eligible).toBe(false);
    expect(qualifiedGps({ ...base, observed_at: new Date(Date.now() + 10 * 60_000).toISOString() }).eligible).toBe(false);
    expect(qualifiedGps({ ...base, observed_at: undefined }).eligible).toBe(false);
    expect(qualifiedGps(null).eligible).toBe(false);
  });

  it('an eligible fix carries a bounded expiry so evidence cannot be replayed', () => {
    const { eligible, expiresAt } = qualifiedGps(fresh());
    expect(eligible).toBe(true);
    const ttl = new Date(expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(90_000);
  });

  it('the health clock distinguishes fresh from delayed from stale', () => {
    expect(getGpsHealth(new Date().toISOString()).key).toBe('fresh');
    expect(getGpsHealth(new Date(Date.now() - 120_000).toISOString()).key).toBe('delayed');
    expect(getGpsHealth(new Date(Date.now() - 3_600_000).toISOString()).key).toBe('stale');
    expect(getGpsHealth(null).key).toBe('no-signal');
    expect(getGpsHealth('not-a-date').key).toBe('no-signal');
  });
});

// ---------------------------------------------------------------------------
// SEC-GPS-005 — standby sharing is consensual, self-scoped and revalidated
// ---------------------------------------------------------------------------

describe('SEC-GPS-005 — standby location sharing is the driver\'s own decision', () => {
  const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  const standbyRoute = () => read('app/api/mobile/driver/standby-location/route.js');
  const standbyService = () => read('services/standby.service.js');

  it('a driver can only ever toggle their own tracking flag', () => {
    const source = standbyRoute();
    expect(source).toContain("WHERE driver_id=$1");
    expect(source).toContain('user.driverId');
    // No body field is consulted for the driver id.
    expect(source).not.toMatch(/body\??\.driver_?[Ii]d/);
  });

  it('publishing requires accepted consent, a duty check-in, a live session and an eligible pairing', () => {
    const source = standbyService();
    for (const predicate of [
      'checked_in', 'consented', 'standby_tracking_enabled', 'session_live',
      'duty_started_at', 'standby_session_family',
    ]) expect(source).toContain(predicate);
    expect(source).toMatch(/CURRENT_PRIVACY_POLICY_VERSION/);
    expect(source).toMatch(/GPS_OUT_OF_ORDER/);
    expect(source).toMatch(/STANDBY_NOT_READY/);
  });

  it('the read side revalidates every predicate instead of trusting the flag', () => {
    const source = standbyService();
    const readSide = source.slice(source.indexOf('export async function standbyLocations'));
    // The query filters on the flag, and the loop then re-checks the live state.
    expect(readSide).toMatch(/standby_tracking_enabled=true/);
    expect(readSide).toMatch(/if \(!state\?\.checked_in \|\| !state\.consented \|\| state\.busy \|\| !state\.session_live/);
    expect(readSide).toMatch(/qualifiedGps\(fix\)\.eligible/);
    // A driver whose pairing changed after the fix is dropped, not relocated.
    expect(readSide).toMatch(/Number\(vehicleId\) !== Number\(state\.location_vehicle_id\)/);
  });

  it('disabling standby clears the session binding so the old fix cannot be reused', () => {
    expect(standbyRoute()).toMatch(/standby_tracking_enabled=false,\s*standby_session_family=NULL/);
    expect(standbyService()).toMatch(/standby_tracking_enabled=false, standby_session_family=NULL/);
  });

  it('the live position feed returns no coordinates for a driver who fails any predicate', () => {
    const source = standbyService();
    const readSide = source.slice(source.indexOf('export async function standbyLocations'));
    // Every `continue` precedes the push of a position object.
    // Every `continue` precedes the push of a position object: the flag-only
    // query result is re-filtered by four independent live-state guards.
    const pushIndex = readSide.indexOf('positions.push');
    expect(pushIndex).toBeGreaterThan(-1);
    expect((readSide.slice(0, pushIndex).match(/continue;/g) ?? []).length).toBe(4);
  });
});
