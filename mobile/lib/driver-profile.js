/** Shared display cache for /api/driver/me. Cached data never authorizes work. */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import { resolveDriverId, getCached, setCached, CACHE_KEYS } from "./offline-cache";
import { captureCargoSession, isCurrentCargoSession } from "./cargo-sync";

export const DRIVER_PROFILE_TTL_MS = 5 * 60 * 1000;
const memByDriver = new Map();
const flightByDriver = new Map();
export function __resetDriverProfileCache() {
  memByDriver.clear();
  flightByDriver.clear();
}

/**
 * serverConfirmed means this profile was read from the server in the current
 * login. Operational callers must also confirm their trips and connectivity.
 * reload() forces a live read; cached profiles remain useful on failure.
 */
export function useDriverProfile({ onError } = {}) {
  const { user } = useAuth();
  const driverId = resolveDriverId(user);
  const key = driverId == null ? null : String(driverId);
  const initial = memByDriver.get(key);
  const [entry, setEntry] = useState(initial ? { ...initial, key } : null);
  const [loading, setLoading] = useState(initial?.profile == null);
  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  const profile = entry?.key === key ? entry.profile : initial?.profile ?? null;
  const serverConfirmed = entry?.key === key && entry?.profile != null && isCurrentCargoSession(entry.session);

  const load = useCallback(async (opts) => {
    const force = opts === true || opts?.force === true;
    const session = captureCargoSession(user?.employeeId);
    if (!key || !session) return;
    const current = () => isCurrentCargoSession(session);
    const mem = memByDriver.get(key);
    let painted = mem?.profile != null;
    if (painted) setEntry({ ...mem, key });
    if (!force && painted && isCurrentCargoSession(mem.session) && Date.now() - mem.fetchedAt < DRIVER_PROFILE_TTL_MS) {
      setLoading(false);
      return;
    }
    if (!painted) {
      const cached = await getCached(key, CACHE_KEYS.DRIVER_ME);
      if (!current()) return;
      if (cached?.data != null) {
        const saved = { profile: cached.data, fetchedAt: 0, session: null };
        setEntry({ ...saved, key });
        memByDriver.set(key, saved);
        painted = true;
      }
    }
    if (painted) setLoading(false);
    const existing = flightByDriver.get(key);
    const flight = !force && isCurrentCargoSession(existing?.session) ? existing.promise : (async () => {
      const me = await api.get("/api/driver/me");
      if (!current()) return null;
      const live = { profile: me, fetchedAt: Date.now(), session: me ? session : null };
      memByDriver.set(key, live);
      if (me != null) await setCached(key, CACHE_KEYS.DRIVER_ME, me);
      return live;
    })();
    flightByDriver.set(key, { session, promise: flight });
    try {
      const live = await flight;
      if (current() && live) setEntry({ ...live, key });
    } catch (error) {
      if (!current()) return;
      const saved = memByDriver.get(key);
      if (saved) {
        const unconfirmed = { ...saved, session: null };
        memByDriver.set(key, unconfirmed);
        setEntry({ ...unconfirmed, key });
      }
      if (!painted) onErrorRef.current?.(error);
    } finally {
      if (flightByDriver.get(key)?.promise === flight) flightByDriver.delete(key);
      if (current()) setLoading(false);
    }
  }, [key, user?.employeeId]);

  useEffect(() => {
    const timer = setTimeout(() => { load(); }, 0);
    return () => clearTimeout(timer);
  }, [load]);
  const reload = useCallback(() => load({ force: true }), [load]);
  return { profile, loading, reload, serverConfirmed };
}
