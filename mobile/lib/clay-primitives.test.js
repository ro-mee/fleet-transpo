import { describe, it, expect } from 'vitest';
import { raisedControl, pillEdges, clayMaterials } from './clay';

describe('clay primitives tokens and materials', () => {
  it('provides light and dark raised control definitions with correct borders', () => {
    const light = raisedControl(false);
    const dark = raisedControl(true);

    expect(light.borderTopWidth).toBe(2);
    expect(light.borderTopColor).toBe('#FFFFFF55');
    expect(light.borderBottomWidth).toBe(3);
    expect(light.borderBottomColor).toBe('#00000028');
    expect(light.borderWidth).toBe(0);
    expect(light.borderColor).toBe('transparent');

    expect(dark.borderTopWidth).toBe(1.5);
    expect(dark.borderTopColor).toBe('rgba(255,255,255,0.12)');
    expect(dark.borderBottomWidth).toBe(1.5);
    expect(dark.borderBottomColor).toBe('rgba(0,0,0,0.40)');
    expect(dark.borderWidth).toBe(1);
  });

  it('provides light and dark pill edges definitions with correct borders', () => {
    const light = pillEdges(false);
    const dark = pillEdges(true);

    expect(light.borderTopWidth).toBe(2);
    expect(light.borderTopColor).toBe('#FFFFFF60');
    expect(light.borderBottomWidth).toBe(2);
    expect(light.borderBottomColor).toBe('#00000012');
    expect(light.borderWidth).toBe(0);
    expect(light.borderColor).toBe('transparent');

    expect(dark.borderTopWidth).toBe(1);
    expect(dark.borderTopColor).toBe('rgba(255,255,255,0.10)');
    expect(dark.borderBottomWidth).toBe(1.5);
    expect(dark.borderBottomColor).toBe('rgba(0,0,0,0.35)');
    expect(dark.borderWidth).toBe(1);
  });

  it('clay materials return all essential surface styles', () => {
    const mats = clayMaterials(false);
    expect(mats.clayShade).toBeDefined();
    expect(mats.compactShade).toBeDefined();
    expect(mats.clayTile).toBeDefined();
    expect(mats.clayPill).toBeDefined();
    expect(mats.clayCta).toBeDefined();
  });
});

