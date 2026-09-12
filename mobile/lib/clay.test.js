import { describe, it, expect } from 'vitest';
import { clayMaterials } from './clay';

// Regression guard for the Dark→Light theme-switch bug: React Native does
// not reliably reset a style prop that merely vanishes from a style object,
// so a key present only in the dark materials survived a switch back to
// light as stale native state (a rectangular border/shadow outline around
// rounded clay cards). Every material must carry the same set of keys in
// both schemes — dark overrides values, light restores them explicitly.
describe('clay material scheme key parity', () => {
  const light = clayMaterials(false);
  const dark = clayMaterials(true);
  const MATERIALS = ['clayShade', 'clayCard', 'clayPill', 'clayCta', 'compactShade', 'clayTile'];

  it.each(MATERIALS)('clayMaterials(true).%s and clayMaterials(false).%s declare the same keys', (key) => {
    expect(Object.keys(dark[key]).sort()).toEqual(Object.keys(light[key]).sort());
  });

  it('raisedControl(true) and raisedControl(false) declare the same keys and light resets borders', () => {
    const { raisedControl } = require('./clay');
    const lightRc = raisedControl(false);
    const darkRc = raisedControl(true);
    expect(Object.keys(darkRc).sort()).toEqual(Object.keys(lightRc).sort());
    expect(lightRc.borderWidth).toBe(0);
    expect(lightRc.borderColor).toBe('transparent');
  });

  it('pillEdges(true) and pillEdges(false) declare the same keys and light resets borders', () => {
    const { pillEdges } = require('./clay');
    const lightPe = pillEdges(false);
    const darkPe = pillEdges(true);
    expect(Object.keys(darkPe).sort()).toEqual(Object.keys(lightPe).sort());
    expect(lightPe.borderWidth).toBe(0);
    expect(lightPe.borderColor).toBe('transparent');
  });
});

