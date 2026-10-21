import { describe, expect, it } from 'vitest';
import { getDriverGuide, listDriverGuides, LEGACY_GUIDE_IMPORTS } from './driver-guides';

describe('driver guidance catalogue', () => {
  it('provides useful common help and distinct Passenger/Cargo workflows', () => {
    expect(getDriverGuide('welcome', 'common').steps[0].details).toContain('Dispatch');
    expect(getDriverGuide('inspection.quick', 'cargo').steps[0].body).toContain('secure');
    expect(getDriverGuide('inspection.quick', 'passenger').steps[0].body).toContain('passenger');
    expect(listDriverGuides('cargo').some(g => g.id === 'cargo.departure')).toBe(true);
    expect(listDriverGuides('passenger').some(g => g.id === 'cargo.departure')).toBe(false);
    expect(getDriverGuide('cargo.departure', 'passenger')).toBeNull();
    expect(getDriverGuide('passenger.pickup', 'cargo')).toBeNull();
    expect(listDriverGuides('unknown')).toEqual([]);
  });
  it('gives every step a clear action, fuller explanation and stable identity', () => {
    const records = [...listDriverGuides('common'), ...listDriverGuides('cargo').filter(g => g.variant === 'cargo'), ...listDriverGuides('passenger').filter(g => g.variant === 'passenger')];
    expect(records.length).toBeGreaterThanOrEqual(19);
    const ids = new Set();
    for (const g of records) {
      expect(g.version).toBeGreaterThan(0);
      expect(g.route).toMatch(/^\//);
      for (const s of g.steps) {
        expect(ids.has(s.id)).toBe(false); ids.add(s.id);
        expect(s.body.length).toBeGreaterThan(45);
        expect(s.details.length).toBeGreaterThan(100);
        expect(s.requiresInteraction).not.toBe(true);
        if (g.variant === 'cargo') expect(s.body).not.toMatch(/picked up guest|dropped off guest/i);
      }
    }
  });
  it('keeps new signature and photo content independent of old tour completion', () => {
    expect(getDriverGuide('odometer.start', 'common').steps[0].details).toContain('Trip A');
    expect(getDriverGuide('cargo.departure', 'cargo').steps[0].details).toContain('not that the quantity was accepted');
    expect(LEGACY_GUIDE_IMPORTS['cargo.pickup_signature']).toBeUndefined();
    expect(LEGACY_GUIDE_IMPORTS['odometer.start']).toBeUndefined();
    expect(LEGACY_GUIDE_IMPORTS.welcome).toEqual(['welcome']);
  });
});
