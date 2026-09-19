import { requirePermission, parseBody, handleError, AuthError } from '@/lib/api/utils';
import { loadRequest } from '@/services/reservation-lifecycle.service';
import { runReservationSimulation } from '@/services/dispatch-simulate.service';
import { rateLimit } from '@/lib/rate-limit';

// Phase 3 — read-only what-if simulation. Allowlisted scenario only:
// proposed pickup date/time and passenger count. The real reservation is
// never written; no assignment token is issued; simulated options are not
// assignable (canChoose is stripped).
export async function POST(req, { params }) {
  try {
    const session = await requirePermission(req, 'reservations', 'read');
    await requirePermission(req, 'reservations', 'recommend');
    const limit = await rateLimit(`copilot-sim:${session?.user?.employeeId ?? session?.user?.email}`, { limit: 10, windowMs: 60_000 });
    if (!limit.allowed) throw new AuthError('Too many simulations. Please wait a minute and try again.', 429);
    const body = await parseBody(req);
    const { id } = await params;
    const request = await loadRequest(id);
    if (!request) throw new AuthError('Reservation not found.', 404);
    try {
      const result = await runReservationSimulation(request, body?.scenario ?? {});
      return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (e) {
      throw new AuthError(e.message, 400);
    }
  } catch (error) { return handleError(error); }
}
