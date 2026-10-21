import { AuthError } from '@/lib/api/utils';
import { canTransitionTrip, isPreStartTripStatus } from '@/lib/scheduling/trip-state';

export function requiresOdometerPhoto({ trip, stage, enabled = process.env.ODOMETER_PHOTO_REQUIRED === '1' }) {
  return trip?.odometer_capture_required === true || (stage === 'start' && enabled);
}

export function odometerPhotoRequired() {
  throw new AuthError('An odometer photo is required. Open this trip in the updated driver app to take and confirm the photo.', 409, 'ODOMETER_PHOTO_REQUIRED');
}

/** Generic writes cannot create or replace the facts owned by photo lifecycle commits. */
export function assertGenericOdometerWriteAllowed({ before, patch, enabled = process.env.ODOMETER_PHOTO_REQUIRED === '1' }) {
  if (Object.hasOwn(patch, 'odometer_capture_required')) odometerPhotoRequired();
  const prestart = !before || isPreStartTripStatus(before.trip_status);
  // Historical corrections may edit saved values, but cannot reopen execution
  // (including a new shell cancelled before its photo requirement was latched).
  const to = patch.trip_status;
  if (enabled && ['Cancelled', 'Completed'].includes(before?.trip_status) && to !== undefined && to !== before.trip_status) odometerPhotoRequired();
  if (!before?.odometer_capture_required && !(enabled && prestart)) return;
  if (['start_odometer', 'end_odometer', 'distance', 'start_time', 'end_time', 'distance_provenance', 'actual_distance_km'].some(key => Object.hasOwn(patch, key))) odometerPhotoRequired();
  if (!prestart && ['driver_id', 'vehicle_id'].some(key => Object.hasOwn(patch, key) && String(patch[key]) !== String(before[key]))) odometerPhotoRequired();
  if (to === undefined || to === before?.trip_status) return;
  if (to === 'Cancelled' && !['Completed', 'Cancelled'].includes(before?.trip_status)) return;
  if (prestart && isPreStartTripStatus(to)) return;
  if (prestart || to === 'Completed' || isPreStartTripStatus(to) || !canTransitionTrip(before?.trip_status, to).ok) odometerPhotoRequired();
}
