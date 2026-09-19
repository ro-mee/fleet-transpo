import { requirePermission, parseBody, handleError, AuthError } from '@/lib/api/utils';
import { findReturnMatches } from '@/services/dispatch-return.service';
import { rateLimit } from '@/lib/rate-limit';

// Phase 4B — on-demand return-booking search for an assigned/scheduled or
// active outbound trip. Commit happens only via the existing guarded
// assignment flow in the follow-on reservation's own conversation.
export async function POST(req, { params }) {
  try {
    const session = await requirePermission(req, 'reservations', 'read');
    await requirePermission(req, 'reservations', 'recommend');
    const limit = await rateLimit(`copilot-return:${session?.user?.employeeId ?? session?.user?.email}`, { limit: 5, windowMs: 60_000 });
    if (!limit.allowed) throw new AuthError('Too many return searches. Please wait a minute and try again.', 429);
    const body = await parseBody(req).catch(() => ({}));
    const { id } = await params;
    const vehicleId = Number(body?.vehicleId), driverId = Number(body?.driverId);
    if (![vehicleId, driverId].every(v => Number.isSafeInteger(v) && v > 0)) throw new AuthError('Provide the outbound vehicleId and driverId.', 400);
    const result = await findReturnMatches({ outboundId: Number(id), vehicleId, driverId, timeWindowHours: body?.timeWindowHours, candidateCap: body?.candidateCap });
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return handleError(error); }
}
