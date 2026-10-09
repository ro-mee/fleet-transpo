// Strings keep source decimal precision; no floating-point quantity arithmetic.
export function normalizeQuantity(value, { basis } = {}) {
  if (!['UNIT', 'TRANSPORT_PACKAGE'].includes(basis) || typeof value !== 'string' ||
      value.length > 32 || !/^\d{1,15}(?:\.\d{1,3})?$/.test(value)) throw new Error('Invalid cargo quantity.');
  const [integer, fraction = ''] = value.split('.');
  const tail = fraction.replace(/0+$/, '');
  if (basis === 'TRANSPORT_PACKAGE' && tail) throw new Error('Package counts must be integers.');
  return `${BigInt(integer)}${tail ? `.${tail}` : ''}`;
}

export function compareQuantities(expected, actual) {
  const scaled = value => {
    const [whole, fraction = ''] = normalizeQuantity(value, { basis: 'UNIT' }).split('.');
    return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  };
  const a = scaled(expected), b = scaled(actual);
  return a === b ? 0 : a < b ? -1 : 1;
}
