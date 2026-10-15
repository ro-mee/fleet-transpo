export function validateCompletionReading(input, currentMileage) {
  const text = String(input ?? '').trim();
  const value = /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : NaN;
  if (!Number.isFinite(value) || value <= 0) return { error: 'Enter a positive ending odometer reading.' };
  const current = currentMileage == null || String(currentMileage).trim() === '' ? null : Number(currentMileage);
  if (current != null && Number.isFinite(current) && value < current) return { error: `The reading cannot be below the recorded ${current} km.` };
  return { value, error: null };
}
