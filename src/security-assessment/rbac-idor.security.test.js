// SEC-RBAC / SEC-IDOR — authorization matrix and object-level access control.
//
// Authorized assessment tests. These drive the REAL matrix and the REAL
// ownership helpers. No live database: the query layer is mocked so the
// ownership predicate is the only thing under test.
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({ query: vi.fn(async () => ({ rows: [] })), withTransaction: vi.fn() }));

import { query } from '@/lib/db';
import { rolesFor, can, AUTHENTICATED_ROLES, NAV_ROLES, getRequiredRolesForPath } from '@/lib/auth/permissions';
import { assertTripOwnership, assertDispatchOwnership, resolveDriverScope } from '@/lib/api/ownership';
import { ROLES } from '@/lib/constants';

const ALL_ROLES = [ROLES.SYSTEM_ADMIN, ROLES.ADMIN, ROLES.FLEET_MANAGER, ROLES.DISPATCHER, ROLES.DRIVER, ROLES.MANAGEMENT];

const sessionFor = (role, driverId = null) => ({ user: { role, driverId, employeeId: 1 } });

beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue({ rows: [] });
});

// ---------------------------------------------------------------------------
// SEC-RBAC-001 — the matrix fails closed
// ---------------------------------------------------------------------------

describe('SEC-RBAC-001 — authorization fails closed on every malformed identity', () => {
  it('rolesFor never returns a role the app does not know', () => {
    for (const resource of ['reservations', 'vehicles', 'dispatch', 'ai', 'system']) {
      for (const action of ['read', 'create', 'update', 'delete', 'assign', 'approve', 'dispatch']) {
        for (const role of rolesFor(resource, action)) expect(ALL_ROLES).toContain(role);
      }
    }
  });

  it('an unknown resource or action grants nobody but the system_admin bypass', () => {
    expect(rolesFor('not_a_resource', 'read')).toEqual([ROLES.SYSTEM_ADMIN]);
    expect(rolesFor('reservations', 'not_an_action')).toEqual([ROLES.SYSTEM_ADMIN]);
  });

  it('can() denies a missing employee, a missing role, and an unknown role', () => {
    expect(can(null, 'reservations', 'read')).toBe(false);
    expect(can({}, 'reservations', 'read')).toBe(false);
    expect(can({ roles: {} }, 'reservations', 'read')).toBe(false);
    expect(can({ roles: { role_name: 'superuser' } }, 'reservations', 'read')).toBe(false);
    expect(can({ roles: { role_name: 'superuser' } }, 'system', 'read')).toBe(false);
  });

  it('can() denies an unspecified action rather than defaulting to allow', () => {
    for (const role of [ROLES.ADMIN, ROLES.FLEET_MANAGER, ROLES.DISPATCHER, ROLES.DRIVER, ROLES.MANAGEMENT]) {
      expect(can({ roles: { role_name: role } }, 'reservations', 'impersonate')).toBe(false);
      expect(can({ roles: { role_name: role } }, 'system', 'root')).toBe(false);
    }
  });

  it('system_admin is a bypass, not a matrix row — it is included for every resource/action', () => {
    for (const resource of ['reservations', 'vehicles', 'system', 'accounts', 'nonexistent']) {
      for (const action of ['read', 'update', 'delete', 'scan_document', 'nonexistent']) {
        expect(rolesFor(resource, action)).toContain(ROLES.SYSTEM_ADMIN);
      }
    }
  });

  it('AUTHENTICATED_ROLES carries no wildcard and no duplicate', () => {
    expect(AUTHENTICATED_ROLES).not.toContain('*');
    expect(new Set(AUTHENTICATED_ROLES).size).toBe(AUTHENTICATED_ROLES.length);
    expect(AUTHENTICATED_ROLES).toEqual(ALL_ROLES);
  });
});

// ---------------------------------------------------------------------------
// SEC-RBAC-002 — dispatch authority boundary
// ---------------------------------------------------------------------------

describe('SEC-RBAC-002 — who may move a reservation through its lifecycle', () => {
  const AUTHORITIES = ['approve', 'assign', 'dispatch', 'cancel', 'reschedule'];

  it('every lifecycle authority is dispatcher-and-above only', () => {
    for (const action of AUTHORITIES) {
      const allowed = rolesFor('reservations', action);
      expect(allowed.sort()).toEqual([ROLES.ADMIN, ROLES.DISPATCHER, ROLES.FLEET_MANAGER, ROLES.SYSTEM_ADMIN].sort());
      expect(allowed).not.toContain(ROLES.DRIVER);
      expect(allowed).not.toContain(ROLES.MANAGEMENT);
    }
  });

  it('a driver cannot read the reservation book at all', () => {
    expect(rolesFor('reservations', 'read')).not.toContain(ROLES.DRIVER);
    expect(rolesFor('reservations', 'create')).not.toContain(ROLES.DRIVER);
    expect(rolesFor('reservations', 'recommend')).not.toContain(ROLES.DRIVER);
  });

  it('the management observer role holds no dispatch authority whatsoever', () => {
    const FORBIDDEN = {
      reservations: ['create', 'update', 'delete', 'approve', 'assign', 'dispatch', 'cancel', 'reschedule', 'manage_flags', 'recommend'],
      dispatch: ['create', 'update', 'update_all', 'delete'],
      trips: ['create', 'update', 'update_all', 'delete'],
      drivers: ['create', 'update', 'delete', 'manage_account'],
      vehicles: ['create', 'update', 'delete'],
      maintenance: ['create', 'update', 'delete'],
      fuel: ['create', 'update', 'delete'],
      uvvrp: ['update', 'decide', 'manage_exemptions'],
      incidents: ['acknowledge', 'resolve', 'route_to_maintenance'],
      routes: ['seed', 'create', 'update', 'delete'],
      categories: ['create', 'update', 'delete'],
      accounts: ['create', 'read', 'update'],
      settings: ['read', 'update'],
      dispatch_settings: ['read', 'update'],
      ai_settings: ['read', 'update'],
      system: ['read'],
      employees: ['read'],
      ai: ['scan_document'],
      predictive_maintenance: ['read'],
      driver_work_schedules: ['create', 'update', 'delete'],
      driver_leave_requests: ['create', 'update', 'delete'],
      driver_assignments: ['create', 'update', 'delete'],
      substitute_driver_schedules: ['create', 'update', 'delete'],
      fuel_requests: ['review'],
      reports: ['update', 'delete'],
    };
    for (const [resource, actions] of Object.entries(FORBIDDEN)) {
      for (const action of actions) {
        expect(rolesFor(resource, action)).not.toContain(ROLES.MANAGEMENT);
      }
    }
  });

  it('a driver holds only self-service authority outside read-only transport data', () => {
    expect(rolesFor('drivers', 'manage_account')).not.toContain(ROLES.DRIVER);
    expect(rolesFor('accounts', 'read')).not.toContain(ROLES.DRIVER);
    expect(rolesFor('reports', 'read')).not.toContain(ROLES.DRIVER);
    expect(rolesFor('analytics', 'read')).not.toContain(ROLES.DRIVER);
    expect(rolesFor('ai', 'read')).not.toContain(ROLES.DRIVER);
    expect(rolesFor('system', 'read')).not.toContain(ROLES.DRIVER);
    expect(rolesFor('employees', 'update')).not.toContain(ROLES.DRIVER);
    expect(rolesFor('maintenance', 'create')).not.toContain(ROLES.DRIVER);
    expect(rolesFor('vehicles', 'update')).not.toContain(ROLES.DRIVER);
    // …and the self-service it does hold, it holds on purpose.
    expect(rolesFor('driver_leave_requests', 'create')).toContain(ROLES.DRIVER);
    expect(rolesFor('fuel_requests', 'create')).toContain(ROLES.DRIVER);
    expect(rolesFor('trips', 'update')).toContain(ROLES.DRIVER);
  });

  it('no role may grant itself account authority except admin and system_admin', () => {
    expect(rolesFor('accounts', 'update').sort()).toEqual([ROLES.ADMIN, ROLES.SYSTEM_ADMIN].sort());
    expect(rolesFor('accounts', 'create').sort()).toEqual([ROLES.ADMIN, ROLES.SYSTEM_ADMIN].sort());
  });

  it('every authority a role holds implies it can also read the resource', () => {
    // A role that may mutate a resource but not read it would be an incoherent
    // boundary (and usually a typo in the matrix).
    const resources = ['reservations', 'dispatch', 'trips', 'drivers', 'vehicles', 'fuel', 'maintenance', 'routes', 'categories'];
    for (const resource of resources) {
      for (const action of ['create', 'update', 'delete', 'assign', 'approve', 'dispatch']) {
        for (const role of rolesFor(resource, action)) {
          if (role === ROLES.SYSTEM_ADMIN) continue;
          expect(rolesFor(resource, 'read')).toContain(role);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// SEC-RBAC-003 — page guards
// ---------------------------------------------------------------------------

describe('SEC-RBAC-003 — page-level route guards', () => {
  it('administrative pages are restricted to the administering roles', () => {
    expect(NAV_ROLES['/system/audit']).toEqual([ROLES.SYSTEM_ADMIN]);
    expect(NAV_ROLES['/system/errors']).toEqual([ROLES.SYSTEM_ADMIN]);
    expect(NAV_ROLES['/system/health']).toEqual([ROLES.SYSTEM_ADMIN]);
    expect(NAV_ROLES['/settings/users']).toEqual([ROLES.ADMIN, ROLES.SYSTEM_ADMIN]);
    expect(NAV_ROLES['/settings/api']).toEqual([ROLES.ADMIN, ROLES.SYSTEM_ADMIN]);
  });

  it('no page outside the /driver tree admits the driver role', () => {
    for (const [path, roles] of Object.entries(NAV_ROLES)) {
      // NB: /drivers (staff directory) also starts with "/driver" — the driver
      // app tree is exactly "/driver" and "/driver/…".
      if (path === '/driver' || path.startsWith('/driver/')) {
        expect(roles).toEqual([ROLES.DRIVER]);
      } else if (roles !== AUTHENTICATED_ROLES) {
        expect(roles).not.toContain(ROLES.DRIVER);
      }
    }
  });

  it('an unlisted path falls back to the wildcard set, not to allow-all-roles', () => {
    expect(getRequiredRolesForPath('/some/unlisted/page')).toEqual(['*']);
    // A prefix match wins over the wildcard default.
    expect(getRequiredRolesForPath('/system/audit/123')).toEqual([ROLES.SYSTEM_ADMIN]);
  });
});

// ---------------------------------------------------------------------------
// SEC-IDOR-001 — the driver ownership chokepoint
// ---------------------------------------------------------------------------

describe('SEC-IDOR-001 — driver object-level access on trips', () => {
  const tripRow = { trip_id: 55, driver_id: 4, vehicle_id: 7, trip_status: 'Assigned', dispatch_id: 3 };

  it("a driver reading another driver's trip gets 404, not 403 (no existence oracle)", async () => {
    query.mockResolvedValue({ rows: [tripRow] });
    await expect(assertTripOwnership(sessionFor(ROLES.DRIVER, 999), 55))
      .rejects.toMatchObject({ status: 404 });
  });

  it('a driver reading their own trip is allowed', async () => {
    query.mockResolvedValue({ rows: [tripRow] });
    await expect(assertTripOwnership(sessionFor(ROLES.DRIVER, 4), 55)).resolves.toMatchObject({ trip_id: 55 });
  });

  it('a nonexistent trip is the same 404 as a forbidden one', async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(assertTripOwnership(sessionFor(ROLES.DRIVER, 4), 55)).rejects.toMatchObject({ status: 404 });
    await expect(assertTripOwnership(sessionFor(ROLES.DRIVER, 999), 55)).rejects.toMatchObject({ status: 404 });
  });

  it('operations roles act on any trip (the helper is a no-op for them)', async () => {
    query.mockResolvedValue({ rows: [tripRow] });
    for (const role of [ROLES.DISPATCHER, ROLES.FLEET_MANAGER, ROLES.ADMIN, ROLES.SYSTEM_ADMIN]) {
      await expect(assertTripOwnership(sessionFor(role, null), 55)).resolves.toMatchObject({ trip_id: 55 });
    }
  });

  it('a non-numeric id is refused as 400 before any query runs', async () => {
    for (const bad of ['55abc', undefined, {}, 1.5, NaN, '1; DROP TABLE trips']) {
      await expect(assertTripOwnership(sessionFor(ROLES.DRIVER, 4), bad)).rejects.toMatchObject({ status: 400 });
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('OBSERVATION — a null/empty id coerces to 0 and is answered as a plain 404', async () => {
    // Number(null) === 0 and Number.isInteger(0) is true, so the integer guard
    // does not catch a null id: it proceeds to a query for trip_id = 0, finds
    // nothing, and answers 404. Fail-closed, but for the wrong reason — the
    // guard reads as if it validated the id when it only validated its type.
    query.mockResolvedValue({ rows: [] });
    for (const loose of [null, '']) {
      await expect(assertTripOwnership(sessionFor(ROLES.DRIVER, 4), loose)).rejects.toMatchObject({ status: 404 });
    }
    expect(query).toHaveBeenCalled();
  });

  it('a driver whose session carries no driverId matches no trip', async () => {
    // requireDriver guarantees driverId is present, but the helper must not fail
    // open if it is ever called with a null link.
    query.mockResolvedValue({ rows: [tripRow] });
    await expect(assertTripOwnership(sessionFor(ROLES.DRIVER, null), 55)).rejects.toMatchObject({ status: 404 });
  });

  it('the same contract holds for dispatch schedules', async () => {
    query.mockResolvedValue({ rows: [{ dispatch_id: 3, driver_id: 4, vehicle_id: 7, status: 'Scheduled' }] });
    await expect(assertDispatchOwnership(sessionFor(ROLES.DRIVER, 999), 3)).rejects.toMatchObject({ status: 404 });
    await expect(assertDispatchOwnership(sessionFor(ROLES.DRIVER, 4), 3)).resolves.toMatchObject({ dispatch_id: 3 });
    await expect(assertDispatchOwnership(sessionFor(ROLES.DISPATCHER, null), 3)).resolves.toMatchObject({ dispatch_id: 3 });
  });
});

// ---------------------------------------------------------------------------
// SEC-IDOR-002 — list scoping
// ---------------------------------------------------------------------------

describe('SEC-IDOR-002 — a driver can never widen a list query beyond themselves', () => {
  it('forces the caller\'s own driver id regardless of what was requested', () => {
    expect(resolveDriverScope(sessionFor(ROLES.DRIVER, 4), null)).toBe(4);
    expect(resolveDriverScope(sessionFor(ROLES.DRIVER, 4), '')).toBe(4);
    expect(resolveDriverScope(sessionFor(ROLES.DRIVER, 4), String(4))).toBe(4);
  });

  it('rejects (does not silently rewrite) a driver asking for another driver', () => {
    for (const requested of ['999', 999, '0', '-1']) {
      expect(() => resolveDriverScope(sessionFor(ROLES.DRIVER, 4), requested))
        .toThrowError(expect.objectContaining({ status: 403 }));
    }
  });

  it('operations roles may scope to any driver, and to none', () => {
    expect(resolveDriverScope(sessionFor(ROLES.DISPATCHER, null), '999')).toBe(999);
    expect(resolveDriverScope(sessionFor(ROLES.DISPATCHER, null), null)).toBeNull();
    expect(resolveDriverScope(sessionFor(ROLES.DISPATCHER, null), 'not-a-number')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SEC-IDOR-003 — consistency of the refusal shape across the driver surface
// ---------------------------------------------------------------------------

describe('SEC-IDOR-003 — refusal consistency', () => {
  it('OBSERVATION — the expense scan path answers 403 where the ownership helper answers 404', async () => {
    // src/app/api/mobile/expenses/route.js:110-113 throws status 403 with the
    // message "This receipt belongs to another driver", which confirms to the
    // caller that the submission id exists and belongs to someone else. The
    // trip/dispatch helpers deliberately answer the same 404 a missing record
    // gets. Both fail closed — this is an enumeration-oracle inconsistency, not
    // an access-control gap — but the shapes should agree.
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../app/api/mobile/expenses/route.js', import.meta.url), 'utf8');
    expect(source).toMatch(/scanRecord\.driver_id !== session\.user\.driverId/);
    expect(source).toMatch(/This receipt belongs to another driver/);
    expect(source).toMatch(/error\.status = 403/);

    const ownership = readFileSync(new URL('../lib/api/ownership.js', import.meta.url), 'utf8');
    expect(ownership).toMatch(/new AuthError\("Trip not found", 404\)/);
  });
});
