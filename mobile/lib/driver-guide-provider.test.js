import { describe, expect, it, vi } from 'vitest';
import { nativeRender, nativeViews } from './test-helpers/native-render';
import * as controllers from './driver-guide-controller';
import * as progress from './driver-guide-progress';
import * as guides from './driver-guides';

describe('new native guide provider', () => {
  it('publishes independent compatibility actions without enabling legacy tour shortcuts', async () => {
    const session = { generation: 1 }, contexts = { Actions: { Provider: 'Actions' }, Status: { Provider: 'Status' }, State: { Provider: 'State' } };
    const h = await nativeRender(new URL('../components/coachmarks/DriverGuideProvider.jsx', import.meta.url), { props: { driverId: '17', contexts, children: 'app' }, deps: {
      'react-native': { ...nativeViews, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
      'expo-router': { usePathname: () => '/', useRouter: () => ({ push: vi.fn() }) },
      '@react-native-async-storage/async-storage': { default: { getItem: vi.fn(async () => null) }, __esModule: true },
      '../../lib/api': { apiFetch: vi.fn() },
      '../../lib/driver-practice-readiness': { loadPracticeReadiness: vi.fn(async () => ({ available: true, checkedAt: Date.now(), hasAssignment: false, hasPendingSubmission: false, emergency: false, responderWork: false })) },
      '../../lib/auth': { useAuth: () => ({ user: { employeeId: '4' } }) },
      '../../lib/driver-profile': { useDriverProfile: () => ({ profile: { driverType: 'Cargo' }, serverConfirmed: true }) },
      '../../lib/tracking': { usePosterStatus: () => ({ motionSpeedMs: 0, motionFixAt: new Date().toISOString() }), useIsDriving: () => false },
      '../../lib/cargo-sync': { captureCargoSession: () => session, isCurrentCargoSession: () => true },
      '../../lib/driver-guide-controller': controllers, '../../lib/driver-guide-progress': progress, '../../lib/driver-guides': guides,
      '../../lib/use-driver-practice': { useDriverPractice: () => ({ practiceSession: null, endPractice: vi.fn(), startPractice: vi.fn(), dispatchPractice: vi.fn() }) },
      '../../lib/coach-mark-storage': { readGuideProgress: vi.fn(async () => ({ available: true, record: null })), writeGuideProgress: vi.fn(async () => true), isCoachMarkCompleted: vi.fn(async () => false), resetDriverGuideProgress: vi.fn(async () => true), resetAllCoachMarks: vi.fn(async () => true) },
      './CoachMarkOverlay': { default: 'Overlay', __esModule: true },
    } });
    await h.flushEffects(); h.render();
    const actions = h.find(n => n.component === 'Actions').props.value;
    expect(actions.isTourShortcutActive('Fuel')).toBe(false);
    expect(await actions.triggerMilestone('tour_fuel_flow')).toBe(false);
    expect(await actions.triggerMilestone('welcome')).toBe(true);
    h.render(); expect(h.find(n => n.component === 'Status').props.value.walkthroughActive).toBe(false);
    await actions.nextStep(); h.render();
    expect(h.find(n => n.component === 'Status').props.value.activeMilestone).toBeNull();
    h.unmount();
  });
});
