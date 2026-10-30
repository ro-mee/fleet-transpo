import { afterEach, expect, it, vi } from 'vitest';
import { Platform } from 'react-native';
import { clayMaterials } from './clay';
vi.mock('react-native', () => ({ Platform: { OS: 'android', Version: 29 } }));
afterEach(() => { vi.unstubAllGlobals(); Platform.OS = 'android'; Platform.Version = 29; });
it('retains the native fallback on legacy and older Android renderers', async () => {
  for (const version of [28, 29]) {
    vi.resetModules(); Platform.Version = version;
    vi.stubGlobal('nativeFabricUIManager', version === 28 ? {} : undefined);
    const { homeMaterials } = await import('../components/home/materials');
    const result = homeMaterials(false);
    for (const key of ['clayShade', 'compactShade', 'clayTile']) expect(result[key]).toEqual(clayMaterials(false)[key]);
  }
});
it('keeps Home material caching and native style keys across themes', async () => {
  vi.resetModules(); Platform.OS = 'web';
  const { homeMaterials } = await import('../components/home/materials');
  const first = homeMaterials(false), dark = homeMaterials(true);
  for (const key of ['clayShade', 'compactShade', 'clayTile']) expect(Object.keys(first[key]).sort()).toEqual(Object.keys(dark[key]).sort());
  expect(homeMaterials(false)).toBe(first);
});
