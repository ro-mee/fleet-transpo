/**
 * useDriverProfile — the shared cached read of `/api/driver/me` behind the
 * Profile tab and its four sub-screens (Offline Read Mode follow-up).
 *
 * Every Profile screen used to do its own live fetch with a silent catch or
 * an error alert, so offline meant either a bare "Driver" shell or an
 * "Unable to Load Profile" alert. Now they all read through this hook:
 *
 *   1. cached-first — the DRIVER_ME entry the core screens (Home) and this
 *      hook maintain is applied immediately, so the screens render offline;
 *   2. live fetch revalidates and overwrites the cache on success;
 *   3. on failure the cached profile simply stays (offline), and `onError`
 *      fires ONLY when there is nothing to show (never-synced).
 *
 * UX rule (locked): Profile/Settings screens are SILENT about caching — no
 * SyncNote, no Saved chip. The global connectivity banner is enough.
 * Trips/Schedules/Logs need freshness indicators because they change
 * operationally; a driver's own name/plate/license do not.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import { resolveDriverId, getCached, setCached, CACHE_KEYS } from "./offline-cache";

/**
 * @param {{ onError?: (e: unknown) => void }} opts — called only when the
 *   live fetch failed AND no cached profile exists (true never-synced).
 * @returns {{ profile: object|null, loading: boolean, reload: () => Promise<void> }}
 */
export function useDriverProfile({ onError } = {}) {
  const { user } = useAuth();
  const driverId = resolveDriverId(user);

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  const haveProfileRef = useRef(false);
  useEffect(() => {
    haveProfileRef.current = profile != null;
  }, [profile]);

  const load = useCallback(async () => {
    // 1. Cached-first: apply the saved profile (if any) before any network.
    if (driverId) {
      const entry = await getCached(driverId, CACHE_KEYS.DRIVER_ME).catch(() => null);
      if (entry?.data != null) setProfile(entry.data);
    }
    // 2. Live revalidate + cache write.
    try {
      const me = await api.get("/api/driver/me");
      setProfile(me);
      if (driverId && me != null) {
        await setCached(driverId, CACHE_KEYS.DRIVER_ME, me);
      }
    } catch (e) {
      // 3. Offline keeps the cached profile. Only the never-synced case
      // (nothing to render) surfaces as an error.
      if (!haveProfileRef.current) onErrorRef.current?.(e);
    } finally {
      setLoading(false);
    }
  }, [driverId]);

  useEffect(() => {
    // Deferred one tick: mount-fetch semantics without sync setState in the
    // effect body (same idiom the screens used before this hook existed).
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  return { profile, loading, reload: load };
}
