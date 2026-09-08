/**
 * Offline Read Mode view-state logic — pure, unit-tested.
 *
 * Single-source decider + multi-source combiner behind the 4-state offline
 * UX rolled across the cached driver screens. State logic that lives inline
 * in screens never gets unit-tested (the resolveDriverId camelCase lesson) —
 * it lives here instead.
 *
 * Locked rules:
 * - `unstable` connectivity is treated as ONLINE by callers (the global amber
 *   banner speaks for degraded connections); only status === "offline" turns
 *   the `offline` input true.
 * - Confirmed-empty keys off syncedAt, NOT item count: setCached stamps
 *   syncedAt even for [] payloads, so syncedAt != null honestly means "the
 *   server answered this source at some point".
 * - Filter-empty (data exists, the active filter yields nothing) is a screen
 *   concern, decided before this helper is consulted — itemCount is always
 *   the SOURCE's count, never the filtered count.
 * - empty-unconfirmed means the device is ONLINE and the fetch never
 *   confirmed anything: copy must say "couldn't be confirmed / retry",
 *   never "Connect once…" — the device IS connected.
 * - empty-confirmed is still a snapshot: offline copy should read "when last
 *   synced", online copy can read as current.
 *
 * States:
 *   data              — items exist; showSyncNote when offline (saved-data note)
 *   empty-confirmed   — server answered with zero; showSyncNote when offline
 *                       (Saved chip next to "when last synced" copy)
 *   never-synced      — offline and this source was never server-answered
 *   empty-unconfirmed — ONLINE and this source was never server-answered
 *   partial           — multi-source only: some sources answered, some not
 */

/**
 * Decide the view state for ONE cache source.
 * @param {{offline?: boolean, syncedAt?: number|null, itemCount?: number}} input
 * @returns {{state: string, confirmed: boolean, showSyncNote: boolean}}
 */
export function offlineViewState({ offline, syncedAt, itemCount } = {}) {
  const isOffline = offline === true;
  const confirmed = syncedAt != null;
  if (Number(itemCount) > 0) {
    return { state: "data", confirmed, showSyncNote: isOffline };
  }
  if (confirmed) {
    return { state: "empty-confirmed", confirmed: true, showSyncNote: isOffline };
  }
  if (isOffline) {
    return { state: "never-synced", confirmed: false, showSyncNote: false };
  }
  return { state: "empty-unconfirmed", confirmed: false, showSyncNote: false };
}

/**
 * Compose per-source states for a multi-source screen. A screen is only
 * CONFIRMED empty when EVERY source was server-answered — one unanswered
 * source keeps the claim partial (it might hold items we cannot see).
 *
 * @param {boolean} offline
 * @param {Array<{syncedAt?: number|null, itemCount?: number}>} sources
 * @returns {{state: string, confirmedCount: number, totalSources: number, showSyncNote: boolean}}
 */
export function combineOfflineSources(offline, sources = []) {
  const list = Array.isArray(sources) ? sources : [];
  const confirmedCount = list.filter((s) => s?.syncedAt != null).length;
  const totalSources = list.length;
  const isOffline = offline === true;
  if (list.some((s) => Number(s?.itemCount) > 0)) {
    return { state: "data", confirmedCount, totalSources, showSyncNote: isOffline };
  }
  if (totalSources > 0 && confirmedCount === totalSources) {
    return { state: "empty-confirmed", confirmedCount, totalSources, showSyncNote: isOffline };
  }
  if (confirmedCount > 0) {
    return { state: "partial", confirmedCount, totalSources, showSyncNote: isOffline };
  }
  return {
    state: isOffline ? "never-synced" : "empty-unconfirmed",
    confirmedCount: 0,
    totalSources,
    showSyncNote: false,
  };
}
