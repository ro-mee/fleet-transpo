// The response contract of POST /api/integration/transport-requests, read for
// humans.
//
// Deliberately its OWN module, with no imports: the injector page is a client
// component, and `@/lib/integration/ingest.js` (which produces this shape) pulls
// in `@/lib/db`, `pg` and the Supabase client — all server-only. The shape lives
// here so the reader and the writer cannot drift the way they did when the page
// read `res.id` and `res.created` off a route that sends neither.

/**
 * @param {object} response the route's JSON body: the created (or already
 *   on-file) request row, plus `idempotent: true` when nothing was inserted
 * @returns {{ ok: boolean, idempotent: boolean, label: string, message: string }}
 */
export function describeIngestOutcome(response) {
  const requestId = response?.request_id ?? null;
  const reservationNumber = response?.reservation_number ?? null;
  const idempotent = response?.idempotent === true;
  // Prefer the guest-facing reference, fall back to the numeric id, and never
  // render "undefined" — an unidentified success still reads as a success.
  const label = reservationNumber || (requestId ? `#${requestId}` : "the request");

  return {
    ok: Boolean(requestId || reservationNumber),
    idempotent,
    label,
    message: idempotent
      ? `Already on file — ${label} was returned unchanged (no duplicate created).`
      : `Created transport request ${label}`,
  };
}
