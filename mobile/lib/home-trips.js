// Presentation only: the server's status groups still own lifecycle eligibility.
export function selectHomeTrips(trips, activeStatuses) {
  const open = trips.filter(t => !['Completed', 'Cancelled'].includes(t.trip_status));
  const current = open.find(t => activeStatuses.includes(t.trip_status)) ?? null;
  const upcoming = open.filter(t => t.trip_id !== current?.trip_id);
  // secondNext: only rendered when there is no current trip and 2+ scheduled
  // remain — the spec's "first scheduled + one below it, none labeled Current".
  return { current, next: upcoming[0] ?? null, secondNext: upcoming[1] ?? null, upcoming };
}

export function homeTripAction(trip, nowMs) {
  const preStart = ['Pending', 'Approved', 'Assigned', 'Vehicle Assigned', 'Driver Assigned', 'Dispatched', 'Driver Accepted'].includes(trip?.trip_status);
  const earliest = trip?.earliest_start ? new Date(trip.earliest_start).getTime() : NaN;
  if (preStart && !(Number.isFinite(earliest) && nowMs >= earliest && trip.pre_trip_status === 'Passed')) return 'Trip Details';
  return preStart ? 'Start Trip' : 'Continue Trip';
}
