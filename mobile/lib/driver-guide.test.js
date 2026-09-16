import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    default: {
      getItem: vi.fn(async (key) => (store.has(key) ? store.get(key) : null)),
      setItem: vi.fn(async (key, value) => {
        store.set(key, String(value));
      }),
      removeItem: vi.fn(async (key) => {
        store.delete(key);
      }),
      clear: vi.fn(async () => {
        store.clear();
      }),
    },
  };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  MISSIONS,
  calculateProgress,
  getGuideProgress,
  markMissionComplete,
  resetGuideProgress,
  GUIDE_STORAGE_KEY,
} from './driver-guide';

describe('driver-guide module', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    vi.clearAllMocks();
  });

  it('defines 6 structured driver missions with complete metadata', () => {
    expect(MISSIONS).toHaveLength(6);
    MISSIONS.forEach((m) => {
      expect(m.id).toBeDefined();
      expect(typeof m.title).toBe('string');
      expect(typeof m.description).toBe('string');
      expect(m.durationMinutes).toBeGreaterThan(0);
      expect(Array.isArray(m.steps)).toBe(true);
      expect(m.steps.length).toBeGreaterThan(0);
      m.steps.forEach((step) => {
        expect(typeof step.title).toBe('string');
        expect(typeof step.instruction).toBe('string');
      });
    });
  });

  it('calculates progress correctly for 0, partial, and 100% completion', () => {
    const p0 = calculateProgress([]);
    expect(p0.completedCount).toBe(0);
    expect(p0.totalCount).toBe(6);
    expect(p0.percent).toBe(0);
    expect(p0.isComplete).toBe(false);

    const p3 = calculateProgress(['inspection', 'swipe', 'trip_flow']);
    expect(p3.completedCount).toBe(3);
    expect(p3.totalCount).toBe(6);
    expect(p3.percent).toBe(50);
    expect(p3.isComplete).toBe(false);

    const allIds = MISSIONS.map((m) => m.id);
    const pAll = calculateProgress(allIds);
    expect(pAll.completedCount).toBe(6);
    expect(pAll.percent).toBe(100);
    expect(pAll.isComplete).toBe(true);
  });

  it('ignores invalid or unknown mission IDs during progress calculation', () => {
    const res = calculateProgress(['non_existent_mission_xyz']);
    expect(res.completedCount).toBe(0);
    expect(res.percent).toBe(0);
    expect(res.isComplete).toBe(false);
  });

  it('saves and marks missions as complete without duplicates', async () => {
    const initial = await getGuideProgress();
    expect(initial.completedMissions).toEqual([]);

    const after1 = await markMissionComplete('inspection');
    expect(after1.completedMissions).toContain('inspection');
    expect(after1.lastCompletedAt).toBeTruthy();

    // Re-marking should not duplicate
    const after2 = await markMissionComplete('inspection');
    expect(after2.completedMissions).toHaveLength(1);

    const after3 = await markMissionComplete('swipe');
    expect(after3.completedMissions).toContain('inspection');
    expect(after3.completedMissions).toContain('swipe');
    expect(after3.completedMissions).toHaveLength(2);

    const fetched = await getGuideProgress();
    expect(fetched.completedMissions).toEqual(['inspection', 'swipe']);
  });

  it('resets progress cleanly', async () => {
    await markMissionComplete('fuel');
    const before = await getGuideProgress();
    expect(before.completedMissions).toContain('fuel');

    await resetGuideProgress();
    const after = await getGuideProgress();
    expect(after.completedMissions).toEqual([]);
  });

  it('handles corrupted JSON storage gracefully', async () => {
    await AsyncStorage.setItem(GUIDE_STORAGE_KEY, '{ invalid_json_syntax');
    const res = await getGuideProgress();
    expect(res.completedMissions).toEqual([]);
    expect(res.lastCompletedAt).toBeNull();
  });

  it('isolates training progress strictly per driverId', async () => {
    // Driver Alpha completes inspection and swipe
    await markMissionComplete('inspection', 'driver-alpha');
    await markMissionComplete('swipe', 'driver-alpha');

    // Driver Beta is a fresh new driver account
    const alphaProgress = await getGuideProgress('driver-alpha');
    const betaProgress = await getGuideProgress('driver-beta');

    expect(alphaProgress.completedMissions).toEqual(['inspection', 'swipe']);
    expect(betaProgress.completedMissions).toEqual([]);

    const alphaCalc = calculateProgress(alphaProgress.completedMissions);
    const betaCalc = calculateProgress(betaProgress.completedMissions);

    expect(alphaCalc.completedCount).toBe(2);
    expect(alphaCalc.isComplete).toBe(false);

    expect(betaCalc.completedCount).toBe(0);
    expect(betaCalc.percent).toBe(0);
    expect(betaCalc.isComplete).toBe(false);

    // Resetting driver-alpha should not affect driver-beta
    await resetGuideProgress('driver-alpha');
    const afterAlphaReset = await getGuideProgress('driver-alpha');
    expect(afterAlphaReset.completedMissions).toEqual([]);
  });
});
