/**
 * Pre-trip inspection, tutorial mode.
 *
 * The tour's "Quick Pass All" shortcut exists to carry a driver through the
 * checklist without answering seven items by hand, but it must NOT produce a
 * clean sheet. Two tips in the tour depend on a FAIL:
 *
 *   - `pretrip_remarks` targets `inspection.remarks`, and that target is mounted
 *     only by a FAILED item. With every item passing there is nothing to anchor
 *     the tip to, so the tour skipped the whole remarks step and the driver was
 *     never shown how a failed check is described.
 *   - `setStatus` is the only path that emits `notifyInteraction(
 *     "inspection.pass_fail")` and triggers `pretrip_remarks`. Writing the
 *     statuses in one batch bypassed it, so the FAIL branch could never fire.
 *
 * Hence exactly one item is deliberately failed, with a remark already in place.
 * The remark is required rather than cosmetic: `handleSubmit` refuses to submit
 * any FAIL without one, and the tour would otherwise strand at the last step on
 * a "Remarks Required" alert with no tooltip explaining it.
 *
 * The values here are the same `PASS` / `FAIL` strings the checklist buttons
 * write. Per-item display labels (e.g. `NO LIGHTS` for the dashboard item) are a
 * property of the checklist, not of the status, and are unaffected.
 */

/** The one item the tutorial fails, so the remarks tip has something to point at. */
export const QUICK_PASS_FAILED_ID = "tires";

/**
 * The remark seeded for {@link QUICK_PASS_FAILED_ID}. Plausible and specific, so
 * it reads like a real finding in the demo rather than a placeholder.
 */
export const QUICK_PASS_FAIL_REMARK =
  "Low tire pressure on the front left — needs air before departure.";

/** The two states a checklist item can hold. */
export const CHECKLIST_PASS = "PASS";
export const CHECKLIST_FAIL = "FAIL";

/**
 * Builds the status map "Quick Pass All" writes: every item passed, except the
 * one item the tutorial fails.
 *
 * @param {Array<{id: string}>} items - The checklist, in display order.
 * @param {string} [failedId] - Item to fail. Defaults to the tour's item; passed
 *   explicitly by tests so the helper does not have to be re-derived if the tour
 *   changes which item it fails.
 * @returns {Record<string, string>} item id -> `PASS` | `FAIL`
 */
export function buildQuickPassStatuses(items = [], failedId = QUICK_PASS_FAILED_ID) {
  return items.reduce((acc, item) => {
    acc[item.id] = item.id === failedId ? CHECKLIST_FAIL : CHECKLIST_PASS;
    return acc;
  }, {});
}
