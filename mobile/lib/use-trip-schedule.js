import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { api, isTransportFailure } from "./api";
import { CACHE_KEYS, getCached, setCached } from "./offline-cache";
import { LIST_AUTO_RETRY_MS, shouldAutoRetry } from "./connectivity-state";
import { scheduleSections } from "./trips-schedule";

const KEYS = { today: CACHE_KEYS.TRIPS_TODAY, upcoming: CACHE_KEYS.TRIPS_UPCOMING, history: CACHE_KEYS.TRIPS_HISTORY };

export function useTripSchedule({ driverId, tab, day, offline }) {
  const [state, setState] = useState({ trips: [], hasMore: false, nextOffset: null, lastSynced: null, confirmed: false });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const sequence = useRef(0);
  const currentState = useRef(state);
  const busy = useRef(false);

  const load = useCallback(async (more = false, hydrate = false) => {
    if (more && busy.current) return;
    const request = ++sequence.current;
    const current = () => sequence.current === request;
    busy.current = true;
    setError(null);
    if (more) setLoadingMore(true);
    else if (!hydrate) setRefreshing(true);
    try {
      if (hydrate && driverId) {
        const keys = tab === "history" ? [KEYS.history] : [KEYS.today, KEYS.upcoming];
        const snapshots = await Promise.all(keys.map(async (key) => ({ key, entry: await getCached(driverId, key) })));
        if (!current()) return;
        const valid = snapshots.filter((s) => Array.isArray(s.entry?.data?.trips) && s.entry.data.trips.every((trip) => trip?.trip_id != null));
        const own = valid.find((s) => s.key === KEYS[tab])?.entry;
        if (valid.length) {
          const ownConfirmed = Array.isArray(own?.data?.trips) && (tab === "history" || own.data.day === day);
          const rows = new Map();
          valid.sort((a, b) => (a.entry.syncedAt || 0) - (b.entry.syncedAt || 0)).forEach(({ entry }) => entry.data.trips.forEach((trip) => rows.set(trip.trip_id, trip)));
          const cachedState = {
            trips: ownConfirmed ? own.data.trips : [...rows.values()],
            hasMore: ownConfirmed ? own.data.hasMore === true : false,
            nextOffset: ownConfirmed ? own.data.nextOffset : null,
            lastSynced: ownConfirmed ? own.syncedAt : valid.at(-1).entry.syncedAt,
            confirmed: ownConfirmed,
          };
          currentState.current = cachedState;
          setState(cachedState);
          if (ownConfirmed || scheduleSections(cachedState.trips, tab, Date.now()).length) setLoading(false);
        }
      }
      const previous = currentState.current;
      const offset = more ? previous.nextOffset : 0;
      if (more && (!previous.hasMore || !Number.isInteger(offset))) return;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const page = await api.get(`/api/mobile/driver/trips?view=${tab}&limit=30&offset=${offset}`);
          if (!current()) return;
          if (!page || !Array.isArray(page.trips) || page.trips.some((trip) => trip?.trip_id == null) || typeof page.hasMore !== "boolean"
            || (page.hasMore && (!Number.isInteger(page.nextOffset) || page.nextOffset <= offset))) {
            throw new Error("Your trip schedule could not be confirmed. Please try again.");
          }
          const rows = new Map((more ? previous.trips : []).map((trip) => [trip.trip_id, trip]));
          page.trips.forEach((trip) => rows.set(trip.trip_id, trip));
          const next = { trips: [...rows.values()], hasMore: page.hasMore, nextOffset: page.nextOffset, lastSynced: Date.now(), confirmed: true };
          currentState.current = next;
          setState(next);
          if (driverId) await setCached(driverId, KEYS[tab], { trips: next.trips, hasMore: next.hasMore, nextOffset: next.nextOffset, day });
          return;
        } catch (e) {
          if (!current()) return;
          if (attempt === 0 && shouldAutoRetry(e)) {
            await new Promise((resolve) => setTimeout(resolve, LIST_AUTO_RETRY_MS));
            if (!current()) return;
            continue;
          }
          // The global banner owns transport errors; never replace saved rows.
          if (!isTransportFailure(e) || !currentState.current.lastSynced) setError(e.message || "Could not load trips. Please try again.");
        }
      }
    } finally {
      if (current()) {
        busy.current = false;
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, [driverId, tab, day]);

  useFocusEffect(useCallback(() => {
    load(false, true);
    return () => { sequence.current++; busy.current = false; };
  }, [load]));
  // Also invalidate late responses if this scoped list unmounts.
  useEffect(() => () => { sequence.current++; }, []);

  return { ...state, loading, refreshing, loadingMore, error, refresh: () => load(), loadMore: () => !offline && load(true) };
}
