import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const bridgePath = new URL('../modules/fleetops-trip-bubble/src/FleetOpsTripBubbleModule.ts', import.meta.url);

// React Native's native loader cannot run in Node; exercise the real bridge
// against only its platform/native boundary after TypeScript compilation.
function loadBridge(platform, nativeModule = null) {
  const loadNative = vi.fn(() => nativeModule);
  const { outputText } = ts.transpileModule(readFileSync(bridgePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  });
  const exports = {};
  runInNewContext(outputText, {
    exports,
    require(name) {
      if (name === 'react-native') return { Platform: { OS: platform } };
      if (name === 'expo-modules-core') return { requireOptionalNativeModule: loadNative };
      throw new Error(`Unexpected bridge dependency: ${name}`);
    },
  });
  return { bridge: exports.default, loadNative };
}

describe('optional Android trip bubble bridge', () => {
  it.each(['ios', 'web'])('imports safely on %s without looking for an Android module', async (platform) => {
    const { bridge, loadNative } = loadBridge(platform);
    expect(loadNative).not.toHaveBeenCalled();
    expect(await bridge.canDrawOverlays()).toBe(false);
    expect(await bridge.openOverlaySettings()).toBe(false);
    expect(await bridge.showTripBubble('trip-1')).toEqual({ shown: false, reason: 'unsupported' });
    await expect(bridge.hideTripBubble()).resolves.toBeUndefined();
  });

  it('imports safely on an older Android build missing the native module', async () => {
    const { bridge, loadNative } = loadBridge('android');
    expect(loadNative).toHaveBeenCalledWith('FleetOpsTripBubble');
    expect(await bridge.showTripBubble('trip-1')).toEqual({ shown: false, reason: 'unsupported' });
    expect(await bridge.canDrawOverlays()).toBe(false);
    expect(await bridge.openOverlaySettings()).toBe(false);
    await expect(bridge.hideTripBubble()).resolves.toBeUndefined();
  });

  it('preserves the native bridge and its truthful show result', async () => {
    const nativeModule = {
      canDrawOverlays: async () => true,
      openOverlaySettings: async () => true,
      showTripBubble: async () => ({ shown: false, reason: 'permission-denied' }),
      hideTripBubble: async () => undefined,
    };
    const { bridge } = loadBridge('android', nativeModule);
    expect(bridge).toBe(nativeModule);
    expect(await bridge.showTripBubble('trip-1')).toEqual({ shown: false, reason: 'permission-denied' });
  });
});
