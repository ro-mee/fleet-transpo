import { AppState, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { invalidateTripBubbleWork } from './trip-bubble-handoff';

function nativeBubble() {
  if (Platform.OS !== 'android') return null;
  try { return requireOptionalNativeModule('FleetOpsTripBubble'); } catch { return null; }
}

export async function tripBubbleAvailability() {
  const native = nativeBubble();
  if (!native) return { available: false, reason: 'unsupported' };
  try {
    return await native.canDrawOverlays() === true
      ? { available: true } : { available: false, reason: 'permission-denied' };
  } catch { return { available: false, reason: 'start-failed' }; }
}

export async function requestTripBubblePermission() {
  const native = nativeBubble();
  if (!native) return { granted: false };
  try {
    if (await native.canDrawOverlays() === true) return { granted: true };
    return await new Promise(resolve => {
      let left = false, settled = false;
      const finish = async () => {
        if (settled) return;
        settled = true;
        subscription.remove();
        const result = await tripBubbleAvailability();
        resolve({ granted: result.available });
      };
      const subscription = AppState.addEventListener('change', state => {
        if (state !== 'active') left = true;
        else if (left) void finish();
      });
      Promise.resolve().then(() => native.openOverlaySettings()).then(opened => {
        if (opened !== true) void finish();
      }, () => { void finish(); });
    });
  } catch { return { granted: false }; }
}

export async function showTripBubble(tripId) {
  if (!((typeof tripId === 'string' && tripId.trim()) || (typeof tripId === 'number' && Number.isFinite(tripId)))) {
    return { shown: false, reason: 'invalid-trip' };
  }
  const native = nativeBubble();
  if (!native) return { shown: false, reason: 'unsupported' };
  try {
    const result = await native.showTripBubble(String(tripId));
    if (result?.shown === true) return { shown: true };
    return { shown: false, reason: ['unsupported', 'invalid-trip', 'permission-denied'].includes(result?.reason) ? result.reason : 'start-failed' };
  } catch { return { shown: false, reason: 'start-failed' }; }
}

export async function hideTripBubble({ preservePermissionRequest = false } = {}) {
  if (!preservePermissionRequest) invalidateTripBubbleWork();
  try { await nativeBubble()?.hideTripBubble(); } catch { /* Optional shortcut cleanup must not block navigation. */ }
}
