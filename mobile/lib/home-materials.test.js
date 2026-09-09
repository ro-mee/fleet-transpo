import { afterEach, expect, it, vi } from 'vitest';
import { Platform } from 'react-native';
import { homeMaterials } from '../components/home/materials';
import { clayMaterials } from './clay';

vi.mock('react-native', () => ({ Platform: { OS: 'android', Version: 29 } }));
afterEach(() => { vi.unstubAllGlobals(); Platform.OS = 'android'; Platform.Version = 29; });

it('keeps legacy/older Android depth and scopes molded shadows to supported renderers', () => {
  vi.stubGlobal('nativeFabricUIManager', undefined);
  expect(homeMaterials(false)).toEqual(clayMaterials(false));
  vi.stubGlobal('nativeFabricUIManager', {});
  Platform.Version = 28;
  expect(homeMaterials(false)).toEqual(clayMaterials(false));
  Platform.Version = 29;
  expect(homeMaterials(false).clayTile.boxShadow).toContain('inset 1px 2px 4px');
});

it('fully replaces the same shadow/style keys on every light-dark-light switch', () => {
  Platform.OS = 'web';
  const first = homeMaterials(false);
  const dark = homeMaterials(true);
  for (const key of ['clayShade', 'compactShade', 'clayTile']) {
    expect(Object.keys(first[key]).sort()).toEqual(Object.keys(dark[key]).sort());
    expect(dark[key].boxShadow).not.toEqual(first[key].boxShadow);
    expect(first[key].shadowOpacity).toBe(0);
    expect(first[key].elevation).toBe(0);
  }
  expect(homeMaterials(false)).toEqual(first);
});
