// Presentation only: the server's status groups still own lifecycle eligibility.
export function homeVehicleImage(vehicle) {
  // Only vehicle-photo fields, never a trip's receipt or other evidence image.
  return [vehicle?.vehicle_image_url, vehicle?.vehicle_photo_url, vehicle?.image_url, vehicle?.photo_url, vehicle?.image, vehicle?.imageUrl]
    .find(uri => typeof uri === 'string' && /^https?:\/\/\S+$/i.test(uri.trim()))?.trim() ?? null;
}

// Max upcoming trip cards rendered on Home before the "+N more" footer.
// The API already returns trips in scheduled-departure order, so the first
// N of `upcoming` are the nearest ones.
export const HOME_UPCOMING_LIMIT = 3;

export function selectHomeTrips(trips, activeStatuses) {
  const open = trips.filter(t => !['Completed', 'Cancelled'].includes(t.trip_status));
  const current = open.find(t => activeStatuses.includes(t.trip_status)) ?? null;
  // Server (chronological) order is preserved; the current trip is excluded.
  const upcoming = open.filter(t => t.trip_id !== current?.trip_id);
  return { current, upcoming };
}

/**
 * The Home card's action for a trip.
 *
 * `preShiftPassed` is today's shift-wide baseline and defaults to true so the
 * two-argument form is unchanged for existing callers — and because a caller
 * that has not resolved it yet must not be treated as "outstanding".
 *
 * The baseline is checked ahead of the window and the per-trip check: it gates
 * every trip, so while it is missing this card must not offer "Start Trip" for
 * a trip the server would refuse to start. The label it falls back to is the
 * generic "Trip Details", not a start-sounding variant, because the card cannot
 * know which screen the driver should land on.
 */
export function homeTripAction(trip, nowMs, { preShiftPassed = true } = {}) {
  const preStart = ['Pending', 'Approved', 'Assigned', 'Vehicle Assigned', 'Driver Assigned', 'Dispatched', 'Driver Accepted'].includes(trip?.trip_status);
  const earliest = trip?.earliest_start ? new Date(trip.earliest_start).getTime() : NaN;
  if (preStart && !preShiftPassed) return 'Trip Details';
  if (preStart && !(Number.isFinite(earliest) && nowMs >= earliest && trip.pre_trip_status === 'Passed')) return 'Trip Details';
  return preStart ? 'Start Trip' : 'Continue Trip';
}
