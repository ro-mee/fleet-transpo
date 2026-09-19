import { requirePermission, handleError, AuthError } from '@/lib/api/utils';
import { loadRequest } from '@/services/reservation-lifecycle.service';
import { verifyEvidenceRef, EVIDENCE_TITLES, MANAGING_MODULE, ACTIVE_EVIDENCE_TYPES, projectEvidenceFacts } from '@/lib/dispatch/evidence-contract';
import { resolveEvidence } from '@/services/evidence-resolve.service';
import { query } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';

// Phase B1 — read-only evidence endpoint for the Evidence Drawer.
// GET-only by design: no mutation handlers exist here. The signed proof ref
// binds reservation + pair + type + record, so arbitrary record browsing is
// impossible. Scope is re-verified on every fetch; expired/cross-request
// refs are rejected. comparison + trail stay INACTIVE until B4/B5.
export async function GET(req, { params }) {
  try {
    const session = await requirePermission(req, 'reservations', 'read');
    await requirePermission(req, 'reservations', 'recommend');
    const limit = await rateLimit(`copilot-evidence:${session?.user?.employeeId ?? session?.user?.email}`, { limit: 30, windowMs: 60_000 });
    if (!limit.allowed) throw new AuthError('Too many evidence requests. Please wait a minute and try again.', 429);
    const { id } = await params;
    const url = new URL(req.url);
    const ref = url.searchParams.get('ref');
    if (!ref) throw new AuthError('Provide a server-issued evidence reference.', 400);
    let refData;
    try {
      refData = verifyEvidenceRef(ref, { requestId: Number(id) });
    } catch (e) {
      if (e?.code === 'INACTIVE') throw new AuthError('This evidence type is not available yet.', 404);
      if (e?.code === 'EXPIRED') throw new AuthError('This evidence reference expired. Ask Copilot again for fresh evidence.', 410);
      throw new AuthError('This evidence reference is invalid.', 403);
    }
    if (!ACTIVE_EVIDENCE_TYPES.includes(refData.proofType)) throw new AuthError('This evidence type is not available yet.', 404);
    const request = await loadRequest(id);
    if (!request) throw new AuthError('Reservation not found.', 404);
    let facts;
    try {
      facts = await resolveEvidence(query, refData, {
        requestId: request.request_id,
        requestRow: request,
        pickupAt: request.pickup_datetime,
        endAt: request.scheduled_arrival ?? null,
        bookingDate: request.pickup_datetime,
        passengerCount: request.passenger_count,
        pickupDate: request.pickup_datetime,
      });
    } catch (e) {
      if (e?.code === 'INACTIVE') throw new AuthError('This evidence type is not available yet.', 404);
      // A compliance ref minted before the subject field existed cannot say which
      // record it covers, so it is refused rather than answered against a guess.
      // Refs live 15 minutes, so this clears itself on the next Copilot run.
      if (e?.code === 'UNSCOPED') throw new AuthError('This evidence is out of date. Ask Copilot again for fresh evidence.', 404);
      throw new AuthError('Evidence is currently unavailable.', 404);
    }
    return Response.json({
      type: refData.proofType,
      title: EVIDENCE_TITLES[refData.proofType],
      managingModule: MANAGING_MODULE[refData.proofType],
      readOnly: true,
      facts: projectEvidenceFacts(refData.proofType, facts),
      requestId: request.request_id,
      horizon: request.pickup_datetime,
      checkedAt: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return handleError(error); }
}
