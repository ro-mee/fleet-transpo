import { describe, it, expect } from 'vitest';
import { normalizeQuantity, compareQuantities } from './quantities';
describe('cargo quantity arithmetic', () => {
  it.each(['-1', '1e2', 'NaN', 'Infinity', '', ' 1', '.2', '1.0001', null, Infinity, 0.1])('rejects ambiguous quantity %s', value => {
    expect(() => normalizeQuantity(value, { basis: 'UNIT' })).toThrow();
  });
  it('canonicalizes decimal strings without precision loss', () => {
    expect(normalizeQuantity('000123.120', { basis: 'UNIT' })).toBe('123.12');
    expect(normalizeQuantity('0.000', { basis: 'UNIT' })).toBe('0');
    expect(compareQuantities('999999999999.999', '999999999999.998')).toBe(1);
    expect(compareQuantities('0.1', '0.100')).toBe(0);
    expect(compareQuantities('9', '10')).toBe(-1);
  });
  it('requires integer packages and a known basis', () => {
    expect(() => normalizeQuantity('1.2', { basis: 'TRANSPORT_PACKAGE' })).toThrow();
    expect(() => normalizeQuantity('1', { basis: 'BOX' })).toThrow();
    expect(normalizeQuantity('10.000', { basis: 'TRANSPORT_PACKAGE' })).toBe('10');
  });
});
