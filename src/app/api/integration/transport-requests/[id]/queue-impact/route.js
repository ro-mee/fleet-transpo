import { requirePermission, parseBody, handleError, AuthError } from '@/lib/api/utils';
import { buildDispatchPlan } from '@/services/dispatch-plan.service';
import { readPlanRevision } from '@/services/dispatch-plan-evidence.service';
import { dispatchPlanWindow } from '@/lib/dispatch/plan-window';
import { compareQueueImpact } from '@/lib/dispatch/queue-impact';
import { rateLimit } from '@/lib/rate-limit';

// Phase 4 — explain downstream queue impact. Same queue, candidate pinned to
// A vs B, consistent revisions/policy. No assignment is made; unassigned
// proposals never become commitments. A verified queue token alone cannot
// prove this comparison — both runs are fresh within one budget.
export async function POST(req, { params }) {
  try {
    const session = await requirePermission(req, 'reservations', 'read');
    await requirePermission(req, 'reservations', 'recommend');
    const limit = await rateLimit(`copilot-impact:${session?.user?.employeeId ?? session?.user?.email}`, { limit: 5, windowMs: 60_000 });
    if (!limit.allowed) throw new AuthError('Too many impact checks. Please wait a minute and try again.', 429);
    const body = await parseBody(req);
    const { id } = await params;
    const requestId = Number(id);
    if (!Number.isSafeInteger(requestId) || requestId <= 0) throw new AuthError('Invalid reservation.', 400);
    try { dispatchPlanWindow(body?.date); } catch { throw new AuthError('Provide a valid service date.', 400); }
    for (const key of ['pairA', 'pairB']) {
      const p = body?.[key];
      if (!p || ![p.vehicleId, p.driverId].every(v => Number.isSafeInteger(v) && v > 0)) throw new AuthError('Provide pairA and pairB with valid vehicle and driver IDs.', 400);
    }
    const revision = await readPlanRevision();
    const routeMemo = new Map();
    const half = Date.now() + 12_000;
    const [runA, runB] = await Promise.all([
      buildDispatchPlan({ date: body.date, deadline: half, routeMemo, selection: { requestId, vehicleId: body.pairA.vehicleId, driverId: body.pairA.driverId } }),
      buildDispatchPlan({ date: body.date, deadline: half, routeMemo, selection: { requestId, vehicleId: body.pairB.vehicleId, driverId: body.pairB.driverId } }),
    ]);
    if (await readPlanRevision() !== revision) throw new AuthError('Fleet evidence changed during comparison. Try again.', 409, 'STALE_DISPATCH_PLAN');
    const impact = compareQueueImpact(runA, runB, { requestId });
    return Response.json({ ...impact, message: 'Within the evaluated queue.' }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return handleError(error); }
}
