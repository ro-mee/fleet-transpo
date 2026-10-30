import { describe, it, expect } from 'vitest';
import { raisedControl, pillEdges, clayMaterials } from './clay';

describe('clay primitives tokens and materials', () => {
  it('keeps control and pill styles compatible across theme switches', () => {
    for (const material of [raisedControl, pillEdges]) {
      expect(Object.keys(material(false)).sort()).toEqual(Object.keys(material(true)).sort());
      expect(material(false)).toBe(material(false));
    }
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

