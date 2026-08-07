import { api } from "./api";

/**
 * Driver reference data, fetched once from GET /api/mobile/driver/ref.
 *
 * This is the single source of truth for trip statuses on mobile: which
 * statuses group into pending/active/completed, the tone each status renders
 * as, and the next driver action available from any status. The server owns
 * the state machine (src/lib/scheduling/trip-state.js); the client only
 * renders what this module returns, so the two never drift.
 */

let cache = null;
let inflight = null;

export async function getTripRef(force = false) {
  if (cache && !force) return cache;
  if (!force && inflight) return inflight;

  inflight = (async () => {
    const data = await api.get("/api/mobile/driver/ref");
    cache = data;
    return data;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export async function getTone(status) {
  try {
    const ref = await getTripRef();
    return ref?.tones?.[status] || "neutral";
  } catch {
    return "neutral";
  }
}

export async function getNextStatus(current) {
  try {
    const ref = await getTripRef();
    return ref?.nextStatus?.[current] ?? null;
  } catch {
    return null;
  }
}

export async function getActiveStatuses() {
  const ref = await getTripRef();
  return ref?.statusGroups?.active ?? [];
}

export async function getPendingStatuses() {
  const ref = await getTripRef();
  return ref?.statusGroups?.pending ?? [];
}

export async function getCompletedStatuses() {
  const ref = await getTripRef();
  return ref?.statusGroups?.completed ?? [];
}
