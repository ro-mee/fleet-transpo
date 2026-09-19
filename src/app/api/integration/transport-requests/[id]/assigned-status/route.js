import { requirePermission, handleError, AuthError } from '@/lib/api/utils';
import { loadRequest } from '@/services/reservation-lifecycle.service';
import { evaluateDispatchCandidate } from '@/services/dispatch-radar.service';
import { resolveRequestEstimate } from '@/services/route-resolver.service';
import { evaluateAssignedIssue } from '@/lib/dispatch/assigned-alerts';
import { query } from '@/lib/db';

// Phase 5A — visible-workspace check of the committed pair. Read-only:
// the assignment stays intact while alternatives are reviewed via
// "Check replacement options" (the existing recommendation flow).
export async function GET(req, { params }) {
  try {
    await requirePermission(req, 'reservations', 'read');
    await requirePermission(req, 'reservations', 'recommend');
    const { id } = await params;
    const request = await loadRequest(id);
    if (!request) throw new AuthError('Reservation not found.', 404);
    if (['Cancelled', 'Completed'].includes(request.fleet_status)) {
      return Response.json({ issue: false, reason: 'closed', evaluatedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const { rows } = await query(`SELECT ds.dispatch_id, ds.vehicle_id, ds.driver_id, ds.status FROM dispatchschedules ds
      WHERE ds.request_id=$1 AND ds.deleted_at IS NULL AND ds.status IN ('Scheduled','In Progress','Driver Accepted')
      ORDER BY ds.scheduled_departure DESC LIMIT 1`, [request.request_id]);
    const committed = rows[0];
    if (!committed?.vehicle_id || !committed?.driver_id) {
      return Response.json({ issue: false, reason: 'unassigned', evaluatedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const estimate = await resolveRequestEstimate(request, { query }, { persistRoute: false }).catch(() => null);
    // Same-request evaluation excludes the assignment's own commitment from
    // overlap checks (radar filters its own request_id); this is validation,
    // never a new ranking for dispatch authorization.
    const evidence = await evaluateDispatchCandidate({ request, estimate, vehicleId: Number(committed.vehicle_id), driverId: Number(committed.driver_id), now: new Date() });
    const result = evaluateAssignedIssue({ request, evidence });
    return Response.json({ ...result, committed: { vehicleId: Number(committed.vehicle_id), driverId: Number(committed.driver_id), status: committed.status }, evaluatedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return handleError(error); }
}
