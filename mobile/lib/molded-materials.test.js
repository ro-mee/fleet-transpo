import { afterEach, describe, expect, it, vi } from 'vitest';
import { Platform } from 'react-native';
import { moldedMaterials } from '../components/clay/molded-materials';

vi.mock('react-native', () => ({ Platform: { OS: 'android', Version: 29 } }));
afterEach(() => {
  vi.unstubAllGlobals();
  Platform.OS = 'android';
  Platform.Version = 29;
});

describe('moldedMaterials universal clay engine', () => {
  it('mirrors the notification bell dual-pass boxShadow on supported renderers', () => {
    Platform.OS = 'web';
    const light = moldedMaterials(false);
    const dark = moldedMaterials(true);

    expect(light.supported).toBe(true);
    expect(dark.supported).toBe(true);

    // Exact notification bell recipe: warm amber shade + white inset highlight
    expect(light.clayTile.boxShadow).toContain('rgba(83,74,53,0.20)');
    expect(light.clayTile.boxShadow).toContain('inset 1px 2px 4px rgba(255,255,255,0.92)');

    // Dark mode: deep shade + pale sage whisper highlight
    expect(dark.clayTile.boxShadow).toContain('rgba(0,0,0,0.48)');
    expect(dark.clayTile.boxShadow).toContain('inset 1px 2px 4px rgba(220,240,229,0.07)');

    // Zero elevation / zero shadowOpacity when boxShadow is active
    expect(light.clayTile.elevation).toBe(0);
    expect(light.clayTile.shadowOpacity).toBe(0);
  });

  it('guarantees style-key parity between light and dark modes across all clay components', () => {
    Platform.OS = 'web';
    const light = moldedMaterials(false);
    const dark = moldedMaterials(true);

    const components = ['clayShade', 'compactShade', 'clayTile', 'clayButton', 'clayPill', 'clayInput'];
    for (const comp of components) {
      expect(light[comp]).toBeDefined();
      expect(dark[comp]).toBeDefined();
      expect(Object.keys(light[comp]).sort()).toEqual(Object.keys(dark[comp]).sort());
      expect(light[comp].boxShadow).not.toEqual(dark[comp].boxShadow);
    }
  });

  it('provides molded clay input recipe with subtle recessed inset highlight', () => {
    Platform.OS = 'web';
    const light = moldedMaterials(false);
    const dark = moldedMaterials(true);

    expect(light.clayInput.boxShadow).toContain('inset 1px 2px 4px');
    expect(light.clayInput.borderWidth).toBe(0);
    expect(dark.clayInput.boxShadow).toContain('inset 1px 2px 4px');
    expect(dark.clayInput.borderWidth).toBe(0);
  });

  it('retains stable cache reference for identical theme', () => {
    const first = moldedMaterials(false);
    const second = moldedMaterials(false);
    expect(first).toBe(second);
  });
});
