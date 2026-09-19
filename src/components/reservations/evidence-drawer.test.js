import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn(async () => ({})) }));
import { apiFetch } from '@/lib/api/client';
import { fetchEvidence, EvidenceBody, EvidenceDrawer, EligibilityInspector, ComparisonCard, buildInspectorRows } from './evidence-drawer';

beforeEach(() => { vi.stubGlobal('React', React); vi.clearAllMocks(); });

const leaveData = {
  title: 'Leave Evidence', managingModule: 'Attendance & Leave', checkedAt: '2026-09-17T17:42:10+08:00',
  facts: { driverName: 'Marco Santos', status: 'Approved', startDate: '2026-09-18', endDate: '2026-09-19', overlapsBooking: true, verdict: 'blocked' },
};
const renderBody = (data, planStatus) => renderToStaticMarkup(React.createElement(EvidenceBody, { data, proofType: 'leave', planStatus }));

it('fetches exactly one point-in-time snapshot per proof via GET', async () => {
  await fetchEvidence(502, 'ev_abc.123');
  expect(apiFetch).toHaveBeenCalledTimes(1);
  expect(apiFetch).toHaveBeenCalledWith(
    '/api/integration/transport-requests/502/evidence?ref=ev_abc.123',
    { method: 'GET' }
  );
});

it('renders read-only proof with source, checked time and no mutation surface', () => {
  const html = renderBody(leaveData, null);
  expect(html).toContain('Marco Santos');
  expect(html).toContain('Attendance &amp; Leave');
  expect(html).toContain('read-only here');
  expect(html).not.toMatch(/<button|<input|<select|<form/);
  expect(html).not.toContain('Conditions have changed');
});

it('shows the stale warning without rewriting the snapshot when plan state is invalid', () => {
  const html = renderBody(leaveData, { isInvalid: true, invalidReason: 'Queue plan changed.' });
  expect(html).toContain('Conditions have changed since this evidence was checked');
  expect(html).toContain('Marco Santos');
  expect(html).toContain('Recheck reservation in the panel');
});

it('renders the conflict timeline for schedule conflicts', () => {
  const html = renderToStaticMarkup(React.createElement(EvidenceBody, {
    proofType: 'schedule_conflict', planStatus: null,
    data: { title: 'Schedule Conflict', managingModule: 'Fleet Management', facts: { existingDeparture: '2026-09-19T17:30:00+08:00', requestedPickup: '2026-09-19T18:00:00+08:00', verdict: 'blocked' } },
  }));
  expect(html).toContain('CONFLICT');
});

it('drawer shell renders loading state with close-only chrome', () => {
  const html = renderToStaticMarkup(React.createElement(EvidenceDrawer, { requestId: 502, proof: { type: 'leave', ref: 'ev_x' }, planStatus: null, onClose: () => {} }));
  expect(html).toContain('Read-only evidence');
  expect(html).toContain('Loading verified evidence');
  expect(html).toContain('Close');
  expect(html).not.toMatch(/Edit|Delete|Approve/);
});

it('builds inspector rows with bounded copy and future GPS as not applicable', () => {
  const rows = buildInspectorRows(
    [{ checkId: 'capacity', label: 'Seating capacity', status: 'verified', proof: { type: 'capacity', ref: 'ev_c' } },
     { checkId: 'schedule', label: 'Duty, leave and resource schedule', status: 'blocking', proof: null }],
    { horizon: 'FUTURE', gpsHealth: null }
  );
  expect(rows[0]).toMatchObject({ label: 'Seating capacity', state: 'clear', proof: { type: 'capacity' } });
  expect(rows[1]).toMatchObject({ label: 'Duty, leave and resource schedule', state: 'blocked', proof: null });
  expect(rows.at(-1)).toMatchObject({ label: 'Current GPS', state: 'na' });
  const immediate = buildInspectorRows([], { horizon: 'IMMEDIATE', gpsHealth: 'Fresh' });
  expect(immediate.at(-1)).toMatchObject({ label: 'GPS Health', state: 'clear' });
});

it('inspector renders locked eligibility copy without absolute guarantees', () => {
  const html = renderToStaticMarkup(React.createElement(EligibilityInspector, {
    pairLabel: 'Marco Santos + ABC', horizon: 'SCHEDULED',
    rows: [{ label: 'Seating capacity', state: 'clear', note: 'No blocking issue found', proof: { type: 'capacity', ref: 'ev_c' } }],
    onReviewProof: () => {},
  }));
  expect(html).toContain('Eligible based on the evaluated server evidence');
  expect(html).toContain('SCHEDULED');
  expect(html).toContain('Review');
  expect(html).not.toMatch(/definitely|guarantee|all clear|therefore assign/i);
  expect(html).not.toMatch(/<input|<select|<form/);
});

it('comparison card shows codes and facts without scores', () => {
  const html = renderToStaticMarkup(React.createElement(ComparisonCard, {
    planStatus: null,
    data: {
      title: 'Option Comparison', managingModule: 'Dispatch Copilot', checkedAt: '2026-09-17T17:42:10+08:00',
      facts: {
        optionA: { vehicleId: 1, reliability: 'SAFE', transferMinutes: 12, workload: { totalTrips: 4, serviceDate: '2026-09-19' }, standing: 'Standing pair' },
        optionB: { vehicleId: 3, reliability: 'SAFE', transferMinutes: 25, workload: { totalTrips: 2, serviceDate: '2026-09-19' }, standing: 'Non-standing' },
        hierarchy: ['Reliability', 'Efficiency'], verdict: 'clear',
      },
    },
  }));
  expect(html).toContain('Option 1');
  expect(html).toContain('Option 2');
  expect(html).toContain('Reliability');
  expect(html).not.toMatch(/score|87\/100|points/i);
  expect(html).not.toMatch(/<button|<input|<select|<form/);
});

it('renders an unevaluated pairing as no claim, never as a blocking result', () => {
  // resolvePairing returns null facts when there is no driver to look the pairing
  // up for, so the drawer must state neither a pairing state nor a result. Both
  // keys render through the existing null path as "—"; anything else here would
  // be the drawer asserting a check that never ran. Static markup only — this is
  // not a browser observation.
  const html = renderToStaticMarkup(React.createElement(EvidenceBody, {
    proofType: 'pairing', planStatus: null,
    data: { title: 'Pairing Evidence', managingModule: 'Fleet Management', facts: { plate: 'ABC 1234', pairingState: null, verdict: null } },
  }));
  expect(html).toContain('Pairing');
  expect(html).toContain('ABC 1234');
  expect(html).toContain('>—<');
  expect(html).not.toContain('Blocking');
  expect(html).not.toContain('none');
});
