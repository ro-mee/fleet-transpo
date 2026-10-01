// Pure smart-filter defaults for tabbed operational surfaces.
//
// Land where the work is: action tabs when counts show outstanding work,
// otherwise a non-empty overview tab — archive views never greet. Loading and
// error states always resolve to the action tab (skeleton-safe, no flicker).
// User picks override these returns at the call site; polls must never yank
// a manual pick (see the fetch-tab-first + deferred-steer pattern in
// Capstone/11 - Memory/Useful Code Patterns.md).
//
// No React, no DB — unit-tested in smart-default-tab.test.js.

/**
 * Fuel registry filter default.
 * @param {object} counts { total, pending } from the records endpoint
 * @param {object} opts { ready } false while loading or on error
 * @returns {"Pending"|"all"}
 */
export function smartFuelTab(counts, { ready }) {
  if (!ready) return "Pending";
  const total = Number(counts?.total) || 0;
  const pending = Number(counts?.pending) || 0;
  if (total > 0 && !(pending > 0)) return "all";
  return "Pending";
}

const QUEUE_CHAIN = ["today", "upcoming", "assigned", "inProgress"];

/**
 * Reservation queue tab default — first non-empty tab in work order.
 * @param {object} counts per-tab counts from the queue endpoint
 * @param {object} opts { ready } false while loading or on error
 * @returns tab id; never "completed" or "cancelled"
 */
export function smartQueueTab(counts, { ready }) {
  if (!ready) return "today";
  for (const id of QUEUE_CHAIN) {
    if (Number(counts?.[id]) > 0) return id;
  }
  return "today";
}

/** The tab the queue fetches before counts exist (skeleton-safe, never archive). */
export const QUEUE_FALLBACK_TAB = "today";

/**
 * Resolve the queue's tab state so the highlighted tab, the fetched rows and the
 * badges all describe ONE query result.
 *
 * The bug this replaces: the highlight was derived from `counts` (the tab we are
 * about to steer to) while the query still fetched the fallback tab, so for the
 * length of a fetch one tab was highlighted over another tab's rows — and the
 * badges rendered `0` until the first response landed, which reads as "no work"
 * rather than "not loaded yet".
 *
 * `counts` only exist AFTER the query that needs `fetchTab` has run, so the page
 * necessarily computes `fetchTab` once on its own (`tabOverride ??
 * QUEUE_FALLBACK_TAB`) to build the query key. This function is the authority on
 * what that value is, and on everything downstream of it.
 *
 * @param {object}      params
 * @param {string|null} params.tabOverride manual pick, or null while steering
 * @param {object}      params.counts      per-tab counts from the queue endpoint
 * @param {boolean}     params.countsReady false while the first fetch is in flight
 * @returns {{ fetchTab: string, activeTab: string, steerTo: string|null }}
 *   `fetchTab` is baked into the query key; `activeTab` is what may be
 *   highlighted (always the fetched tab); `steerTo` is the deferred smart
 *   default the caller should apply once — null when the user has picked, when
 *   counts are not in yet, or when the default is already the fetched tab.
 */
export function resolveQueueTabView({ tabOverride = null, counts = null, countsReady = false } = {}) {
  const fetchTab = tabOverride ?? QUEUE_FALLBACK_TAB;
  // A manual pick is never yanked by a poll, and the highlighted tab is always
  // the tab whose rows are on screen.
  const activeTab = fetchTab;
  const smartTab = smartQueueTab(counts, { ready: countsReady });
  const steerTo = !tabOverride && countsReady && smartTab !== activeTab ? smartTab : null;
  return { fetchTab, activeTab, steerTo };
}

/**
 * Per-tab badge values. `null` means "not loaded yet" and must render as a
 * loading affordance, never as `0` — a zero count claims the queue is empty.
 *
 * @param {string[]} tabs        tab ids, in display order
 * @param {object}   counts      per-tab counts from the queue endpoint
 * @param {boolean}  countsReady false while the first fetch is in flight
 * @returns {Record<string, number|null>}
 */
export function queueTabBadges(tabs, counts, countsReady) {
  const badges = {};
  for (const id of tabs || []) {
    badges[id] = countsReady ? Number(counts?.[id]) || 0 : null;
  }
  return badges;
}
