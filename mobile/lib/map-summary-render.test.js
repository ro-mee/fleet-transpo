import { describe, expect, it, vi } from 'vitest';
import { nativeRender, nativeViews, nativeTheme } from './test-helpers/native-render';
import * as presentation from './load-presentation';

const trip = { trip_id: 701, dispatch_number: 'DSP-701', trip_status: 'Trip Started', load_type: 'Cargo', origin: 'Warehouse', destination: 'Hotel receiving bay', cargo_description: 'Kitchen supplies', cargo_weight_kg: 350, vehicle_model: 'Isuzu', vehicle_plate: 'ABC-123', passenger_name: 'Sample guest', passenger_count: 2 };
const deps = { 'react-native': { ...nativeViews, useWindowDimensions: () => ({ width: 390, fontScale: 1 }) }, '@expo/vector-icons': { Ionicons: 'Icon' }, '../../lib/theme-context': nativeTheme, '../../lib/load-presentation': presentation, '../coachmarks': { CoachMarkTarget: 'Target' } };
const render = props => nativeRender(new URL('../components/map/MapTripSummary.jsx', import.meta.url), { props: { trip, cargo: true, ...props }, deps });

describe('compact Map trip-cycle summary', () => {
  it('keeps the current stop and provider estimate in the travelling tray; details expand', async () => {
    const h = await render({ routeData: { lengthInMeters: 5600, travelTimeInSeconds: 1080 }, routeStale: false });
    expect(h.text()).toContain('To pickup'); expect(h.text()).toContain('Warehouse');
    expect(h.text()).toContain('18 min'); expect(h.text()).toContain('5.6 km');
    expect(h.text()).not.toContain('Kitchen supplies'); expect(h.text()).not.toContain('ABC-123');
    h.render({ expanded: true });
    for (const value of ['Kitchen supplies', '350 kg declared', 'ABC-123', 'Hotel receiving bay']) expect(h.text()).toContain(value);
  });
  it.each([['Driver Accepted', 'Ready to start', 'Warehouse'], ['At Pickup', 'At pickup', 'Warehouse'], ['En Route', 'To delivery', 'Hotel receiving bay'], ['Drop-off', 'At delivery', 'Hotel receiving bay']])('uses the correct Cargo stage and target for %s', async (status, stage, target) => {
    const h = await render({ trip: { ...trip, trip_status: status } });
    expect(h.text()).toContain(stage); expect(h.text()).toContain(target);
    if (status === 'Drop-off') expect(h.text()).toContain('ending odometer');
  });
  it('uses Passenger destinations and exposes facts only on expansion', async () => {
    const h = await render({ cargo: false, trip: { ...trip, load_type: 'Passenger', trip_status: 'En Route' } });
    expect(h.text()).toContain('To destination'); expect(h.text()).not.toContain('350 kg');
    h.render({ expanded: true }); expect(h.text()).toContain('Sample guest'); expect(h.text()).toContain('2 passengers');
  });
  it('never presents old or malformed estimates as current', async () => {
    const h = await render({ routeData: { lengthInMeters: 5600, travelTimeInSeconds: 1080 }, routeStale: true, routeDisabledReason: 'GPS is unavailable.' });
    expect(h.text()).not.toContain('18 min'); expect(h.text()).toContain('GPS is unavailable.');
    h.render({ routeStale: false, routeData: { lengthInMeters: -1, travelTimeInSeconds: NaN } });
    expect(h.text()).not.toContain('NaN'); expect(h.text()).not.toContain('-0.0');
  });
  it('retains unknown Cargo start readiness instead of assuming permission to start', async () => {
    const h = await render({ preStart: true, trip: { ...trip, trip_status: 'Driver Accepted' } });
    expect(h.text()).toContain('Start eligibility not confirmed');
  });
});

it('makes assigned work without map coordinates reachable without inventing a pin', async () => {
  const open = vi.fn();
  const h = await nativeRender(new URL('../components/map/MapAssignmentNotice.jsx', import.meta.url), { props: { trips: [{ trip_id: 5, origin: 'Unresolved pickup' }], confirmed: true, onOpen: open }, deps: { 'react-native': nativeViews, '../../lib/theme-context': nativeTheme, '../clay/ClayButton': { ClayButton: 'Button' } } });
  expect(h.find(n => n.component === 'Text').children.join('')).toContain('1 assignment'); expect(h.text()).toContain('pickup location needs verification');
  h.find(n => n.props.label === 'View assignments').props.onPress(); expect(open).toHaveBeenCalledOnce();
  h.render({ confirmed: false }); expect(h.text()).toContain('Refresh to confirm');
});
