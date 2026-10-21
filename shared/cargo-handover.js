export const CARGO_HANDOVER_ACKNOWLEDGMENT = 'CARGO_HANDOVER_V1';

const invalid = () => { throw new Error('Invalid cargo handover acknowledgment.'); };
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid();
}
function signer(value, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum || /[<>\u0000-\u001f\u007f]/.test(value)) invalid();
  return value.trim();
}
function timestamp(value) {
  if (typeof value !== 'string') invalid();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) invalid();
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > days || hour > 23 || minute > 59 || second > 59 || !Number.isFinite(Date.parse(value))) invalid();
  return new Date(value).toISOString();
}
function number(value, minimum, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) invalid();
  return Object.is(value, -0) ? 0 : value;
}
function denseArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.keys(value).length !== value.length ||
    Object.keys(value).some((key, index) => key !== String(index))) invalid();
}
function signatureValue(value) {
  object(value, ['width', 'height', 'strokes']);
  if (value.width !== 600 || value.height !== 240 || !Array.isArray(value.strokes) || value.strokes.length < 1 || value.strokes.length > 64) invalid();
  denseArray(value.strokes);
  let total = 0, meaningful = false;
  const strokes = value.strokes.map(stroke => {
    if (!Array.isArray(stroke) || stroke.length < 2 || (total += stroke.length) > 2048) invalid();
    denseArray(stroke);
    const points = stroke.map(point => {
      if (!Array.isArray(point) || point.length !== 2) invalid();
      denseArray(point);
      return [number(point[0], 0, 600), number(point[1], 0, 240)];
    });
    const length = points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point[0] - points[index][0], point[1] - points[index][1]), 0);
    if (length >= 2) meaningful = true;
    return points;
  });
  if (!meaningful) invalid();
  return { width: 600, height: 240, strokes };
}

// Pure and clock-independent: historical reads and replay hashes normalize identically.
// GPS age is relative to the acknowledgment capture, including offline drafts.
export function validateCargoHandover(value) {
  object(value, ['version', 'signer_name', 'signer_role_or_dept', 'acknowledgment', 'captured_at', 'signature', 'location']);
  if (value.version !== 1 || value.acknowledgment !== CARGO_HANDOVER_ACKNOWLEDGMENT) invalid();
  const captured_at = timestamp(value.captured_at);
  let location = null;
  if (value.location !== null) {
    object(value.location, ['latitude', 'longitude', 'accuracy_m', 'captured_at']);
    location = { latitude: number(value.location.latitude, -90, 90), longitude: number(value.location.longitude, -180, 180), accuracy_m: number(value.location.accuracy_m, 0, 10000), captured_at: timestamp(value.location.captured_at) };
    const age = Date.parse(captured_at) - Date.parse(location.captured_at);
    if (age > 300000 || age < -60000) invalid();
  }
  return { version: 1, signer_name: signer(value.signer_name, 160), signer_role_or_dept: signer(value.signer_role_or_dept, 120), acknowledgment: CARGO_HANDOVER_ACKNOWLEDGMENT, captured_at, signature: signatureValue(value.signature), location };
}

export function cargoSignaturePaths(signature) {
  return signatureValue(signature).strokes.map(stroke => stroke.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' '));
}
