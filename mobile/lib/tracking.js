import { useEffect, useRef, useState } from "react";
import * as Location from "expo-location";
import { api } from "./api";

const POST_INTERVAL_MS = 30 * 1000;

/**
 * Posts the driver's location to the active trip every 30 seconds.
 *
 * Foreground only. expo-location's watchPositionAsync stops firing when the app
 * is backgrounded, and background updates need a dev build plus Play Store
 * review, so that is deliberately out of scope for this MVP — the driver's
 * position stops updating when they leave the app.
 *
 * @param {number | null} tripId  active trip, or null to stop tracking
 */
export function useTripTracking(tripId) {
  const [posting, setPosting] = useState(false);
  const [lastSentAt, setLastSentAt] = useState(null);
  const [error, setError] = useState(null);
  const [latestFix, setLatestFix] = useState(null);

  // Held in a ref so the interval callback always sees the latest fix without
  // being torn down and recreated on every position update.
  const latest = useRef(null);

  useEffect(() => {
    if (!tripId) {
      setPosting(false);
      setLatestFix(null);
      return;
    }

    let subscription = null;
    let interval = null;
    let cancelled = false;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;

      if (status !== "granted") {
        setError(
          "Location is off. Turn it on in Settings so dispatch can see your trip."
        );
        setPosting(false);
        return;
      }

      setError(null);
      setPosting(true);

      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 10 },
        (loc) => {
          latest.current = loc;
          if (!cancelled) {
            setLatestFix({
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
            });
          }
        }
      );

      // Send on a timer rather than on every movement callback, so a driver in
      // traffic doesn't generate hundreds of rows.
      interval = setInterval(async () => {
        const loc = latest.current;
        if (!loc) return;
        try {
          await api.post(`/api/mobile/driver/trips/${tripId}/gps`, {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            speed: loc.coords.speed ?? 0,
            heading: loc.coords.heading ?? 0,
            altitude: loc.coords.altitude ?? 0,
            accuracy: loc.coords.accuracy ?? 0,
            recorded_at: new Date(loc.timestamp).toISOString(),
          });
          if (!cancelled) {
            setLastSentAt(new Date());
            setError(null);
          }
        } catch (e) {
          // A dropped post is not worth interrupting the driver over; the next
          // tick retries. Only surface it so the card can show it is stale.
          if (!cancelled) setError("Location not sent. Retrying.");
        }
      }, POST_INTERVAL_MS);
    })();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      if (subscription) subscription.remove();
      setPosting(false);
      setLatestFix(null);
    };
  }, [tripId]);

  return { posting, lastSentAt, error, latestFix };
}
