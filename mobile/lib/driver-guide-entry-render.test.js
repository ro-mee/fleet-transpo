import { expect, it, vi } from 'vitest';
import { nativeRender, nativeViews, nativeTheme } from './test-helpers/native-render';
import * as workspaceModel from './driver-workspace';
import * as guides from './driver-guides';
import * as practice from './driver-practice';

it('rejects old tour links before creating an operational screen', async () => {
  const router = { replace: vi.fn() }, operational = vi.fn();
  let params = { tour: '1' };
  const h = await nativeRender(new URL('../components/coachmarks/LegacyGuideLinkGuard.jsx', import.meta.url), {
    name: 'isLegacyGuideLink', props: params, deps: {
      'react-native': nativeViews, 'expo-router': { useRouter: () => router, useLocalSearchParams: () => params }, '../../lib/driver-guidance-config': { DRIVER_GUIDES_V2: true }, '../../lib/theme-context': nativeTheme, '../clay': { ClayButton: 'Button' },
    },
  });
  const Screen = h.exports.guardLegacyGuideLinks(operational);
  expect(typeof Screen).toBe('function');
  const blocked = Screen({});
  expect(JSON.stringify(blocked)).toContain('Open practice from Help');
  expect(operational).not.toHaveBeenCalled();
  params = {}; const allowed = Screen({});
  expect(allowed.component).toBe(operational);
});

it('opens one Help section, requires explicit parked confirmation and handles refusal', async () => {
  let confirmation;
  const startPractice = vi.fn(async () => ({ allowed: false, reason: 'refresh_required' })), push = vi.fn(), replayGuide = vi.fn(async () => true);
  const h = await nativeRender(new URL('../components/coachmarks/DriverGuideLibrary.jsx', import.meta.url), { deps: {
    'react-native': nativeViews, 'expo-router': { useRouter: () => ({ push }) }, '../../lib/theme-context': nativeTheme,
    '../../lib/driver-guides': guides, '../../lib/driver-practice': practice, '../clay': { ClayButton: 'Button' },
    '../AppAlert': { AppAlert: { alert: (...args) => { confirmation = args; } } },
    './CoachMarkProvider': { useCoachMarkStatus: () => ({ workspace: 'cargo' }), useCoachMarkActions: () => ({ startPractice, replayGuide }) },
  } });
  const title = h.nodes().find(n => n.component === 'Pressable' && JSON.stringify(n).includes(guides.getDriverGuide('cargo.manifest', 'cargo').title));
  expect(title).toBeDefined(); title.props.onPress(); h.render();
  h.find(n => n.props.label === 'Read this section').props.onPress();
  expect(replayGuide).toHaveBeenCalledWith({ guideId: 'cargo.manifest', variant: 'cargo' });
  h.find(n => n.props.label === 'Try with sample data').props.onPress();
  expect(startPractice).not.toHaveBeenCalled();
  await confirmation[2][1].onPress(); h.render();
  expect(startPractice).toHaveBeenCalledWith({ topic: 'cargo.manifest', variant: 'cargo', parkedConfirmed: true });
  expect(push).not.toHaveBeenCalled(); expect(h.text()).toContain('Reconnect and refresh');
});

it('requires matching production trip context before automatic tips and keeps replay separate', async () => {
  const requestGuide = vi.fn(async () => true), replayGuide = vi.fn(), updateGuideContext = vi.fn();
  const h = await nativeRender(new URL('../components/coachmarks/DriverGuideTrigger.jsx', import.meta.url), { props: { guideId: 'cargo.manifest', requireTrip: true, trip: { load_type: 'Passenger', operational_use: 'Passenger', vehicle_id: '1' } }, deps: {
    'react-native': nativeViews, 'expo-router': { usePathname: () => '/trip/1/cargo-pickup' }, '@react-navigation/native': { useIsFocused: () => true }, '../../lib/driver-workspace': workspaceModel, '../clay': { ClayButton: 'Button' }, './CoachMarkProvider': { useCoachMarkStatus: () => ({ guideVersion2: true, workspace: 'cargo', activeMilestone: null }), useCoachMarkActions: () => ({ requestGuide, replayGuide, updateGuideContext }) },
  } });
  await h.flushEffects(); expect(requestGuide).not.toHaveBeenCalled();
  expect(updateGuideContext).toHaveBeenLastCalledWith({ contextRoute: '/trip/1/cargo-pickup', contextValid: false });
  h.find(n => n.component === 'Button').props.onPress(); expect(replayGuide).toHaveBeenCalledOnce();
  h.render({ trip: { load_type: 'Cargo', operational_use: 'Cargo', vehicle_id: '1' } }); await h.flushEffects();
  expect(requestGuide).toHaveBeenCalledWith({ guideId: 'cargo.manifest', variant: 'cargo' }); h.unmount();
});


it('interrupts practice when the existing inbox receives new work without starting a new poller', async () => {
  let notifications = [{ notification_id: 1 }];
  const interruptGuidance = vi.fn(), updateGuideContext = vi.fn();
  const h = await nativeRender(new URL('../components/coachmarks/DriverGuideWorkWatch.jsx', import.meta.url), { deps: {
    '../../context/notification-feed': { useNotificationFeed: () => ({ notifications, loading: false }) },
    './CoachMarkProvider': { useCoachMarkStatus: () => ({ guideVersion2: true }), useCoachMarkActions: () => ({ interruptGuidance, updateGuideContext }) },
  } });
  await h.flushEffects(); expect(interruptGuidance).not.toHaveBeenCalled();
  notifications = [...notifications, { notification_id: 2 }]; h.render(); await h.flushEffects();
  expect(interruptGuidance).toHaveBeenCalledOnce(); expect(updateGuideContext).toHaveBeenCalledWith({ work: null });
  h.render(); await h.flushEffects(); expect(interruptGuidance).toHaveBeenCalledOnce();
});
