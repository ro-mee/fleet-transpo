import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transform } from 'esbuild';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import * as loadPresentation from './load-presentation';

const native = tag => function Primitive({ children, testID }) { return React.createElement(tag, { 'data-testid': testID }, children); };
const { code } = await transform(readFileSync(new URL('../components/TripOperationalSummary.jsx', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs' });
const scope = { exports: {} };
const dependencies = {
  react: React,
  'react-native': { StyleSheet: { create: value => value, hairlineWidth: 1 }, View: native('div'), Text: native('span') },
  '@expo/vector-icons': { Ionicons: ({ name }) => React.createElement('i', { 'data-icon': name }) },
  '../lib/theme-context': { useTheme: () => ({ colors: new Proxy({}, { get: () => '#285448' }), type: {} }) },
  '../lib/theme': { fonts: {}, statusColors: () => ({ bg: '#dce9e3', fg: '#17382f' }) },
  '../lib/load-presentation': loadPresentation,
  './clay/ClayCard': { ClayCard: native('div') },
  './clay/ClayButton': { ClayButton: ({ label }) => React.createElement('button', null, label) },
  './coachmarks': { CoachMarkTarget: native('div') },
};
runInNewContext(code, { module: scope, exports: scope.exports, React, require: name => {
  if (!dependencies[name]) throw new Error(`Unexpected summary dependency ${name}`);
  return dependencies[name];
} });
const Summary = scope.exports.default;
const trip = { trip_id: 701, dispatch_number: 'DSP-701', load_type: 'Cargo', trip_status: 'Trip Started', origin: 'Warehouse', destination: 'Hotel loading bay', cargo_description: 'Fresh vegetables', cargo_weight_kg: 650, passenger_name: 'Ghost Guest', passenger_count: 9, vehicle_model: 'Hiace', vehicle_plate: 'ABC-123' };
const render = (props = {}) => renderToStaticMarkup(React.createElement(Summary, { cargo: true, trip, ...props }));

describe('real Cargo Map summary presentation', () => {
  it('keeps vehicle details out of the compact navigation sheet but available when expanded', () => {
    expect(render()).not.toContain('ABC-123');
    expect(render({ expanded: true })).toContain('Hiace');
    expect(render({ expanded: true })).toContain('ABC-123');
  });
  it('puts the reference before cargo, shows actual vehicle/load and excludes passenger UI', () => {
    const html = render({ expanded: true });
    for (const text of ['DSP-701', 'To pickup', 'Warehouse', 'Fresh vegetables', '650 kg declared', 'Hiace', 'ABC-123']) expect(html).toContain(text);
    expect(html.indexOf('DSP-701')).toBeLessThan(html.indexOf('Fresh vegetables'));
    for (const text of ['Ghost Guest', 'Passenger Info', 'data-icon="people"', 'data-icon="person"']) expect(html).not.toContain(text);
  });
  it.each([['At Pickup', 'Arrived at pickup', 'Pickup target'], ['Passenger Onboard', 'En route to delivery', 'Delivery target'], ['En Route', 'En route to delivery', 'Delivery target'], ['Drop-off', 'At Delivery', 'Delivery target']])('presents %s with cargo stage and current target', (status, stage, targetLabel) => {
    const html = render({ trip: { ...trip, trip_status: status } });
    expect(html).toContain(stage); expect(html).toContain(targetLabel);
    if (targetLabel === 'Delivery target') expect(html).toContain('Hotel loading bay');
  });
  it('shows real route numbers and both stops in the expanded assignment preview', () => {
    const html = render({ preStart: true, readinessText: 'Pre-Trip passed · Ready to start', expanded: true, routeData: { lengthInMeters: 12300, travelTimeInSeconds: 1500 } });
    for (const text of ['Cargo assignment', 'Route preview', '12.3 km · 25 min', 'Pickup', 'Delivery', 'Warehouse', 'Hotel loading bay', 'Ready to start']) expect(html).toContain(text);
  });
  it('does not show stale live estimates as valid', () => {
    const html = render({ routeStale: true, routeData: { lengthInMeters: 12300, travelTimeInSeconds: 1500 }, trip: { ...trip, estimated_distance: 30, estimated_duration: 60 } });
    expect(html).toContain('Route unavailable'); expect(html).toContain('Planned pickup to delivery · 30.0 km · 60 min'); expect(html).not.toContain('12.3 km · 25 min');
  });
  it('explains missing GPS and weight without inventing information', () => {
    const html = render({ expanded: true, trip: { ...trip, cargo_weight_kg: null, vehicle_model: null, vehicle_plate: null }, routeDisabledReason: 'Waiting for GPS location.' });
    expect(html).toContain('Waiting for GPS location.'); expect(html).toContain('Declared weight not supplied'); expect(html).toContain('Assigned vehicle details unavailable'); expect(html).not.toContain('0 kg');
  });
  it('uses the actual start window and inspection gate', () => {
    expect(render({ preStart: true, readinessText: 'Cargo Pre-Trip inspection required' })).toContain('Cargo Pre-Trip inspection required');
    expect(render({ preStart: true, readinessText: 'Start window opens at 09:45 AM', pickupAt: '10:00 AM' })).toContain('Start window opens at 09:45 AM');
  });
  it.each(['Start timing not supplied. Check trip details before starting.', 'Connect online and refresh your profile and current trip before continuing.', 'Saved trip type does not match your driver type.'])('preserves the real readiness hold: %s', readinessText => {
    const html = render({ preStart: true, readinessText });
    expect(html).toContain(readinessText); expect(html).not.toContain('Ready to start');
  });
  it('never assumes start readiness from absent timing or confirmation props', () => {
    expect(render({ preStart: true })).toContain('Start eligibility not confirmed');
    expect(render({ preStart: true })).not.toContain('Ready to start');
  });
  it('preserves the Passenger presentation subtree exactly', () => {
    const child = React.createElement('section', { 'data-testid': 'passenger-sheet' }, React.createElement('h2', null, 'Passenger Info'), React.createElement('p', null, 'Hotel Guest · 2 Guests'));
    expect(render({ cargo: false, children: child })).toBe(renderToStaticMarkup(child));
  });
  it('renders a small standby surface with no stale assignment', () => {
    const html = renderToStaticMarkup(React.createElement(scope.exports.CargoMapStandby));
    expect(html).toContain("You&#x27;re on standby"); expect(html).toContain('Waiting for a cargo assignment.'); expect(html).not.toContain('DSP-701'); expect(html).not.toContain('Warehouse');
  });
  it('renders the confirmed completion reference and real trip-details entry without old target', () => {
    const html = renderToStaticMarkup(React.createElement(scope.exports.CargoMapStandby, { completed: { tripId: 701, reference: 'DSP-701' } }));
    for (const text of ['Trip completed', 'DSP-701', 'Returning to standby.', 'View trip details', 'Dismiss']) expect(html).toContain(text);
    expect(html).not.toContain('Warehouse'); expect(html).not.toContain('Fresh vegetables');
  });
  it('fences the retained confirmation by account and session and clears on driver-mode changes', () => {
    const map = readFileSync(new URL('../app/(app)/(tabs)/map.js', import.meta.url), 'utf8');
    expect(map).toContain("completedCargo.session.actorId !== String(user?.employeeId) || profile?.driverType !== 'Cargo' || !isCurrentCargoSession(completedCargo.session)");
    expect(map).toContain("signal.addEventListener('abort', clear)");
    expect(map).toContain("completedCargo?.session?.actorId === String(user?.employeeId) && isCurrentCargoSession(completedCargo?.session)");
    expect(map).toContain("String(event.tripId) !== String(activeTripRef.current?.trip_id)");
  });
});
