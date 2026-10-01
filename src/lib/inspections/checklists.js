// Inspection checklists — ONE server-side definition of what each inspection
// type requires, and the only place the rule is enforced.
//
// Three types share the vehicleinspection table:
//   "Pre-Shift"  — the full 5-point vehicle safety baseline, once daily before duty.
//   "Pre-Trip"   — trip-scoped readiness: brakes/tires safety, passenger check, and cabin acknowledgment.
//   "Post-Shift" — the End Duty report: one question and free text, no items.
//
// Pre-Shift covers 5 roadworthiness checks (sounds, lights, dashboard, steering, brakes_tires);
// any failure fails the baseline and blocks Start Duty.
//
// Pre-Trip confirms brakes/tires (hard gate blocking trip departure), passenger belongings check
// (non-blocking finding), and cabin ready acknowledgment.
//
// Post-Shift is validated by validatePostShift.
//
// The mobile app mirrors this file at mobile/lib/inspection-checklist.js
// (mobile cannot import from src/) — the item ids must stay in step, because
// the API rejects any item_id outside the type's set.

export const INSPECTION_TYPES = ["Pre-Shift", "Pre-Trip", "Post-Shift"];

// The idempotency key every inspection-shaped submission carries, matching the
// partial unique index uq_vehicleinspection_driver_submission. Shared by the
// inspections and duty routes so the two cannot drift apart: a retried
// submission is expected rather than exotic, and the End Duty one is filed from
// a depot with one bar of signal.
export const CLIENT_SUBMISSION_ID_RE = /^[0-9a-z-]{16,64}$/i;

// The types that carry an item checklist. Post-Shift is not one, which is what
// lets itemsForType's null mean exactly one thing — "no set for this type" —
// instead of being ambiguous between "none" and "unknown".
export function isChecklistType(type) {
  return type === "Pre-Shift" || type === "Pre-Trip";
}

export const PRE_SHIFT_ITEMS = [
  "sounds", "lights", "dashboard", "steering", "brakes_tires",
];

export const PRE_TRIP_ITEMS = ["brakes_tires", "passenger_items", "cabin_ready"];

export const PRE_SHIFT_BLOCKING_ITEMS = [
  "sounds", "lights", "dashboard", "steering", "brakes_tires",
];

export const PRE_TRIP_BLOCKING_ITEMS = ["brakes_tires"];

export const NON_BLOCKING_PRE_TRIP_ITEMS = ["passenger_items"];

export const REQUIRED_PRE_TRIP_ACKNOWLEDGMENTS = ["cabin_ready"];

// All blocking item IDs across inspections that represent severe safety issues.
export const CRITICAL_ITEM_IDS = [
  "sounds", "lights", "dashboard", "steering", "brakes_tires",
];

export function blockingItemIdsForType(type) {
  if (type === "Pre-Shift") return PRE_SHIFT_BLOCKING_ITEMS;
  if (type === "Pre-Trip") return PRE_TRIP_BLOCKING_ITEMS;
  return [];
}

export function itemsForType(type) {
  if (type === "Pre-Shift") return PRE_SHIFT_ITEMS;
  if (type === "Pre-Trip") return PRE_TRIP_ITEMS;
  return null;
}

/**
 * The failed items of a stored checklist, as { label, remarks }.
 *
 * The stored entry is { item_id, label, status, remarks } — the inspections
 * route defaults `label` to item_id (route.js:130-135), so a human label is
 * normally present, and the fallback is here for rows written before that
 * default rather than to paper over a missing field.
 *
 * Returns [] for a checklist that is null or not an array. That is the ORDINARY
 * case for Post-Shift, which stores NULL by construction (standby.service.js:109)
 * — not an error, and not something every caller should have to guard for.
 *
 * One derivation, used by the problem queue AND by the work-order description
 * (task 12): two implementations would drift the first time the stored shape
 * changed, and "what the driver reported" would then read differently
 * depending on which page asked.
 */
export function failedItemsFrom(checklist) {
  const items = Array.isArray(checklist) ? checklist : [];
  return items
    .filter((item) => item?.status === "FAIL")
    .map((item) => ({
      label: item.label || item.item_id,
      remarks: String(item.remarks ?? "").trim(),
    }));
}

/**
 * Validate an inspection payload for its declared type.
 *
 * Returns { ok: true } or { ok: false, error } — the caller maps `error`
 * straight into a 400. Every failure is a 400 (bad request), never a 404: the
 * caller resolves ownership first so a rejected payload cannot confirm that
 * someone else's trip exists.
 *
 * Count + set-membership + no-duplicates together mean every expected id is
 * present exactly once, without needing a separate "missing item" check.
 */
export function validateChecklist(type, items) {
  if (!INSPECTION_TYPES.includes(type)) {
    return { ok: false, error: "inspection_type must be Pre-Shift, Pre-Trip or Post-Shift" };
  }
  if (!isChecklistType(type)) {
    // Reached only for Post-Shift — the unknown-type case returned above. Says
    // so plainly rather than reporting an item-count mismatch against a set
    // that was never meant to exist.
    return { ok: false, error: "Post-Shift carries no checklist — send a report instead" };
  }
  const expected = itemsForType(type);
  if (!Array.isArray(items) || !items.length) {
    return { ok: false, error: "items is required and must not be empty" };
  }
  if (items.length !== expected.length) {
    return { ok: false, error: `exactly ${expected.length} inspection items are required for ${type}` };
  }
  const validIds = new Set(expected);
  const seen = new Set();
  const validStatuses = new Set(["PASS", "FAIL"]);
  for (const item of items) {
    if (!validIds.has(item?.item_id) || seen.has(item.item_id) || !validStatuses.has(item?.status)) {
      return { ok: false, error: "each item needs item_id and a PASS|FAIL status" };
    }
    if (type === "Pre-Trip" && item.item_id === "cabin_ready" && item.status !== "PASS") {
      return { ok: false, error: "cabin_ready must be acknowledged before completing Pre-Trip" };
    }
    if (typeof item.remarks !== "undefined" && String(item.remarks).length > 1000) {
      return { ok: false, error: "inspection remarks must be 1000 characters or fewer" };
    }
    if (item.status === "FAIL" && !String(item.remarks || "").trim()) {
      return { ok: false, error: `remarks are required for failed item '${item.item_id}'` };
    }
    seen.add(item.item_id);
  }
  return { ok: true };
}

// Matches the per-item remarks cap in validateChecklist: one number for "how
// long an inspection note may be", not two that drift.
export const POST_SHIFT_FINDINGS_MAX = 1000;

/**
 * Validate a Post-Shift (End Duty) report.
 *
 * The driver answers exactly one of two ways, and the payload has to say which:
 * `nothing_unusual: true`, or a non-empty `findings` describing what was
 * noticed. Both or neither is a 400.
 *
 * The two outcomes must be distinguishable in the stored row, because one files
 * a maintenance work order and the other must not. A sentinel string inside
 * `findings` ("N/A", "wala") would have made that a matter of text matching —
 * and a driver typing the same words by hand would have been silently read as
 * "nothing to report", which is the one wrong answer here that has a vehicle
 * still on the road behind it.
 *
 * `reported` and the trimmed `findings` are returned so the caller does not
 * re-derive either: the trimming rule lives in one place.
 */
export function validatePostShift({ nothing_unusual, findings } = {}) {
  // Strict identity on purpose. "false" is a truthy string, so a truthiness
  // test would read a stringified false as "nothing unusual" and quietly skip
  // the maintenance order for a reported fault.
  const clean = nothing_unusual === true;
  const text = String(findings ?? "").trim();

  if (clean && text) {
    return { ok: false, error: "report either nothing_unusual or findings, not both" };
  }
  if (!clean && !text) {
    return { ok: false, error: "a report is required — set nothing_unusual, or describe what you noticed" };
  }
  if (text.length > POST_SHIFT_FINDINGS_MAX) {
    return { ok: false, error: `findings must be ${POST_SHIFT_FINDINGS_MAX} characters or fewer` };
  }
  return { ok: true, reported: !clean, findings: text || null };
}
