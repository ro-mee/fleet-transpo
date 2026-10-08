import { isPreStartTripStatus } from "@/lib/scheduling/trip-state";

const MINUTE_MS = 60_000;

/** True when a valid timestamp falls from now through the end of the window. */
export function isWithinUpcomingWindow(value, now = new Date(), windowMinutes = 30) {
  const timestamp = new Date(value).getTime();
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const windowMs = Number(windowMinutes) * MINUTE_MS;
  return (
    Number.isFinite(timestamp) &&
    Number.isFinite(nowMs) &&
    Number.isFinite(windowMs) &&
    windowMs >= 0 &&
    timestamp >= nowMs &&
    timestamp <= nowMs + windowMs
  );
}

/** A scheduled dispatch at or past pickup without a recorded start. */
export function isPickupDueWithoutStart(dispatch, now = new Date()) {
  if (dispatch?.status !== "Scheduled") return false;
  if (("vehicle_id" in dispatch && dispatch.vehicle_id == null) || ("driver_id" in dispatch && dispatch.driver_id == null)) return false;
  if (dispatch.latest_trip && !isPreStartTripStatus(dispatch.latest_trip.trip_status)) return false;

  const pickupMs = new Date(dispatch.scheduled_departure).getTime();
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(pickupMs) || !Number.isFinite(nowMs) || pickupMs > nowMs) {
    return false;
  }

  const startValues = [
    dispatch.actual_departure,
    dispatch.start_time,
    dispatch.latest_trip?.start_time,
  ];
  return !startValues.some((value) => value != null && Number.isFinite(new Date(value).getTime()));
}
