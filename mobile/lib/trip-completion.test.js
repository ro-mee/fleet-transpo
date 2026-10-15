import { describe, expect, it } from 'vitest';
import { validateCompletionReading } from './trip-completion';

describe('actual ending odometer', () => {
  it.each(['', '0', '-1', 'NaN', 'Infinity', '12 km', '1e4', '1,234', '.5'])('rejects %s', value => {
    expect(validateCompletionReading(value, 10).error).toBeTruthy();
  });
  it('accepts positive numeric readings at or above recorded mileage', () => {
    expect(validateCompletionReading(' 1234.5 ', 1234)).toEqual({ value: 1234.5, error: null });
    expect(validateCompletionReading('1234', '1234').error).toBeNull();
  });
  it('revalidates against newly recorded mileage and preserves the entered reading', () => {
    expect(validateCompletionReading('1234', 1200).error).toBeNull();
    expect(validateCompletionReading('1234', 1250).error).toContain('1250 km');
  });
});
