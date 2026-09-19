import { it, expect } from 'vitest';
import { resolveEvidence, resolveMaintenance, resolveLeave, resolveGps, resolveComparison, resolveIncident } from './evidence-resolve.service';
import { EVIDENCE_TYPES } from '@/lib/dispatch/evidence-contract';

const dbFor = handlers => ({ query: async (sql, params) => ({ rows: await handlers(sql, params) }) });

it('returns blocking work orders only, never descriptions or costs', async () => {
  const db = dbFor(async sql => {
    if (sql.includes('FROM vehiclemaintenance')) return [{ maintenance_id: 7, maintenance_type: 'Emergency Repair', status: 'In Progress', maintenance_date: '2026-09-16' }];
    if (sql.includes('plate_number')) return [{ plate_number: 'ABC' }];
    return [];
  });
  const facts = await resolveEvidence(db, { proofType: EVIDENCE_TYPES.MAINTENANCE, vehicleId: 1 }, {});
  expect(facts).toMatchObject({ maintenanceId: 7, status: 'In Progress', verdict: 'blocked' });
  expect(facts).not.toHaveProperty('description');
  const clear = await resolveMaintenance({ query: async () => ({ rows: [] }) }, { vehicleId: 9 });
  expect(clear).toMatchObject({ verdict: 'clear' });
});

it('returns overlapping leave only, never leave history', async () => {
  const db = dbFor(async () => [{ status: 'Approved', start_date: '2026-09-18', end_date: '2026-09-19' }]);
  const facts = await resolveEvidence(db, { proofType: EVIDENCE_TYPES.LEAVE, driverId: 3 }, {});
  expect(facts).toMatchObject({ status: 'Approved', verdict: 'blocked' });
  expect(facts).not.toHaveProperty('reason');
  const clear = await resolveLeave({ query: async () => ({ rows: [] }) }, { driverId: 3 });
  expect(clear).toMatchObject({ verdict: 'clear', overlapsBooking: false });
  expect(clear).not.toHaveProperty('history');
});

it('reports GPS health without coordinates and null driver as unevaluated', async () => {
  const db = dbFor(async () => [{ last_location_update: new Date(Date.now() - 30_000).toISOString() }]);
  const fresh = await resolveGps(db, { driverId: 3, horizon: 'IMMEDIATE' });
  expect(fresh.health).toBe('Fresh');
  expect(fresh).not.toHaveProperty('latitude');
  const none = await resolveGps(db, { driverId: null, horizon: 'SCHEDULED' });
  expect(none.health).toBeNull();
});

it('accepts the lib/db query-function shape used in production', async () => {
  const queryFn = async sql => ({ rows: sql.includes('FROM vehiclemaintenance') ? [] : [] });
  const facts = await resolveEvidence(queryFn, { proofType: EVIDENCE_TYPES.MAINTENANCE, vehicleId: 9 }, {});
  expect(facts).toMatchObject({ verdict: 'clear' });
});

it('rejects inactive types at resolve time', async () => {
  const db = dbFor(async () => []);
  await expect(resolveEvidence(db, { proofType: EVIDENCE_TYPES.TRAIL }, {})).rejects.toMatchObject({ code: 'INACTIVE' });
});

it('resolves incidents by signed recordId without leaking private fields', async () => {
  const seen = [];
  const db = dbFor(async (sql, params) => { seen.push(params); return [{ incident_id: 2041, incident_type: 'Breakdown', severity: 'Major', status: 'Open', incident_date: '2026-09-17' }]; });
  const facts = await resolveIncident(db, { recordId: 2041 });
  expect(seen[0]).toEqual([2041]);
  expect(facts).toMatchObject({ incidentId: 2041, verdict: 'blocked' });
  expect(facts).not.toHaveProperty('description');
});

it('compares two options with codes and facts, never scores', async () => {
  const ev = verdict => ({ feasibility: { verdict }, scheduleEvidence: { transferMinutes: 12 },
    workloadEvidence: { complete: true, serviceDate: '2026-09-19', totalTrips: 2 }, reason_type: 'designated' });
  const deps = {
    evaluate: async ({ vehicleId }) => ev(vehicleId === 1 ? 'SAFE' : 'TIGHT'),
    estimateFor: async () => null,
    policyFor: async () => ({}),
    compare: () => ({ code: 'RELIABILITY' }),
  };
  const facts = await resolveComparison(
    dbFor(async () => []),
    { proofType: EVIDENCE_TYPES.COMPARISON, vehicleId: 1, driverId: 2, recordId: '3:4' },
    { requestRow: { request_id: 502 } }, deps);
  expect(facts.optionA).toMatchObject({ vehicleId: 1, reliability: 'SAFE' });
  expect(facts.optionB).toMatchObject({ vehicleId: 3, reliability: 'TIGHT' });
  expect(facts.hierarchy).toEqual(['Reliability', 'Efficiency', 'Workload when applicable', 'Standing preference']);
  expect(JSON.stringify(facts)).not.toMatch(/"order"|"score"/);
});
