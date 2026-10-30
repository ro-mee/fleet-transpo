import React from 'react';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import * as detail from './trip-detail';
import * as presentation from './load-presentation';
import { resolveDriverWorkspace } from './driver-workspace';
import * as checklist from './inspection-checklist';

const { code } = await transform(readFileSync(new URL('../app/(app)/trip/[id].js', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs' });
function render({ cargo = true, windowOpen = true, inspected = true, offline = false, saved = {} } = {}) {
  const trip = { trip_id: 7, trip_status: 'Driver Accepted', load_type: cargo ? 'Cargo' : 'Passenger', operational_use: cargo ? 'Cargo' : 'Passenger', cargo_description: 'Kitchen supplies', cargo_weight_kg: 500, guest_name: 'Hotel guest', passenger_count: 2, origin: 'Main warehouse', destination: 'Hotel receiving', plate_number: 'ABC 123', model: 'Toyota Hilux', cargo_capacity_kg: 900, booking_reference: 'CD-00123', scheduled_departure: '2026-10-14T09:00:00Z', earliest_start: windowOpen ? '2020-01-01T09:00:00Z' : '2099-01-01T09:00:00Z', pre_trip_status: inspected ? 'Passed' : null };
  Object.assign(trip, { vehicle_id: 2, passenger_name: 'Hotel guest', departure_time: '2026-10-14T09:00:00Z' }, saved);
  const values = [trip, false, false, Date.now(), false, null, null, {}];
  let index = 0;
  const elements = [];
  const api = { put: vi.fn().mockResolvedValue({}), get: vi.fn() };
  const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };
  const stubReact = { ...React, useState: initial => [index < values.length ? values[index++] : typeof initial === 'function' ? initial() : initial, vi.fn()], useEffect: () => {}, useCallback: fn => fn, useMemo: fn => fn(), useRef: current => ({ current }), createElement: (component, props, ...children) => { const node = { component, props: props || {}, children }; elements.push(node); return node; } };
  const deps = {
    react: stubReact, 'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'Spinner', StyleSheet: { create: x => x } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 16 }) }, 'expo-router': { useLocalSearchParams: () => ({ id: '7' }), useRouter: () => router }, '@expo/vector-icons': { Ionicons: 'Icon' },
    '../../../components/TripMapPreview': { default: 'MapPreview', __esModule: true }, '../../../components/RouteTimeline': { default: 'Timeline', __esModule: true }, '../../../lib/api': { api, wasQueued: x => x?.queued },
    '../../../components/cargo/CargoTripHandovers': { CargoTripHandovers: 'CargoTripHandovers' },
    '../../../lib/driver-profile': { useDriverProfile: () => ({ profile: { driverType: cargo ? 'Cargo' : 'Passenger' }, serverConfirmed: true, reload: vi.fn() }) }, '../../../lib/cargo-sync': { captureCargoSession: () => ({}), isCurrentCargoSession: () => true }, '../../../lib/auth': { useAuth: () => ({ user: { employeeId: 1 } }) },
    '../../../lib/trip-odometer': { odometerStartRoute: () => null },
    '../../../lib/offline-cache': { resolveDriverId: () => 1 }, '../../../lib/connectivity-context': { useConnectivity: () => ({ status: offline ? 'offline' : 'online' }) }, '../../../components/OfflineStates': { SyncNote: 'SyncNote', NeverSyncedCard: 'NeverSyncedCard' },
    '../../../lib/theme': { tripStatusTone: () => 'success', TOUCH_TARGET: 48 }, '../../../lib/theme-context': { useTheme: () => ({ colors: {}, type: {} }) }, '../../../components/AppAlert': { AppAlert: { alert: vi.fn() } }, '../../../lib/trip-detail': detail,
    '../../../lib/driver-workspace': { resolveDriverWorkspace }, '../../../lib/cargo-view-model': { workspaceModeLabel: () => cargo ? 'Cargo driver' : 'Passenger driver', workspaceBlockReason: () => '' }, '../../../lib/load-presentation': presentation, '../../../lib/use-pre-shift': { usePreShift: () => ({ loaded: true, passed: true }) }, '../../../lib/clay': { clayMaterials: () => ({}) }, '../../../components/clay': { ClayCard: 'Card', ClayBadge: 'Badge', ClayButton: 'Button' }, '../../../components/coachmarks': { useCoachMarkActions: () => ({ dismiss: vi.fn() }), useCoachMarkStatus: () => ({}), CoachMarkTarget: 'Target' },
  };
  const scope = { exports: {} };
  runInNewContext(code, { React: stubReact, module: scope, exports: scope.exports, require: name => { if (!deps[name]) throw Error(name); return deps[name]; } });
  scope.exports.default();
  return { elements, text: elements.filter(e => e.component === 'Text').flatMap(e => e.children).filter(x => typeof x === 'string').join(' '), api, router };
}

describe('Cargo assignment presentation in the shared details screen', () => {
  it.each(['Driver Accepted', 'Completed', 'Cancelled'])('includes saved signatures on Cargo details and history (%s)', trip_status => {
    const h = render({ saved: { trip_status } });
    expect(h.elements.find(e => e.component === 'CargoTripHandovers')?.props).toMatchObject({ tripId: '7', actorId: 1, online: true, confirmed: true, onRefreshTrip: expect.any(Function) });
    expect(h.api.get).not.toHaveBeenCalled();
  });
  it('does not show cargo signatures on a Passenger trip', () => {
    expect(render({ cargo: false }).elements.some(e => e.component === 'CargoTripHandovers')).toBe(false);
  });
  it('passes the offline restriction to saved signature review', () => {
    expect(render({ offline: true }).elements.find(e => e.component === 'CargoTripHandovers')?.props.online).toBe(false);
  });
  it.each([true, false])('uses the trip ending reading instead of later vehicle mileage in history (cargo=%s)', cargo => {
    const h = render({ cargo, saved: { trip_status: 'Completed', start_odometer: 25000, end_odometer: 25045, current_mileage: 99999, distance: 45, distance_source: 'odometer' } });
    expect(h.text).toContain('END ODOMETER'); expect(h.text).toContain('25045 km');
    expect(h.text).not.toContain('VEHICLE MILEAGE'); expect(h.text).not.toContain('99999 km');
    expect(h.text).toContain('45 km'); expect(h.text).toContain('From odometer readings');
  });
  it('does not invent missing historical endings or derive them from GPS or current mileage', () => {
    const h = render({ saved: { trip_status: 'Completed', start_odometer: 25000, current_mileage: 99999, distance: 12.5, distance_source: 'gps-trail' } });
    expect(h.text).toContain('END ODOMETER'); expect(h.text).toContain('Not recorded');
    expect(h.text).not.toContain('99999 km'); expect(h.text).toContain('12.5 km'); expect(h.text).toContain('GPS distance');
  });
  it.each([['trip-distance', 'Saved trip distance'], [null, 'Source not recorded']])('labels saved distance without claiming odometer evidence (%s)', (source, label) => {
    const h = render({ saved: { trip_status: 'Completed', distance: 45, distance_source: source } });
    expect(h.text).toContain(label); expect(h.text).not.toContain('From odometer readings');
  });
  it('leaves missing distance unknown and does not use GPS as an unlabelled replacement', () => {
    const h = render({ saved: { trip_status: 'Cancelled', distance: null, gps_distance_km: 12.5, current_mileage: 99999 } });
    expect(h.text).toContain('DISTANCE TRAVELLED'); expect(h.text).toContain('Not recorded'); expect(h.text).not.toContain('12.5 km'); expect(h.text).not.toContain('99999 km');
  });
  it('groups the real consignment and vehicle before map details without passenger icons', () => {
    const h = render();
    expect(h.text).toContain('Kitchen supplies');
    expect(h.text).toContain('500 kg declared');
    expect(h.text).toContain('CD-00123');
    expect(h.text).toContain('Toyota Hilux');
    expect(h.text).toContain('ABC 123');
    expect(h.text).not.toContain('Hotel guest');
    expect(h.elements.filter(e => e.component === 'Icon').some(e => ['person-outline', 'people-outline'].includes(e.props.name))).toBe(false);
    expect(h.elements.findIndex(e => e.component === 'Text' && e.children.includes('Kitchen supplies'))).toBeLessThan(h.elements.findIndex(e => e.component === 'MapPreview'));
  });
  it('retains Passenger facts and passenger icons', () => {
    const h = render({ cargo: false });
    expect(h.text).toContain('Hotel guest'); expect(h.text).toContain('2 passengers');
    expect(h.elements.some(e => e.component === 'Icon' && e.props.name === 'people-outline')).toBe(true);
  });
  it.each([{ windowOpen: false }, { offline: true }])('keeps start disabled without eligibility %o', options => {
    const h = render(options);
    const start = h.elements.find(e => e.props.accessibilityLabel === 'Start route' || e.props.accessibilityLabel === 'Start route not yet available');
    expect(start.props.disabled).toBe(true);
    expect(h.api.put).not.toHaveBeenCalled();
  });
  it('opens the existing Cargo pre-trip route without writing a trip status', () => {
    const h = render({ inspected: false });
    h.elements.find(e => e.props.accessibilityLabel === 'PRE-TRIP CHECK').props.onPress();
    expect(h.router.push).toHaveBeenCalledWith({ pathname: '/inspection', params: { tripId: '7' } });
    expect(h.api.put).not.toHaveBeenCalled();
  });
});

const checklistCode = (await transform(readFileSync(new URL('../components/inspection/InspectionChecklist.jsx', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs' })).code;
const inspectionCode = (await transform(readFileSync(new URL('../app/(app)/inspection.js', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs' })).code;
function renderInspection({ cargo = true, insecure = false, missingContext = false, safetyFail = false } = {}) {
  const answers = { brakes_tires: safetyFail ? 'FAIL' : 'PASS', cargo_secure: insecure ? 'FAIL' : 'PASS', passenger_items: 'PASS', cabin_ready: 'PASS' };
  const values = [missingContext ? null : { trip_id: 7, load_type: cargo ? 'Cargo' : 'Passenger', plate_number: 'ABC 123', model: 'Toyota Hilux' }, answers, { cargo_secure: 'Strap loose' }, false, 'submission-7', false];
  let index = 0;
  const elements = [];
  const stubReact = { ...React, useState: initial => [index < values.length ? values[index++] : typeof initial === 'function' ? initial() : initial, vi.fn()], useEffect: () => {}, useMemo: fn => fn(), useRef: current => ({ current }), createElement: (component, props, ...children) => { if (typeof component === 'function') return component({ ...props, children }); const node = { component, props: props || {}, children }; elements.push(node); return node; } };
  const deps = {
    "../../components/coachmarks/LegacyGuideLinkGuard": { guardLegacyGuideLinks: Screen => Screen },
    "../../components/coachmarks/DriverGuideTrigger": "GuideTrigger",
    react: stubReact, '../../lib/scaling': { moderateScale: x => x }, 'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', TextInput: 'Input', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'android' }, Vibration: { vibrate: vi.fn() }, StyleSheet: { create: x => x } },
    'expo-router': { useLocalSearchParams: () => ({ tripId: '7' }), useRouter: () => ({ back: vi.fn() }) }, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 16 }) }, '@expo/vector-icons': { Ionicons: 'Icon' },
    '../../lib/theme-context': { useTheme: () => ({ colors: { outlineVariant: '#aaa' }, type: {} }) }, '../../lib/theme': { fonts: {}, TOUCH_TARGET: 48 }, '../../lib/api': { api: {} }, '../../components/AppAlert': { AppAlert: { alert: vi.fn() } }, '../../components/clay': { ClayCard: 'Card', ClayButton: 'Button', ClayTile: 'Tile' }, '../../lib/clay': { raisedControl: () => ({}) }, '../../components/coachmarks': { useCoachMarkActions: () => ({}), useCoachMarkStatus: () => ({}), CoachMarkTarget: 'Target' }, '../../lib/inspection-tour': {}, '../../lib/inspection-checklist': checklist,
    '../../components/ReferencePhotoGuide': { ReferencePhotoGuide: 'ReferencePhotoGuide' }, '../../lib/inspection-reference-images': { inspectionReferenceFor: () => ({ source: null, caption: '' }) },
    '../../lib/auth': { useAuth: () => ({ user: { employeeId: 1 } }) }, '../../lib/cargo-sync': { captureCargoSession: () => ({}), isCurrentCargoSession: () => true },
  };
  deps['../ReferencePhotoGuide'] = deps['../../components/ReferencePhotoGuide'];
  deps['../clay'] = deps['../../components/clay'];
  deps['../coachmarks'] = deps['../../components/coachmarks'];
  const checklistScope = { exports: {} };
  runInNewContext(checklistCode, { React: stubReact, module: checklistScope, exports: checklistScope.exports, require: name => { if (!deps[name]) throw Error(name); return deps[name]; } });
  deps['../../components/inspection/InspectionChecklist'] = checklistScope.exports;
  const scope = { exports: {} };
  runInNewContext(inspectionCode, { React: stubReact, module: scope, exports: scope.exports, require: name => { if (!deps[name]) throw Error(name); return deps[name]; } });
  scope.exports.default();
  return { elements, text: elements.filter(e => e.component === 'Text').flatMap(e => e.children).filter(x => typeof x === 'string').join(' ') };
}

describe('Cargo pre-trip in the shared inspection form', () => {
  it('does not offer a Passenger checklist before the trip type is loaded', () => {
    const h = renderInspection({ missingContext: true });
    expect(h.text).not.toContain('Passenger Readiness');
    expect(h.text).not.toContain('next passenger');
    expect(h.elements.some(e => e.props.onPress && e.props.label === 'GOOD TO GO')).toBe(false);
  });
  it('renders the cargo checks and never tells Cargo drivers to prepare for a passenger', () => {
    const h = renderInspection();
    expect(h.text).toContain('Cargo Secured');
    expect(h.text).not.toMatch(/next passenger|Passenger Readiness/);
  });
  it('names the hard Cargo failure before submission instead of promising departure', () => {
    const h = renderInspection({ insecure: true });
    expect(h.text).toMatch(/departure.*blocked/i);
    expect(h.elements.find(e => e.component === 'Button').props.label).not.toBe('GOOD TO GO');
  });
  it('names a blocking Passenger safety report and selected checklist answers', () => {
    const h = renderInspection({ cargo: false, safetyFail: true });
    expect(h.elements.find(e => e.component === 'Button').props.label).toBe('SAVE BLOCKING ISSUE');
    expect(h.elements.some(e => e.component === 'Pressable' && e.props.accessibilityRole === 'radio' && e.props.accessibilityState?.checked === true)).toBe(true);
    expect(h.elements.some(e => e.component === 'Input' && e.props.accessibilityLabel?.includes('required'))).toBe(true);
  });
  it('keeps Passenger readiness and shared cabin acknowledgement', () => {
    const h = renderInspection({ cargo: false });
    expect(h.text).toContain('Passenger Readiness');
    expect(h.text).toContain('next passenger');
    expect(h.elements.some(e => e.props.accessibilityRole === 'checkbox')).toBe(true);
  });
});

const profileCode = (await transform(readFileSync(new URL('../app/(app)/(tabs)/profile.js', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs' })).code;
function renderProfile(driverType) {
  const elements = [];
  const router = { push: vi.fn() };
  const stubReact = { ...React, useState: initial => [initial, vi.fn()], useCallback: fn => fn, createElement: (component, props, ...children) => { const node = { component, props: props || {}, children }; elements.push(node); return node; } };
  const deps = {
    react: stubReact, '../../../lib/scaling': { moderateScale: x => x }, '../../../lib/api': { api: {} }, 'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable', Image: 'Image', ScrollView: 'ScrollView', Modal: 'Modal', Platform: { OS: 'android' }, StyleSheet: { create: x => x } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 16 }) }, 'expo-router': { useRouter: () => router }, '@expo/vector-icons': { Ionicons: 'Icon' }, 'expo-image-picker': {}, 'expo-image-manipulator': {},
    '../../../lib/auth': { useAuth: () => ({ user: { name: 'Driver', driverType: 'Cargo' } }) }, '../../../lib/driver-profile': { useDriverProfile: () => ({ profile: driverType ? { firstName: 'Karl', lastName: 'Dela Cruz', driverType } : null }) }, '../../../lib/theme-context': { useTheme: () => ({ colors: {}, type: {} }) }, '../../../lib/theme': { fonts: {} }, '../../../lib/clay': { clayMaterials: () => ({ clayTile: {} }) }, '../../../components/ClayMenuRow': { default: 'Menu', __esModule: true }, '../../../components/clay': { ClayCard: 'Card' }, '../../../components/AppAlert': {}, '../../../lib/notifications/notify': {},
  };
  const scope = { exports: {} };
  runInNewContext(profileCode, { React: stubReact, module: scope, exports: scope.exports, require: name => { if (!deps[name]) throw Error(name); return deps[name]; } });
  scope.exports.default();
  return { elements, router };
}
describe('saved Cargo classification in shared Profile', () => {
  it('shows saved specialization and routes to actual existing work screens', () => {
    const h = renderProfile('Cargo');
    expect(h.elements.some(e => e.component === 'Text' && e.children.includes('Cargo Driver'))).toBe(true);
    const work = h.elements.find(e => e.props.title === 'My Work');
    expect(work.props.rows.map(row => row.route)).toEqual(['/work-schedule', '/history', '/profile/license', '/profile/vehicle']);
  });
  it.each(['Passenger', null])('keeps the shared My Work section without inferring Cargo specialization for %s', driverType => {
    const h = renderProfile(driverType);
    expect(h.elements.some(e => e.component === 'Text' && e.children.includes('Cargo Driver'))).toBe(false);
    const work = h.elements.find(e => e.props.title === 'My Work');
    expect(work.props.rows.map(row => row.route)).toEqual(['/work-schedule', '/history', '/profile/license', '/profile/vehicle']);
  });
});
