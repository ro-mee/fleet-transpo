import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SelectedPairSummary } from './copilot-option-flow';

beforeEach(() => vi.stubGlobal('React', React));
afterEach(() => vi.unstubAllGlobals());
const pair = {
  vehicle_id: 1, driver_id: 2,
  vehicle: {plate_number: 'ABC-1234'}, driver: {driver_name: 'Karlo Rafael Sunga Torres'},
  temporalContext: {horizon: 'FUTURE'},
  scheduleEvidence: {usableSlackMinutes: 1411},
  workloadEvidence: {complete: true, serviceDate: '2026-09-17', completedTrips: 0, activeTrips: 0, scheduledTrips: 0},
  checks: [{id: 'capacity', label: 'Seating capacity', status: 'verified', message: 'Seating capacity: source records checked.'}],
};
const render = (value = pair, pending = false) => renderToStaticMarkup(React.createElement(SelectedPairSummary, {pair: value, optionNumber: 1, pending, now: 0}));

it('collapses verified evidence, removes repeated labels and keeps the schedule readable', () => {
  const html = render();
  expect(html).toContain('23h 31m');
  expect(html).toContain('Karlo Rafael Sunga Torres');
  expect(html).toContain('1 of 1 checks verified');
  expect(html).not.toContain('Seating capacity: source records');
  expect(html).not.toMatch(/<details[^>]*\sopen/);
  expect(html).toContain('2026-09-17');
});

it('keeps unresolved checks outside disclosures and does not turn absent evidence into zero', () => {
  const html = render({...pair, scheduleEvidence: null, workloadEvidence: null, checks: [...pair.checks, {id: 'leave', label: 'Leave', status: 'blocking', message: 'Driver is on leave'}]});
  const visible = html.replace(/<details\b[\s\S]*?<\/details>/g, '');
  expect(visible).toContain('Driver is on leave');
  expect(visible).toContain('Needs attention');
  expect(visible).toContain('Unverified');
  expect(visible).toContain('Service-date workload unavailable');
  expect(html).toContain('1 of 2 checks verified');
});

it('withholds old checks while rechecking and suppresses future live ETA', () => {
  expect(render(pair, true)).not.toContain('checks verified');
  expect(render({...pair, dispatchContext: {liveLocationUsed: true}, proximity: {etaMinutes: 9, expiresAt: '2099-01-01'}})).not.toContain('Live ETA: 9');
});
