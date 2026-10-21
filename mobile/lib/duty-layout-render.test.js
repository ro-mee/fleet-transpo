import React from 'react';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import * as queue from './trips-queue';
import * as schedule from './trips-schedule';
import * as loadPresentation from './load-presentation';
import { resolveDriverWorkspace } from './driver-workspace';
import * as cargoViewModel from './cargo-view-model';
import { offlineViewState } from './offline-ux';

async function loadComponent(path, dependencies, values = []) {
  const { code } = await transform(readFileSync(path, 'utf8'), { loader: 'jsx', format: 'cjs' });
  let index = 0;
  const react = {
    ...React, memo: component => component,
    useState: initial => [index < values.length ? values[index++] : typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {}, useCallback: fn => fn, useMemo: fn => fn(),
    createElement: (component, props, ...children) => ({ component, props: props || {}, children }),
  };
  const scope = { exports: {} };
  runInNewContext(code, { module: scope, exports: scope.exports, React: react, require: name => {
    if (name === 'react') return react;
    if (/\.(png|webp)$/.test(name)) return name;
    if (!dependencies[name]) throw Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  } });
  return scope.exports.default;
}

const native = { View: 'View', Text: 'Text', Image: 'Image', Pressable: 'Pressable', ScrollView: 'ScrollView', SectionList: 'SectionList', ActivityIndicator: 'Spinner', RefreshControl: 'Refresh', useWindowDimensions: () => ({ width: 390, fontScale: 1 }), StyleSheet: { create: x => x } };
const theme = { useTheme: () => ({ colors: new Proxy({}, { get: () => '#285448' }), type: {}, scheme: 'light' }) };
function children(tree) {
  const slots = tree?.component === 'SectionList' ? [tree.props.ListHeaderComponent, tree.props.ListFooterComponent,
    tree.props.sections.every(section => section.data.length === 0) ? tree.props.ListEmptyComponent : null] : [];
  return [...(tree?.children || []), ...slots].flat(Infinity);
}
function nodes(tree) { return !tree || typeof tree !== 'object' ? [] : [tree, ...children(tree).flatMap(nodes)]; }
function text(tree) { return typeof tree === 'string' || typeof tree === 'number' ? String(tree) : children(tree).map(text).join(tree?.component === 'Text' ? '' : ' '); }
function tripRows(tree) {
  const list = nodes(tree).find(node => node.component === 'SectionList');
  return list ? list.props.sections.flatMap(section => section.data.map((item, index) => list.props.renderItem({ item, index, section })))
    : nodes(tree).filter(node => node.props.trip);
}

async function renderTrips({ trips = [], loading = false, error = null, offline = false, syncedAt = 1, tab = 'today', now = Date.UTC(2026, 9, 21, 2), hasMore = false, refreshing = false, loadingMore = false, refresh = () => {}, loadMore = () => {}, onNavigate = () => {}, fontScale = 1 } = {}) {
  const empty = {};
  const prefix = '../../../';
  const dependencies = {
    'react-native': { ...native, useWindowDimensions: () => ({ width: 390, fontScale }) }, 'expo-router': { useRouter: () => ({ push: onNavigate }), useFocusEffect: () => {} },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 24, bottom: 16 }) },
    '@expo/vector-icons': { Ionicons: 'Icon', MaterialCommunityIcons: 'Icon' },
    [prefix+'lib/theme-context']: theme,
    [prefix+'lib/api']: { api: {}, isTransportFailure: () => false },
    [prefix+'lib/auth']: { useAuth: () => ({ user: {} }) },
    [prefix+'lib/use-duty']: { useDuty: () => ({ loaded: true, checkedIn: false, today: { blocked: false } }) },
    [prefix+'lib/driver-profile']: { useDriverProfile: () => ({ profile: { driverType: 'Cargo' } }) },
    [prefix+'lib/use-screen-clock']: { useScreenClock: () => ({ now, active: true }) },
    [prefix+'lib/trips-schedule']: schedule,
    [prefix+'lib/use-trip-schedule']: { useTripSchedule: () => ({ trips, loading, error, lastSynced: syncedAt, confirmed: syncedAt != null, refreshing, loadingMore, hasMore, refresh, loadMore }) },
    [prefix+'lib/offline-cache']: { resolveDriverId: () => 7, CACHE_KEYS: {} },
    [prefix+'lib/offline-ux']: { offlineViewState },
    [prefix+'lib/connectivity-context']: { useConnectivity: () => ({ status: offline ? 'offline' : 'online' }) },
    [prefix+'lib/connectivity-state']: empty, [prefix+'lib/trips-queue']: queue,
    [prefix+'lib/load-presentation']: loadPresentation, [prefix+'lib/driver-workspace']: { resolveDriverWorkspace }, [prefix+'lib/cargo-view-model']: cargoViewModel,
    [prefix+'components/RouteTimeline']: { default: 'Timeline', __esModule: true },
    [prefix+'components/RadarPulse']: { default: 'Radar', __esModule: true },
    [prefix+'components/OffDutyIllustration']: { default: 'Illustration', __esModule: true },
    [prefix+'components/OfflineStates']: { SyncNote: 'SyncNote', NeverSyncedCard: 'NeverSynced', SavedChip: 'SavedChip' },
    [prefix+'components/clay']: { ClayCard: 'Card', ClayBadge: 'Badge', ClayButton: 'Button' },
  };
  const Component = await loadComponent('mobile/app/(app)/(tabs)/trips.js', dependencies, [tab, now]);
  const scopedList = Component();
  return scopedList.component(scopedList.props);
}

describe('Trips date tabs preserve data-state precedence', () => {
  it('shows the Today empty card without a duty notice or zero-assignment panel', async () => {
    const tree = await renderTrips();
    expect(text(tree)).toContain('No trips scheduled today');
    expect(text(tree)).not.toContain('from your loaded trips');
    expect(nodes(tree).filter(node => node.component === 'Badge' && node.props.label === 'OFF DUTY')).toHaveLength(0);
  });
  it.each([{ loading: true }, { error: 'Request refused' }, { offline: true, syncedAt: null }])('keeps loading, errors and never-synced guidance ahead of empty claims: %j', async state => {
    const tree = await renderTrips(state);
    expect(nodes(tree).some(node => node.component === 'Illustration')).toBe(false);
    expect(nodes(tree).some(node => node.component === 'Badge' && node.props.label === 'OFF DUTY')).toBe(false);
    expect(text(tree)).not.toContain('No trips scheduled today');
    if (state.loading) expect(nodes(tree).some(node => node.component === 'Spinner')).toBe(true);
    if (state.error) expect(text(tree)).toContain(state.error);
    if (state.offline) expect(nodes(tree).some(node => node.component === 'NeverSynced')).toBe(true);
  });
  it('preserves the scoped count panel when loaded history exists', async () => {
    const tree = await renderTrips({ tab: 'history', trips: [{ trip_id: 1, trip_status: 'Completed', end_time: '2026-10-16T09:00:00Z' }] });
    expect(text(tree)).toContain('Trip history');
    expect(tripRows(tree).some(node => node.props.trip?.trip_id === 1)).toBe(true);
    expect(nodes(tree).some(node => node.component === 'Illustration')).toBe(false);
  });
});

describe('Trips list rendering work and controls', () => {
  it('hands 90 historical rows to the native render window instead of eagerly building every card', async () => {
    const trips = Array.from({ length: 90 }, (_, i) => ({ trip_id: i + 1, trip_status: 'Completed', load_type: 'Cargo', end_time: '2026-10-16T09:00:00Z', origin: 'Warehouse', destination: 'Hotel' }));
    const onNavigate = vi.fn();
    const tree = await renderTrips({ trips, tab: 'history', onNavigate });
    const eagerRows = nodes(tree).filter(node => node.props.trip);
    expect(eagerRows.length).toBe(0);
    const list = nodes(tree).find(node => node.component === 'SectionList');
    expect(list.props.sections).toHaveLength(1);
    expect(list.props.sections[0]).toMatchObject({ key: 'history', label: 'Recent trips' });
    expect(list.props.sections[0].data).toHaveLength(90);
    expect(text(tree)).toContain('90 trips');
    expect(list.props.keyExtractor(trips[0])).toBe('1');
    const rows = tripRows(tree);
    expect(rows.map(row => row.props.trip.trip_id)).toEqual(Array.from({ length: 90 }, (_, i) => 90 - i));
    expect(rows[0].props.display).toBe('COMPLETED');
    expect(rows[0].props.driverType).toBe('Cargo');
    const card = rows[0].component(rows[0].props);
    expect(card.props.accessibilityLabel).toContain('Pickup Warehouse, destination Hotel');
    card.props.onPress();
    expect(onNavigate).toHaveBeenCalledWith('/trip/90');
    expect(list.props.initialNumToRender).toBeLessThan(90);
    expect(list.props.maxToRenderPerBatch).toBeLessThan(90);
    expect(list.props.removeClippedSubviews).toBe(false);
    expect(list.props.stickySectionHeadersEnabled).toBe(false);
    expect(list.props.getItemLayout).toBeUndefined();
  });

  it('keeps upcoming date sections, scoped counts and supplied row status in the render window', async () => {
    const tree = await renderTrips({ tab: 'upcoming', trips: [
      { trip_id: 31, trip_status: 'Assigned', departure_time: '2026-10-23T02:30:00Z' },
      { trip_id: 30, trip_status: 'Assigned', departure_time: '2026-10-22T02:30:00Z' },
    ] });
    const list = nodes(tree).find(node => node.component === 'SectionList');
    expect(list).toBeDefined();
    expect(list.props.sections.map(section => section.key)).toEqual(['2026-10-22', '2026-10-23']);
    expect(text(list.props.renderSectionHeader({ section: list.props.sections[0] }))).toBe('Tomorrow');
    expect(tripRows(tree).map(row => [row.props.trip.trip_id, row.props.display])).toEqual([[30, 'UPCOMING'], [31, 'UPCOMING']]);
    expect(text(tree)).toContain('2 trips');
  });

  it('keeps refresh, saved-data messages, recoverable errors and manual pagination reachable', async () => {
    const refresh = vi.fn(), loadMore = vi.fn();
    const trips = [{ trip_id: 1, trip_status: 'Completed', end_time: '2026-10-16T09:00:00Z' }];
    const tree = await renderTrips({ trips, tab: 'history', error: 'Request refused', hasMore: true, loadingMore: true, refreshing: true, refresh, loadMore });
    const list = nodes(tree).find(node => node.component === 'SectionList');
    expect(list).toBeDefined();
    expect(list.props.refreshControl.props.refreshing).toBe(true);
    list.props.refreshControl.props.onRefresh();
    expect(refresh).toHaveBeenCalledOnce();
    expect(text(tree)).toContain('Couldn’t update trips');
    expect(text(tree)).toContain('Request refused');
    const footer = nodes(list.props.ListFooterComponent).find(node => node.props.label === 'Load older trips');
    expect(footer.props.loading).toBe(true);
    expect(footer.props.disabled).toBe(true);
    footer.props.onPress();
    expect(loadMore).toHaveBeenCalledOnce();
    const savedTree = await renderTrips({ trips, tab: 'history', offline: true, hasMore: true });
    expect(text(savedTree)).toContain('Reconnect to load more trips.');
    expect(nodes(savedTree).find(node => node.component === 'SyncNote').props.label).toBe('trips');
    expect(nodes(savedTree).find(node => node.props.label === 'Load older trips').props.disabled).toBe(true);
  });
});

describe('inline Home weather', () => {
  it('shows temperature without the visible city while keeping the full accessible weather description', async () => {
    const Component = await loadComponent('mobile/components/WeatherChip.js', {
      'react-native': native, '../lib/theme-context': theme,
      '../lib/theme': { fonts: {} }, './clay/molded-materials': { moldedMaterials: () => ({}) },
    });
    const tree = Component({ value: { icon: 'rain', temperature: '26°', label: 'Caloocan City' }, compact: true });
    expect(text(tree)).toContain('26°');
    expect(text(tree)).not.toContain('Caloocan City');
    expect(tree.props.accessibilityLabel).toContain('Caloocan City');
  });
});
