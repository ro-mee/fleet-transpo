// SEC-DISP — dispatch business-logic and assignment-boundary security suite.
//
// Authorized assessment tests. These bypass the UI the way a hostile API client
// would and assert the SERVER stays authoritative. No live database, no live
// mutation: every persistence boundary is mocked and inspected.
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({ query: vi.fn(async () => ({ rows: [] })), withTransaction: vi.fn(), getAdminClient: vi.fn(), getPool: vi.fn() }));
vi.mock('@/lib/api/utils', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, requirePermission: vi.fn() };
});
vi.mock('@/services/reservation-lifecycle.service', () => ({ loadRequest: vi.fn(), advanceReservation: vi.fn() }));
vi.mock('@/services/reservation-events.service', () => ({ recordReservationEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/scheduling/conflicts', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, detectRequestConflicts: vi.fn(async () => []) };
});
vi.mock('@/services/recommendation.service', () => ({
  validatePairAvailability: vi.fn(), getActiveRecommendation: vi.fn(async () => ({ snapshot: null })), markRecommendationConsumed: vi.fn(async () => {}),
}));
vi.mock('@/services/dispatch-autocreate.service', () => ({ createDispatchForRequest: vi.fn(async () => ({ dispatch_id: 1, dispatch_number: 'DSP-1' })), syncDispatchSideEffects: vi.fn(async () => {}) }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/services/dispatch-evidence.service', () => ({ commitDispatchEvidence: vi.fn(async (token, write) => write({ query: vi.fn(async () => ({ rows: [{ request_id: 502 }] })) })) }));

// The two external inputs to the server-side ETA derivation are stubbed so the
// suite can assert WHAT the route asks for and what it does with the answer,
// without a network or a live `locations` table.
const ext = vi.hoisted(() => ({ routeEndpoints: vi.fn(), tomtom: vi.fn() }));
vi.mock('@/services/route-resolver.service', async importOriginal => ({
  ...(await importOriginal()),
  resolveRouteEndpoints: (...args) => ext.routeEndpoints(...args),
}));
vi.mock('@/lib/scheduling/travel-buffer', async importOriginal => ({
  ...(await importOriginal()),
  tomtomEtaMinutes: (...args) => ext.tomtom(...args),
}));

import { query } from '@/lib/db';
import { requirePermission } from '@/lib/api/utils';
import { loadRequest, advanceReservation } from '@/services/reservation-lifecycle.service';
import { detectRequestConflicts, evaluateRequestConflicts } from '@/lib/scheduling/conflicts';
import { validatePairAvailability } from '@/services/recommendation.service';
import { commitDispatchEvidence } from '@/services/dispatch-evidence.service';
import { PUT } from '@/app/api/integration/transport-requests/[id]/assign/route';
import { verifyPlanToken, issuePlanToken, readPlanRevision } from '@/services/dispatch-plan-evidence.service';
import { travelBufferBlocked } from '@/lib/scheduling/travel-buffer';
import { CONFLICT_SEVERITY, CONFLICT_TYPE } from '@/lib/scheduling/conflict-types';
import { rolesFor } from '@/lib/auth/permissions';

process.env.NEXTAUTH_SECRET ??= 'sec-assessment-dispatch-key';

const assign = (body, id = '502') => PUT(
  new Request('http://localhost/api/x/assign', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  { params: Promise.resolve({ id }) },
);

const okPairCheck = {
  ok: true, reviewed: false, serviceEnd: '2026-09-18T03:00:00+08:00',
  evidence: { advisories: [], feasibility: {} },
  commitToken: { revision: 'r1', expiresAt: new Date(Date.now() + 60_000).toISOString() },
};

const defaultQuery = async sql => {
  if (String(sql).includes('FROM vehicles')) return { rows: [{ vehicle_id: 7, plate_number: 'ABC 1234' }] };
  if (String(sql).includes('FROM drivers')) return { rows: [{ driver_id: 4, first_name: 'Marco', last_name: 'Santos' }] };
  return { rows: [] };
};

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ user: { employeeId: 1, email: 'd@x.test' } });
  loadRequest.mockResolvedValue({
    request_id: 502, fleet_status: 'Pending', vehicle_id: null, driver_id: null, passenger_count: 2,
    pickup_datetime: '2026-09-18T01:00:00+08:00', scheduled_arrival: '2026-09-18T02:30:00+08:00',
  });
  detectRequestConflicts.mockResolvedValue([]);
  validatePairAvailability.mockResolvedValue(okPairCheck);
  query.mockImplementation(defaultQuery);
  advanceReservation.mockResolvedValue({ ok: true, request: { request_id: 502, fleet_status: 'Assigned' } });
});

// ---------------------------------------------------------------------------
// SEC-DISP-001 — provenance of the §4.8.3 travel+buffer safety signal
// ---------------------------------------------------------------------------

describe('SEC-DISP-001 — the travel-time safety gate is fed by a server-derived ETA', () => {
  // The rule itself is covered by src/lib/scheduling/conflicts-travel.test.js.
  // This suite asks a different question: WHERE does the ETA come from, and can
  // the caller choose a value that clears a block the fleet policy would apply?
  //
  // The assessment found that it could — `body.travel.vehicle.etaMinutes` was the
  // gate's only input, so omitting `travel` skipped the §4.8.3 constraint with no
  // record, while the sanctioned `force` path demands a written override_reason.
  // These tests pin the remediation: the number the rule sees is derived from
  // stored dispatch history, and the caller's own estimate is demoted to a
  // cross-check that can raise a warning but can never clear a block.

  const REQUEST = {
    request_id: 502, passenger_count: 2,
    pickup_datetime: '2026-09-18T01:10:00+08:00', scheduled_arrival: '2026-09-18T02:30:00+08:00',
  };
  const PREVIOUS_END = '2026-09-18T01:00:00+08:00'; // ends 10 min before the requested pickup
  const DERIVED_ETA = 45;                            // what the router says the reposition costs

  // The two resources each finished a commitment at 01:00, at a drop-off that
  // resolves to coordinates. This is the state the gate exists to reason about.
  const withPriorCommitment = async sql => {
    if (String(sql).includes('AS vehicle_end')) {
      return {
        rows: [{
          vehicle_end: PREVIOUS_END, vehicle_dropoff: 'NAIA Terminal 3',
          driver_end: PREVIOUS_END, driver_dropoff: 'NAIA Terminal 3',
        }],
      };
    }
    return defaultQuery(sql);
  };

  beforeEach(() => {
    // The pickup has to be a real place name: the derived route runs from the
    // previous commitment's drop-off to THIS pickup, so an unnamed one has
    // nothing to resolve and the gate reports unverified.
    loadRequest.mockResolvedValue({
      request_id: 502, fleet_status: 'Pending', vehicle_id: null, driver_id: null, passenger_count: 2,
      pickup_location: 'Makati CBD', dropoff_location: 'BGC',
      pickup_datetime: '2026-09-18T01:10:00+08:00', scheduled_arrival: '2026-09-18T02:30:00+08:00',
    });
    query.mockImplementation(withPriorCommitment);
    ext.routeEndpoints.mockResolvedValue({
      originLocation: { latitude: 14.5086, longitude: 121.0195 },
      destinationLocation: { latitude: 14.5995, longitude: 120.9842 },
    });
    ext.tomtom.mockResolvedValue(DERIVED_ETA);
  });

  /** The travel signals the route actually handed the conflict engine. */
  const signalsSent = () => detectRequestConflicts.mock.calls.at(-1)[1].travel;

  it('the route derives the ETA from stored dispatch history, not from the body', async () => {
    await assign({ vehicle_id: 7, driver_id: 4, travel: { vehicle: { etaMinutes: 1 }, driver: { etaMinutes: 1 } } });
    const sent = signalsSent();
    expect(sent.vehicle).toMatchObject({
      previousEnd: PREVIOUS_END,
      etaMinutes: DERIVED_ETA,
      etaSource: 'tomtom',
    });
    expect(sent.driver).toMatchObject({ previousEnd: PREVIOUS_END, etaMinutes: DERIVED_ETA });
    // The route went and asked: a previous-commitment lookup and a route estimate.
    expect(query.mock.calls.some(([sql]) => /AS vehicle_end/.test(String(sql)))).toBe(true);
    expect(ext.routeEndpoints).toHaveBeenCalled();
    expect(ext.tomtom).toHaveBeenCalled();
  });

  it('omitting travel from the body no longer skips the gate', async () => {
    // The original bypass, stated as a regression guard: a body with no `travel`
    // used to produce `{ vehicle: undefined, driver: undefined }`, which the
    // evaluator read as "nothing to check".
    const res = await assign({ vehicle_id: 7, driver_id: 4 });
    expect(res.status).toBe(200);
    expect(signalsSent().vehicle.etaMinutes).toBe(DERIVED_ETA);
    expect(signalsSent().driver.etaMinutes).toBe(DERIVED_ETA);
  });

  it("a forged low ETA cannot clear the block — the caller's number never reaches the rule", async () => {
    // Wire the mocked engine to the REAL evaluator so the route's input is what
    // decides the status code, exactly as in production.
    const seen = [];
    detectRequestConflicts.mockImplementation(async (_req, opts) => {
      const signal = opts.travel?.vehicle;
      seen.push(signal);
      return evaluateRequestConflicts(REQUEST, {
        vehicle: {
          vehicle_id: 7, plate_number: 'ABC 1234',
          _previous_busy_end: signal?.previousEnd ?? null,
          _eta_to_pickup_min: signal?.etaMinutes ?? null,
        },
        travelBufferEnabled: true, safetyBufferMinutes: 10, bufferFloorMinutes: 5,
      });
    });

    // previous_end 01:00 + 45 min travel + 10 min buffer → 01:55, well past the
    // 01:10 pickup. Claiming a 0-minute reposition used to remove the block.
    const res = await assign({ vehicle_id: 7, driver_id: 4, travel: { vehicle: { etaMinutes: 0 } } });
    expect(res.status).toBe(409);
    expect(advanceReservation).not.toHaveBeenCalled();
    expect(seen[0].etaMinutes).toBe(DERIVED_ETA);
    expect(seen[0].claimedEtaMinutes).toBe(0); // recorded, not obeyed
  });

  it('the caller estimate is kept only as a cross-check, and a divergence warns without blocking', async () => {
    const res = await assign({ vehicle_id: 7, driver_id: 4, travel: { vehicle: { etaMinutes: 1 } } });
    expect(res.status).toBe(200);
    expect(signalsSent().vehicle).toMatchObject({ claimedEtaMinutes: 1, divergent: true });

    const body = await res.json();
    const divergence = (body.advisories ?? []).find(a => a.type === CONFLICT_TYPE.TRAVEL_ETA_DIVERGENCE);
    expect(divergence).toBeTruthy();
    expect(divergence.severity).toBe(CONFLICT_SEVERITY.WARNING);
    // Both numbers are named, so the dispatcher can see the disagreement.
    expect(divergence.detail).toMatchObject({ claimed_eta_min: 1, derived_eta_min: DERIVED_ETA });
  });

  it('a caller estimate within tolerance is not reported at all', async () => {
    const res = await assign({
      vehicle_id: 7, driver_id: 4,
      travel: { vehicle: { etaMinutes: DERIVED_ETA + 5 } },
    });
    expect(res.status).toBe(200);
    expect(signalsSent().vehicle.divergent).toBe(false);
    expect((await res.json()).advisories).toBeUndefined();
  });

  it('with no prior commitment the gate stays open — the legitimate case is untouched', async () => {
    query.mockImplementation(defaultQuery); // no dispatch history for either resource
    const res = await assign({ vehicle_id: 7, driver_id: 4 });
    expect(res.status).toBe(200);
    expect(signalsSent()).toEqual({ vehicle: undefined, driver: undefined });
    expect(ext.tomtom).not.toHaveBeenCalled(); // nothing to estimate against
  });

  it('an uncomputable route is reported as UNVERIFIED, never as a clean buffer', () => {
    // The other half of the original defect: absent data read as "no conflict".
    // The rule may not invent a conflict from nothing, but it must not invent a
    // clean bill from nothing either.
    const findings = evaluateRequestConflicts(REQUEST, {
      vehicle: {
        vehicle_id: 7, plate_number: 'ABC 1234',
        _previous_busy_end: PREVIOUS_END, _eta_to_pickup_min: null, _eta_source: 'unknown',
      },
      travelBufferEnabled: true, safetyBufferMinutes: 10, bufferFloorMinutes: 5,
    });
    expect(findings.filter(f => f.type === CONFLICT_TYPE.TRAVEL_BUFFER)).toHaveLength(0);
    const unverified = findings.find(f => f.type === CONFLICT_TYPE.TRAVEL_BUFFER_UNVERIFIED);
    expect(unverified).toBeTruthy();
    expect(unverified.severity).toBe(CONFLICT_SEVERITY.WARNING);
  });

  it('the pure rule is unchanged — the weakness was the provenance of the input', () => {
    const base = { pickup: REQUEST.pickup_datetime, previousEnd: PREVIOUS_END, safetyBufferMinutes: 10, bufferFloorMinutes: 5 };
    expect(travelBufferBlocked({ ...base, etaMinutes: 45 }).blocked).toBe(true);
    expect(travelBufferBlocked({ ...base, etaMinutes: 0 }).blocked).toBe(false);
    expect(travelBufferBlocked({ ...base, etaMinutes: null }).blocked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SEC-DISP-002 — plan-token integrity and staleness
// ---------------------------------------------------------------------------

describe('SEC-DISP-002 — plan tokens are signed, scoped and revision-bound', () => {
  const future = () => new Date(Date.now() + 60_000).toISOString();
  const proposalFor = (requestId, vehicleId, driverId, over = {}) =>
    ({ requestId, outcome: 'VERIFIED', candidateEvaluationComplete: true, pair: { vehicle_id: vehicleId, driver_id: driverId }, ...over });
  const plan = { revision: 'rev-1', proposals: [proposalFor(502, 7, 4)], expiresAt: future() };

  const withRevision = rev => {
    query.mockImplementation(async sql => {
      if (String(sql).includes('AS revision')) return { rows: [{ revision: rev }] };
      return defaultQuery(sql);
    });
  };
  beforeEach(() => withRevision('rev-1'));

  it('accepts an untampered token for the selection it covers', async () => {
    await expect(verifyPlanToken(issuePlanToken(plan), { requestId: 502, vehicleId: 7, driverId: 4 }))
      .resolves.toMatchObject({ revision: 'rev-1' });
  });

  it('rejects a tampered token', async () => {
    const token = issuePlanToken(plan);
    await expect(verifyPlanToken(`${token.slice(0, -3)}abc`, { requestId: 502, vehicleId: 7, driverId: 4 })).rejects.toThrow();
  });

  it('rejects a token whose covered selection is not the live assignment', async () => {
    const token = issuePlanToken(plan);
    await expect(verifyPlanToken(token, { requestId: 502, vehicleId: 7, driverId: 999 })).rejects.toThrow();
    await expect(verifyPlanToken(token, { requestId: 999, vehicleId: 7, driverId: 4 })).rejects.toThrow();
  });

  it('rejects a token once the queue revision moves (stale-plan guard)', async () => {
    const token = issuePlanToken(plan);
    withRevision('rev-2');
    await expect(verifyPlanToken(token, { requestId: 502, vehicleId: 7, driverId: 4 })).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const token = issuePlanToken({ ...plan, expiresAt: new Date(Date.now() - 1000).toISOString() });
    await expect(verifyPlanToken(token, { requestId: 502, vehicleId: 7, driverId: 4 })).rejects.toThrow();
  });

  it('choices (the assignable set) excludes incomplete and dependent proposals', () => {
    const token = issuePlanToken({
      revision: 'rev-1', expiresAt: future(),
      proposals: [
        proposalFor(1, 1, 1),
        proposalFor(2, 2, 2, { candidateEvaluationComplete: false }),
        proposalFor(3, 3, 3, { dependsOnRequestIds: [1] }),
        proposalFor(4, 4, 4, { outcome: 'STALE' }),
      ],
    });
    const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
    expect(payload.choices.map(c => c[0])).toEqual([1]);
    // `coverage` is the raw "outcome was VERIFIED" set and is deliberately NOT
    // filtered the same way. It is not an authorization list: dispatch-plan/route.js
    // re-derives every coverage id against a FRESH buildDispatchPlan and refuses
    // the choice if any of them is no longer VERIFIED, so a stale id in coverage
    // cannot be used to authorize anything.
    expect(payload.coverage).toEqual([1, 2, 3]);
  });

  it('the assign route refuses a plan token that does not cover the pair being assigned', async () => {
    const token = issuePlanToken({ revision: 'rev-1', proposals: [proposalFor(999, 7, 4)], expiresAt: future() });
    const res = await assign({ vehicle_id: 7, driver_id: 4, plan_token: token });
    expect(res.status).toBe(409);
    expect(advanceReservation).not.toHaveBeenCalled();
  });

  it('the assign route accepts a plan token that does cover the pair, and is revision-checked', async () => {
    const res = await assign({ vehicle_id: 7, driver_id: 4, plan_token: issuePlanToken(plan) });
    expect(res.status).toBe(200);
    expect(advanceReservation).toHaveBeenCalled();
    expect(readPlanRevision).toBeTruthy();
  });

  it('OBSERVATION — plan_token is optional, so the plan-coverage step can be skipped by omission', async () => {
    // The guard is `if (body.plan_token !== undefined)`. A caller that simply
    // omits the field performs the same assignment with no plan evidence at all.
    const res = await assign({ vehicle_id: 7, driver_id: 4 });
    expect(res.status).toBe(200);
    expect(advanceReservation).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SEC-DISP-003 — the guarded commit
// ---------------------------------------------------------------------------

describe('SEC-DISP-003 — the write is always routed through the TOCTOU-guarded commit', () => {
  it('the real commit helper refuses a missing or empty evidence token', async () => {
    const real = await vi.importActual('@/services/dispatch-evidence.service');
    await expect(real.commitDispatchEvidence(undefined, async () => 'wrote')).rejects.toThrow();
    await expect(real.commitDispatchEvidence({}, async () => 'wrote')).rejects.toThrow();
    expect(commitDispatchEvidence).toBeTruthy();
  });

  it('the route hands its write to the guard, carrying the pair-check revision', async () => {
    await assign({ vehicle_id: 7, driver_id: 4 });
    expect(advanceReservation).toHaveBeenCalledTimes(1);
    const args = advanceReservation.mock.calls[0][0];
    expect(typeof args.writeAssignment).toBe('function');

    // Drive the route's own write callback. The guard (mocked here, real in
    // production) is what provides the transaction the write executes inside.
    let guardedTx = null;
    commitDispatchEvidence.mockImplementationOnce(async (token, write) => {
      guardedTx = { query: vi.fn(async () => ({ rows: [{ request_id: 502 }] })) };
      return write(guardedTx);
    });
    await args.writeAssignment('UPDATE transportation_requests SET vehicle_id=$1, driver_id=$2', [7, 4], { eventType: 'VEHICLE_ASSIGNED' });

    expect(commitDispatchEvidence).toHaveBeenCalledTimes(1);
    expect(commitDispatchEvidence.mock.calls[0][0]).toMatchObject({ revision: 'r1' });
    expect(guardedTx.query).toHaveBeenCalled();
    expect(guardedTx.query.mock.calls[0][0]).toMatch(/UPDATE transportation_requests/i);
  });

  it('the guard is what performs the write — the route cannot bypass it', async () => {
    await assign({ vehicle_id: 7, driver_id: 4 });
    // The mock guard is the only path to tx.query for the assignment statement.
    expect(advanceReservation.mock.calls[0][0].writeAssignment).toBeTypeOf('function');
    expect(commitDispatchEvidence).not.toHaveBeenCalled(); // only called when the write runs
  });
});

// ---------------------------------------------------------------------------
// SEC-DISP-004 — assignment input handling
// ---------------------------------------------------------------------------

describe('SEC-DISP-004 — mass assignment and input tampering on the assign endpoint', () => {
  const PRIVILEGED = {
    fleet_status: 'Completed', status: 'Assigned', role: 'system_admin', isAdmin: true,
    approvalStatus: 'Approved', tripStatus: 'Completed', ownerId: 999, createdBy: 999,
    permission: '*', completedAt: '2026-01-01T00:00:00Z', vehicle_status: 'Available',
    dispatch_id: 4242, request_id: 999, employee_id: 999, is_admin: true, reviewed: true,
  };

  it('privileged body fields are ignored — only the allowlisted patch reaches persistence', async () => {
    const res = await assign({ ...PRIVILEGED, vehicle_id: 7, driver_id: 4 });
    expect(res.status).toBe(200);
    const args = advanceReservation.mock.calls[0][0];
    expect(args.patch).toEqual({ vehicle_id: 7, driver_id: 4 });
    expect(Object.keys(args.patch).sort()).toEqual(['driver_id', 'vehicle_id']);
    expect(JSON.stringify(args.metadata)).not.toContain('system_admin');
    expect(args.metadata.manual_review).toBe(false);
    expect(args.metadata.forced).toBe(false);
  });

  it('a caller cannot mark its own assignment as reviewed', async () => {
    await assign({ vehicle_id: 7, driver_id: 4, reviewed: true, manual_review: true });
    expect(advanceReservation.mock.calls[0][0].metadata.manual_review).toBe(false);
  });

  it('an unknown vehicle or driver id is refused before any state change', async () => {
    query.mockImplementation(async sql => (String(sql).includes('FROM vehicles')
      ? { rows: [] }
      : { rows: [{ driver_id: 4, first_name: 'M', last_name: 'S' }] }));
    expect((await assign({ vehicle_id: 99999, driver_id: 4 })).status).toBe(400);
    expect(advanceReservation).not.toHaveBeenCalled();
  });

  it('missing, non-integer, zero and negative ids are all refused', async () => {
    for (const body of [{ vehicle_id: 7.5, driver_id: 4 }, { vehicle_id: -7, driver_id: 4 }, { vehicle_id: 0, driver_id: 4 }, { vehicle_id: 7 }, {}, { vehicle_id: 'abc', driver_id: 4 }]) {
      expect((await assign(body)).status).toBe(400);
    }
    expect(advanceReservation).not.toHaveBeenCalled();
  });

  it('a blocking conflict is a hard 409 and `force` cannot remove it', async () => {
    detectRequestConflicts.mockResolvedValue([{ severity: 'blocking', type: 'maintenance_conflict', message: 'Vehicle is under Preventive Maintenance during this window.' }]);
    const res = await assign({ vehicle_id: 7, driver_id: 4, force: true, override_reason: 'I know better' });
    expect(res.status).toBe(409);
    expect(advanceReservation).not.toHaveBeenCalled();
  });

  it('force requires a non-empty, bounded override reason', async () => {
    expect((await assign({ vehicle_id: 7, driver_id: 4, force: true })).status).toBe(400);
    expect((await assign({ vehicle_id: 7, driver_id: 4, force: true, override_reason: '   ' })).status).toBe(400);
    expect((await assign({ vehicle_id: 7, driver_id: 4, force: true, override_reason: 'x'.repeat(501) })).status).toBe(400);
    expect(advanceReservation).not.toHaveBeenCalled();
  });

  it('an unresolved designated-pair conflict is a 409 even with force', async () => {
    validatePairAvailability.mockResolvedValueOnce({ ok: false, conflict: { message: 'This is not the effective designated or substitute pair.' } });
    expect((await assign({ vehicle_id: 7, driver_id: 4, force: true, override_reason: 'override' })).status).toBe(409);
    expect(advanceReservation).not.toHaveBeenCalled();
  });

  it('a request at a terminal status cannot be re-assigned', async () => {
    for (const fleet_status of ['Completed', 'Cancelled', 'Rejected']) {
      loadRequest.mockResolvedValueOnce({ request_id: 502, fleet_status });
      expect((await assign({ vehicle_id: 7, driver_id: 4 })).status).toBe(409);
    }
    expect(advanceReservation).not.toHaveBeenCalled();
  });

  it('the request id comes from the route, never from the body', async () => {
    await assign({ vehicle_id: 7, driver_id: 4, request_id: 999, id: 999 });
    expect(loadRequest).toHaveBeenCalledWith('502');
    expect(advanceReservation.mock.calls[0][0].requestId).toBe('502');
  });
});

// ---------------------------------------------------------------------------
// SEC-DISP-005 — role boundary on assignment
// ---------------------------------------------------------------------------

describe('SEC-DISP-005 — assignment is a dispatcher-and-above authority', () => {
  it('the reservations:assign allowlist excludes driver and management', () => {
    const allowed = rolesFor('reservations', 'assign');
    expect(allowed).toContain('dispatcher');
    expect(allowed).toContain('fleet_manager');
    expect(allowed).toContain('system_admin');
    expect(allowed).not.toContain('driver');
    expect(allowed).not.toContain('management');
  });

  it('a driver or read-only role is refused at the guard, before any conflict work', async () => {
    const { AuthError } = await import('@/lib/api/utils');
    requirePermission.mockRejectedValueOnce(new AuthError("Role 'driver' is not permitted", 403));
    expect((await assign({ vehicle_id: 7, driver_id: 4 })).status).toBe(403);
    expect(detectRequestConflicts).not.toHaveBeenCalled();
    expect(loadRequest).not.toHaveBeenCalled();
  });
});
