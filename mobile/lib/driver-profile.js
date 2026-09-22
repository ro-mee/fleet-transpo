/**
 * useDriverProfile — the shared cached read of `/api/driver/me` behind the
 * Profile tab and its four sub-screens (Offline Read Mode follow-up).
 *
 * Every Profile screen used to do its own live fetch with a silent catch or
 * an error alert, so offline meant either a bare "Driver" shell or an
 * "Unable to Load Profile" alert. Now they all read through this hook:
 *
 *   1. memory-first — the in-memory entry for this driver paints
 *      synchronously on mount, so tab switches / back navigation never
 *      refetch or flash a spinner;
 *   2. AsyncStorage second — cold start still renders offline before network;
 *   3. live fetch revalidates ONLY when the memory entry is stale (TTL) or
 *      the caller forces it via `reload()` (after phone/photo edits);
 *   4. on failure the cached profile simply stays (offline), and `onError`
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
 * How long a fetched profile is treated as fresh. Inside the TTL, mounting
 * another Profile screen (tab switch, push/pop) paints from memory with zero
 * network. After an edit, screens call `reload()` which bypasses the TTL.
 */
export const DRIVER_PROFILE_TTL_MS = 5 * 60 * 1000;

// Module-level so every hook instance (Profile tab + sub-screens) shares one
// read: mount N paints instantly from the fetch mount 1 already did.
const memByDriver = new Map();
const flightByDriver = new Map();

function readMem(driverId) {
  if (driverId == null) return null;
  return memByDriver.get(String(driverId)) ?? null;
}

/** Test seam — clears the in-memory profile (AsyncStorage untouched). */
export function __resetDriverProfileCache() {
  memByDriver.clear();
  flightByDriver.clear();
}

/**
 * @param {{ onError?: (e: unknown) => void }} opts — called only when the
 *   live fetch failed AND no cached profile exists (true never-synced).
 * @returns {{ profile: object|null, loading: boolean, reload: () => Promise<void> }}
 */
export function useDriverProfile({ onError } = {}) {
  const { user } = useAuth();
  const driverId = resolveDriverId(user);

  const memInitial = readMem(driverId)?.profile ?? null;
  const [profile, setProfile] = useState(memInitial);
  // Spinner ONLY when there is truly nothing to paint yet (first-ever load
  // with no memory entry). Tab switches with a warm cache never load.
  const [loading, setLoading] = useState(memInitial == null);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  const haveProfileRef = useRef(memInitial != null);
  useEffect(() => {
    haveProfileRef.current = profile != null;
  }, [profile]);

  const load = useCallback(async (opts) => {
    const force = opts === true || opts?.force === true;
    if (!driverId) {
      setLoading(false);
      return;
    }
    const key = String(driverId);

    // 1. Memory-first: paint synchronously so nav never flickers.
    const mem = memByDriver.get(key);
    if (mem?.profile != null) setProfile(mem.profile);
    const fresh =
      mem?.profile != null &&
      Number.isFinite(mem.fetchedAt) &&
      Date.now() - mem.fetchedAt < DRIVER_PROFILE_TTL_MS;
    // Fresh cache + not forced = zero network. This is what stops the
    // reload-on-every-tab-switch.
    if (!force && fresh) {
      setLoading(false);
      return;
    }
    // Share one network call when several Profile screens mount together.
    if (!force && flightByDriver.has(key)) {
      try {
        const shared = await flightByDriver.get(key);
        if (shared != null) setProfile(shared);
      } catch {
        // The owner of the flight reports the error; followers stay silent.
      } finally {
        setLoading(false);
      }
      return;
    }

    // 2. AsyncStorage second (cold start / fresh JS reload): paint the
    // last-good profile before the network answers. Skipped when memory
    // already painted — no need to hit the bridge on every tab switch.
    let painted = mem?.profile != null;
    if (!painted) {
      try {
        const entry = await getCached(key, CACHE_KEYS.DRIVER_ME);
        if (entry?.data != null) {
          setProfile(entry.data);
          // Seed memory so sibling screens mounting right after also skip
          // the bridge read; fetchedAt 0 = "needs one live revalidate".
          if (!memByDriver.has(key)) {
            memByDriver.set(key, { profile: entry.data, fetchedAt: 0 });
          }
          painted = true;
        }
      } catch {
        // Fail-open: fall through to the live fetch.
      }
    }
    // Background revalidate when something is already on screen: keep
    // loading false so the UI never flashes a spinner on nav.
    if (painted) setLoading(false);

    // 3. Live revalidate + cache write (single-flight per driver).
    const flight = (async () => {
      const me = await api.get("/api/driver/me");
      setProfile(me);
      if (me != null) {
        memByDriver.set(key, { profile: me, fetchedAt: Date.now() });
        await setCached(key, CACHE_KEYS.DRIVER_ME, me);
      }
      return me;
    })();
    if (!force) flightByDriver.set(key, flight);
    try {
      await flight;
    } catch (e) {
      // 4. Offline keeps the cached profile. Only the never-synced case
      // (nothing to render) surfaces as an error.
      if (!haveProfileRef.current && !painted) onErrorRef.current?.(e);
    } finally {
      if (!force) flightByDriver.delete(key);
      setLoading(false);
    }
  }, [driverId]);

  useEffect(() => {
    // Deferred one tick: mount-fetch semantics without a sync setState in the
    // effect body (same idiom the screens used before this hook existed).
    // clearTimeout is the guard that matters: a fast back-navigation cancels
    // the deferred load before it starts. Once `load()` is in flight its state
    // writes land on an unmounted tree, which React 18+ makes a no-op.
    const t = setTimeout(() => {
      load();
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  // Forced refresh — used after phone/photo edits that change /driver/me.
  const reload = useCallback(() => load({ force: true }), [load]);

  return { profile, loading, reload: reload };
}
