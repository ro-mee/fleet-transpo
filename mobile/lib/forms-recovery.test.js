import { describe, expect, it, vi } from 'vitest';
import { nativeRender, nativeViews, nativeTheme } from './test-helpers/native-render';
import { fuelLevelError } from './fuel-request-validation';
const clay = { ClayCard: 'Card', ClayButton: 'Button', ClayBadge: 'Badge', ClayTile: 'Tile' };
const base = { 'react-native': { ...nativeViews, ActivityIndicator: 'Spinner', Image: 'Image' }, 'expo-router': { useRouter: () => ({ back() {}, replace() {} }) }, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) }, '@expo/vector-icons': { Ionicons: 'Icon' } };
const fonts = { fonts: {}, TOUCH_TARGET: 48 };
const themed = prefix => ({ [`${prefix}lib/theme-context`]: nativeTheme, [`${prefix}lib/theme`]: fonts, [`${prefix}components/clay`]: clay, [`${prefix}components/ClayScreenHeader`]: { default: 'Header' } });
const button = (h, label) => h.find(n => n.props.accessibilityLabel === label || n.props.label === label);
describe('honest form callbacks', () => {
  it.each(['', ' ', ',', ',,,', 'Infinity', '-1', '101', 'no'])('disables fuel submission for %j while preserving explicit zero', async value => {
    const h = await nativeRender(new URL('../components/fuel/FuelRequestForm.jsx', import.meta.url), { props: { fuelLevelPercent: value, gaugePhotoUrl: 'photo', hasAssignedVehicle: true }, deps: { ...base, '../../lib/theme-context': nativeTheme, '../../lib/theme': fonts, '../clay': clay, '../coachmarks': { CoachMarkTarget: 'Target' }, '../../lib/fuel-request-validation': { fuelLevelError } } });
    expect(button(h, 'Request fuel').props.disabled).toBe(true);
    h.render({ fuelLevelPercent: '0' });
    expect(button(h, 'Request fuel').props.disabled).toBe(false);
    h.render({ fuelLevelPercent: '100' });
    expect(button(h, 'Request fuel').props.disabled).toBe(false);
  });
  it('keeps the session and login after an unconfirmed revoke', async () => {
    const alert = vi.fn(), signOut = vi.fn();
    const fetch = vi.fn(async (path, options) => options ? { queued: true } : { sessions: [{ id: 1, kind: 'mobile', current: true }] });
    const h = await nativeRender(new URL('../app/(app)/devices.js', import.meta.url), { deps: { ...base, ...themed('../../'), '../../lib/auth': { useAuth: () => ({ signOut }) }, '../../lib/api': { apiFetch: fetch }, '../../components/AppAlert': { AppAlert: { alert } } } });
    await h.flushEffects(); await Promise.resolve(); await Promise.resolve(); h.render();
    const card = h.find(n => n.props.session?.id === 1); await card.props.onRevoke();
    await alert.mock.calls[0][2].find(a => a.text === 'Revoke').onPress(); h.render();
    expect(signOut).not.toHaveBeenCalled();
    expect(h.find(n => n.props.session?.id === 1)).toBeDefined();
    expect(fetch.mock.calls[1][1].queueOnFailure).toBe(false);
  });
  it('restores the saved phone on Cancel and retains failed drafts', async () => {
    const fetch = vi.fn(async () => ({ queued: true })), toast = vi.fn();
    const h = await nativeRender(new URL('../app/(app)/profile/personal.js', import.meta.url), { deps: { ...base, ...themed('../../../'), '../../../lib/scaling': { moderateScale: x => x }, '../../../lib/driver-profile': { useDriverProfile: () => ({ profile: { phone: '09171234567' }, reload: vi.fn() }) }, '../../../lib/api': { apiFetch: fetch }, '../../../components/AppAlert': { AppAlert: { alert: vi.fn() } }, '../../../lib/notifications/notify': { notify: { toast } } } });
    button(h, 'Edit phone number').props.onPress(); h.render();
    h.find(n => n.component === 'TextInput').props.onChangeText('09179876543'); h.render();
    button(h, 'Cancel phone number edit').props.onPress(); h.render();
    expect(h.text()).not.toContain('09179876543');
    button(h, 'Edit phone number').props.onPress(); h.render();
    h.find(n => n.component === 'TextInput').props.onChangeText('09179876543'); h.render();
    await button(h, 'Save phone number').props.onPress(); h.render();
    expect(h.find(n => n.component === 'TextInput')?.props.value).toBe('09179876543');
    expect(toast).not.toHaveBeenCalled();
    expect(fetch.mock.calls[0][1].queueOnFailure).toBe(false);
  });
});

const settle = async h => { for (let i = 0; i < 10; i++) await Promise.resolve(); h.render(); };
it('retains leave draft after queued reply and sends online only', async () => {
  const toast = vi.fn(), post = vi.fn(async () => ({ queued: true })); let focus;
  const h = await nativeRender(new URL('../app/(app)/work-schedule.js', import.meta.url), { deps: { ...base, ...themed('../../'), 'react-native': { ...base['react-native'], InteractionManager: { runAfterInteractions: fn => { fn(); return {}; } } }, 'expo-router': { ...base['expo-router'], useFocusEffect: fn => { focus = fn; } }, '../../lib/scaling': { moderateScale: x => x }, '../../lib/api': { api: { post, get: async () => [] } }, '../../lib/auth': { useAuth: () => ({ user: {} }) }, '../../lib/offline-cache': { resolveDriverId: () => null, CACHE_KEYS: {} }, '../../lib/connectivity-context': { useConnectivity: () => ({ status: 'online' }) }, '../../components/OfflineStates': { SyncNote: 'Note', NeverSyncedCard: 'Never' }, '../../components/clay': { ...clay, ClayInput: 'Input' }, '../../components/AppAlert': { AppAlert: { alert: vi.fn() } }, '../../lib/notifications/notify': { notify: { toast } } } });
  focus(); await settle(h);
  h.find(n => n.props.key === 'leave').props.onPress(); h.render();
  const inputs = h.nodes().filter(n => n.component === 'Input');
  inputs[0].props.onChangeText('2026-11-01'); inputs[1].props.onChangeText('2026-11-02'); inputs[2].props.onChangeText('Family appointment'); h.render();
  await button(h, 'Submit leave request').props.onPress(); h.render();
  expect(h.nodes().find(n => n.component === 'Input').props.value).toBe('2026-11-01'); expect(toast).not.toHaveBeenCalled();
  expect(post.mock.calls[0][2].queueOnFailure).toBe(false);
});
it('offers both scan replacements for a valid future license', async () => {
  const h = await nativeRender(new URL('../app/(app)/profile/license.js', import.meta.url), { deps: { ...base, ...themed('../../../'), 'expo-router': { ...base['expo-router'], useFocusEffect() {} }, 'expo-image-picker': { getPendingResultAsync: async () => null }, 'expo-image-manipulator': {}, '../../../lib/api': {}, '../../../lib/driver-profile': { useDriverProfile: () => ({ profile: { license: { expiry: '2035-01-01', frontScanImageUrl: 'front', backScanImageUrl: 'back' } } }) }, '../../../lib/auth': { useAuth: () => ({ user: {} }) }, '../../../lib/connectivity-context': { useConnectivity: () => ({ status: 'online' }) }, '../../../lib/offline-cache': { resolveDriverId: () => null }, '../../../lib/license-audit-queue': {}, '../../../components/AppAlert': { AppAlert: { alert: vi.fn() } }, '../../../lib/notifications/notify': { notify: { toast: vi.fn() } } } });
  expect(h.nodes().filter(n => n.props.side === 'front' || n.props.side === 'back').map(n => n.props.side)).toEqual(['front', 'back']);
  expect(button(h, 'Close license photo')).toBeDefined();
});
it('retains incident facts on failed refresh and never acknowledges a queued resolution', async () => {
  let scheduled; const alert = vi.fn();
  const get = vi.fn(async () => [{ incident_id: 4, status: 'Open', acknowledged_at: '2026-10-29T00:00:00Z', description: 'Existing report' }]);
  const post = vi.fn(async () => ({ queued: true }));
  const h = await nativeRender(new URL('../app/(app)/incident/[id].js', import.meta.url), { globals: { setTimeout: fn => { scheduled = fn; }, setInterval: () => 1, clearInterval() {} }, deps: { ...base, ...themed('../../../'), 'react-native': { ...base['react-native'], RefreshControl: 'RefreshControl', AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } }, 'expo-router': { ...base['expo-router'], useLocalSearchParams: () => ({ id: '4' }), useFocusEffect: fn => { fn(); } }, 'expo-location': { getForegroundPermissionsAsync: async () => ({ status: 'denied' }), requestForegroundPermissionsAsync: async () => ({ status: 'denied' }) }, '../../../lib/api': { api: { get, post } }, '../../../lib/auth': { useAuth: () => ({ user: { employeeId: 9 } }) }, '../../../lib/connectivity-context': { useConnectivity: () => ({ status: 'online' }) }, '../../../lib/responder-action': { runResponderAction: vi.fn() }, '../../../components/AppAlert': { AppAlert: { alert } } } });
  await h.flushEffects(); scheduled(); await settle(h);
  const refresh = h.find(n => n.component === 'ScrollView').props.refreshControl;
  get.mockRejectedValueOnce(new Error('Network down')); refresh.props.onRefresh(); await settle(h);
  expect(h.text()).toContain('Showing last known status.'); expect(h.text()).toContain('Existing report');
  const resolve = h.nodes().find(n => n.props.onPress && n.props.label?.includes('resolved'));
  expect(resolve).toBeDefined(); resolve.props.onPress();
  await alert.mock.calls.at(-1)[2].find(a => a.text === 'Resolved').onPress();
  expect(post.mock.calls.at(-1)[2].queueOnFailure).toBe(false); expect(alert.mock.calls.at(-1)[0]).toBe('Could not resolve');
});

it('opens Settings for blocked onboarding access and refreshes on return', async () => {
  let listener; let states = [{ key: 'camera', status: 'denied', canAskAgain: false }];
  const request = vi.fn(), open = vi.fn();
  const h = await nativeRender(new URL('../app/permissions.js', import.meta.url), { deps: { ...base, 'react-native': { ...base['react-native'], useWindowDimensions: () => ({ height: 800 }), AppState: { addEventListener: (_event, fn) => { listener = fn; return { remove() {} }; } } }, 'expo-linear-gradient': { LinearGradient: 'Gradient' }, '../lib/theme': fonts, '../components/ui': { ErrorNotice: 'Error' }, '../lib/permissions': { describePermissionState: state => ({ label: state?.status || 'unknown' }), getPermissionStatuses: async () => states, listAppPermissions: () => [{ key: 'camera', title: 'Camera', why: 'Incident photos' }, { key: 'notifications', title: 'Notifications', why: 'Dispatch assignments' }], requestAppPermission: request, openSystemSettings: open, PERMISSION_STATUS: { DENIED: 'denied', GRANTED: 'granted' } }, '../lib/notifications/device-token': {}, '../components/onboarding': { OnboardingBackground: 'Background', OnboardingButton: 'Button', OnboardingCard: 'Card', OnboardingHeader: 'Header', onboardingTheme: { colors: {} } }, '../assets/images/onboarding/permissions-hero.png': 'asset' } });
  await h.flushEffects(); await settle(h);
  await h.find(n => n.props.title === 'Camera').props.onPress(); expect(open).toHaveBeenCalledOnce(); expect(request).not.toHaveBeenCalled();
  states = [{ key: 'camera', status: 'granted' }]; listener('active'); await settle(h);
  expect(h.find(n => n.props.title === 'Camera').props.status.label).toBe('granted');
  expect(h.find(n => n.props.title === 'Notifications')).toBeDefined();
});
it('shows factual unconfigured support without callable placeholders', async () => {
  const h = await nativeRender(new URL('../app/(app)/profile/help.js', import.meta.url), { deps: { ...base, ...themed('../../../'), '../../../components/AppAlert': { AppAlert: { alert: vi.fn() } }, '../../../components/coachmarks/DriverGuideLibrary': 'Library', '../../../lib/driver-guidance-config': { DRIVER_GUIDES_V2: false }, '../../../components/coachmarks': { useCoachMarkActions: () => ({ resetTips: vi.fn() }) } } });
  expect(h.text()).toContain('Support contact information is not configured'); expect(h.text()).not.toContain('1-800-123-4567'); expect(h.text()).not.toContain('support@fleetops.com'); expect(h.text()).not.toContain('Read a section again above');
});

it.each(['', ' ', ',', ',,,', 'Infinity', '0', '100', '-1', '101', 'no'])('real fuel submit preserves blank versus explicit level %j', async level => {
  const timers = []; const post = vi.fn(async () => ({ status: 'Pending', fuel_request_id: 1 }));
  const h = await nativeRender(new URL('../app/(app)/fuel-report.js', import.meta.url), { globals: { setTimeout: fn => { timers.push(fn); return 1; }, setInterval: () => 1 }, deps: { ...base, ...themed('../../'), 'react-native': { ...base['react-native'], InteractionManager: { runAfterInteractions: fn => { fn(); return {}; } } }, 'expo-router': { ...base['expo-router'], useLocalSearchParams: () => ({}) }, '../../lib/fuel-request-validation': { fuelLevelError }, '../../components/coachmarks/DriverGuideTrigger': 'Guide', '../../components/coachmarks/LegacyGuideLinkGuard': { guardLegacyGuideLinks: x => x }, '../../components/fuel/FuelRequestForm': 'FuelForm', '../../components/fuel/FuelReceiptReview': 'Receipt', '../../lib/scaling': { moderateScale: x => x }, '../../lib/auth': { useAuth: () => ({ user: {} }) }, '../../lib/theme': { ...fonts, statusColorForTone: () => ({}) }, '../../lib/api': { api: { post, get: async path => path.includes('trips') ? [{ trip_id: 8, vehicle_id: 9 }] : {} } }, '../../lib/offline-cache': { resolveDriverId: () => null }, '../../lib/connectivity-state': { shouldAutoRetry: () => false }, '../../lib/connectivity-context': { useConnectivity: () => ({ status: 'online' }) }, '../../lib/driver-context': {}, 'expo-image-picker': { getPendingResultAsync: async () => null }, 'expo-camera': { useCameraPermissions: () => [{ granted: true }, vi.fn()] }, 'expo-image-manipulator': {}, '../../components/AppAlert': { AppAlert: { alert: vi.fn() } }, '../../components/logo': { Logo: 'Logo' }, '../../lib/receipt-crop': { RECEIPT_FRAME: {} }, '../../components/coachmarks/simulation/FuelGaugeTutorialModal': {}, '../../components/coachmarks/simulation/ReceiptScanTutorialModal': {}, '../../components/coachmarks': { CoachMarkTarget: 'Target', useCoachMarkActions: () => ({}), useCoachMarkStatus: () => ({ activeMilestone: null }) } } });
  await h.flushEffects(); await settle(h); await h.flushEffects(); for (const fn of timers) fn(); await settle(h);
  let form = h.find(n => n.component === 'FuelForm'); expect(form).toBeDefined();
  form.props.setGaugePhotoUrl('photo'); form.props.setFuelLevelPercent(level); h.render();
  form = h.find(n => n.component === 'FuelForm'); await form.props.requestFuel();
  if (level === '0' || level === '100') expect(post.mock.calls[0][1].current_fuel_level_percent).toBe(Number(level));
  else expect(post).not.toHaveBeenCalled();
});
