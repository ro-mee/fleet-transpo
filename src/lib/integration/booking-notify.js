// How to describe an outbound Booking hand-off to a human.
//
// Deliberately its own module with no imports: both reservation pages are client
// components, and the service that produces this value pulls in `pg` and the
// Supabase client.
//
// Why this exists: the cancellation toast said "Booking will be notified"
// unconditionally, while `emitTransportStatus` was already telling the caller
// whether the hand-off landed and which gateway answered. In the live
// environment the gateway is the local MOCK, so the message promised an external
// notification that never happened. The rule is the codebase's usual one — say
// what actually occurred, not what was attempted.

/**
 * @param {object|null} bookingNotify `{ delivered, gateway, reason? }` as returned
 *   by emitTransportStatus, or null when no outbound attempt was made.
 * @returns {string} one sentence, safe to append to a toast
 */
export function describeBookingNotify(bookingNotify) {
  if (!bookingNotify) {
    return "No Booking notification was attempted.";
  }
  if (bookingNotify.reason === "no-external-booking-id") {
    // A hand-created local request has nobody on the Booking side to tell.
    return "This request has no Booking reference, so there was no external system to notify.";
  }
  if (bookingNotify.gateway === "mock") {
    // Checked before `delivered`: the mock resolves successfully, and reporting
    // that as a notification would be the exact overclaim this fixes.
    return "The Booking gateway is running in MOCK mode, so nothing left Fleet — check Settings → API before relying on this.";
  }
  if (bookingNotify.delivered) {
    return "Booking was notified.";
  }
  return "The Booking notification failed — it stays queued in the integration log for retry.";
}
