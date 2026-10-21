import { afterEach, expect, it, vi } from 'vitest';
import { assertGenericOdometerWriteAllowed as guard, requiresOdometerPhoto } from './odometer-gate';
afterEach(() => vi.unstubAllEnvs());
it('defaults off and latches completion independently of the global switch', () => {
  vi.stubEnv('ODOMETER_PHOTO_REQUIRED', '0');
  expect(requiresOdometerPhoto({ trip: {}, stage: 'start' })).toBe(false);
  expect(requiresOdometerPhoto({ trip: { odometer_capture_required: true }, stage: 'end' })).toBe(true);
  expect(requiresOdometerPhoto({ trip: {}, stage: 'end', enabled: true })).toBe(false);
});
it.each(['Trip Started', 'At Pickup', 'In Progress', 'Completed'])('blocks raw new execution %s when enabled', trip_status => {
  expect(() => guard({ before: { trip_status: 'Driver Accepted' }, patch: { trip_status }, enabled: true })).toThrow(/photo/i);
  expect(() => guard({ before: null, patch: { trip_status }, enabled: true })).toThrow(/photo/i);
});
it.each(['start_odometer','end_odometer','distance','start_time','end_time'])('blocks required %s rewrites', key => {
  expect(() => guard({ before: { trip_status: 'Completed', odometer_capture_required: true }, patch: { [key]: 42 } })).toThrow(/photo/i);
});
it('allows normal legs, notes, cancellation and prestart assignments', () => {
  for (const patch of [{ trip_status: 'At Pickup' }, { notes: 'Saved' }, { trip_status: 'Cancelled' }]) {
    expect(() => guard({ before: { trip_status: 'Trip Started', odometer_capture_required: true }, patch })).not.toThrow();
  }
  expect(() => guard({ before: { trip_status: 'Assigned' }, patch: { vehicle_id: 4 }, enabled: true })).not.toThrow();
  expect(() => guard({ before: { trip_status: 'Completed' }, patch: { end_odometer: 10 }, enabled: true })).not.toThrow();
});
it.each(['vehicle_id','driver_id'])('blocks active required %s reassignment', key => {
  expect(() => guard({ before: { trip_status: 'Trip Started', odometer_capture_required: true, [key]: 1 }, patch: { [key]: 2 } })).toThrow(/photo/i);
});
it('blocks resetting required active trips to prestart and clearing the server latch', () => {
  const before = { trip_status: 'Trip Started', odometer_capture_required: true };
  expect(() => guard({ before, patch: { trip_status: 'Assigned' } })).toThrow(/photo/i);
  expect(() => guard({ before, patch: { odometer_capture_required: false } })).toThrow(/photo/i);
});
