/** A blank gauge reading is unknown; an explicit zero means empty. */
export function fuelLevelError(input) {
  const text = String(input ?? '').replace(/,/g, '').trim();
  if (!text) return 'Enter the dashboard fuel level from 0 to 100%.';
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? null : 'Enter a number from 0 to 100%.';
}
