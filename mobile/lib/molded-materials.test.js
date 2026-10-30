import { afterEach, expect, it, vi } from 'vitest';
import { Platform } from 'react-native';
import { moldedMaterials } from '../components/clay/molded-materials';
vi.mock('react-native', () => ({ Platform: { OS: 'web', Version: 29 } }));
afterEach(() => vi.unstubAllGlobals());
it('provides every existing material and resets the same style keys on theme changes', () => {
  Platform.OS = 'web';
  const light = moldedMaterials(false), dark = moldedMaterials(true);
  expect(light.supported).toBe(true); expect(dark.supported).toBe(true);
  for (const key of ['clayShade', 'compactShade', 'clayTile', 'clayButton', 'clayPill', 'clayInput']) {
    expect(Object.keys(light[key]).sort()).toEqual(Object.keys(dark[key]).sort());
  }
});
it('retains stable cached references for both schemes', () => {
  for (const dark of [false, true]) expect(moldedMaterials(dark)).toBe(moldedMaterials(dark));
});
