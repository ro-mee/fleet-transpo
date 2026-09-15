import { requirePermission, handleError, parseBody, AuthError } from '@/lib/api/utils';
import { buildDispatchPlan } from '@/services/dispatch-plan.service';
import { dispatchPlanWindow } from '@/lib/dispatch/plan-window';
import { readPlanRevision, issuePlanToken, verifyPlanToken } from '@/services/dispatch-plan-evidence.service';

export async function POST(req) {
  try {
    await requirePermission(req,'reservations','read');
    await requirePermission(req,'reservations','recommend');
    const body = req.headers?.get('content-type')?.includes('application/json') ? await parseBody(req) : {};
    try { dispatchPlanWindow(body?.date); } catch(error) { throw new AuthError(error.message,400); }
    let baseline = null;
    if (body?.selection != null) {
      if (!['requestId','vehicleId','driverId'].every(key => Number.isSafeInteger(body.selection[key]) && body.selection[key] > 0))
        throw new AuthError('Choose a valid request, vehicle and driver.',400);
      baseline = await verifyPlanToken(body.basePlanToken);
      if (baseline.version !== 2 || baseline.window?.date !== body.date) throw new AuthError('Analyze this service date again before choosing.',409);
    }
    const revision = await readPlanRevision();
    const result=await buildDispatchPlan({date:body?.date,selection:body?.selection ?? null});
    if (baseline) {
      const selected = result.proposals.find(p => Number(p.requestId) === body.selection.requestId);
      const preserved = baseline.coverage.every(id => id === body.selection.requestId || result.proposals.some(p => Number(p.requestId) === id && p.outcome === 'VERIFIED'));
      if (!result.analysisComplete || !preserved || !selected?.pair || selected.dependsOnRequestIds?.length ||
        Number(selected.pair.vehicle_id) !== body.selection.vehicleId || Number(selected.pair.driver_id) !== body.selection.driverId ||
        !(selected.outcome === 'VERIFIED' || selected.confirmationMode === 'manual'))
        throw new AuthError('This choice could not be verified without affecting queue coverage. Choose another option or recheck the service date.',409,'CHOICE_NOT_VERIFIED');
      result.selectedPair = body.selection;
      result.changedProposals = baseline.choices.filter(([r,v,d]) => result.proposals.some(p => Number(p.requestId) === r && (p.pair?.vehicle_id !== v || p.pair?.driver_id !== d))).map(([r]) => r);
    }
    if (await readPlanRevision() !== revision || new Date(result.expiresAt).getTime() <= Date.now()) {
      throw new AuthError('Fleet evidence changed during analysis. Analyze the queue again.',409,'STALE_DISPATCH_PLAN');
    }
    const planToken = issuePlanToken({ revision, proposals: result.proposals, expiresAt: result.expiresAt, window:result.window });
    return Response.json({...result,planToken},{headers:{'Cache-Control':'private, no-store'}});
  } catch(error) { return handleError(error); }
}

// Validate without generating another plan or persisting any operational state.
export async function PATCH(req) {
  try {
    await requirePermission(req,'reservations','read');
    await requirePermission(req,'reservations','recommend');
    const body = await parseBody(req);
    const evidence = await verifyPlanToken(body?.planToken);
    return Response.json({ valid: true, expiresAt: evidence.expiresAt, window:evidence.window }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return handleError(error); }
}
