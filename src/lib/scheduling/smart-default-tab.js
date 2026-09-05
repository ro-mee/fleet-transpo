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
