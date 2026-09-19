import { requirePermission, parseBody, handleError, AuthError } from '@/lib/api/utils';
import { loadRequest } from '@/services/reservation-lifecycle.service';
import { prepareDispatchRecommendation } from '@/services/dispatch-recommendation-preparation.service';
import { applyDispatchRadar } from '@/services/dispatch-radar.service';
import { verifyPlanToken } from '@/services/dispatch-plan-evidence.service';
import { executeLlmCompletion } from '@/lib/ai/llm-adapter';
import { conversationEvidence, evidenceSummary, plainChatText, withCoverageDisclosure } from '@/lib/dispatch/conversation';
import { narrationGuards, guardLabels, withGuards } from '@/lib/dispatch/narration-guards';
import { logAiRequest } from '@/lib/ai/logger';
import { buildCopilotSystemInstructions } from '@/lib/dispatch/copilot-prompt';
import { attachEvidenceProofs, attachClearanceProofs, signEvidenceRef, EVIDENCE_TYPES } from '@/lib/dispatch/evidence-contract';
import { buildExplanationSnapshot, signExplanationSnapshot, verifyExplanationSnapshot, diffExplanationSnapshots, summarizeChanges } from '@/lib/dispatch/explanation';
import { classifyCopilotScope, copilotCourtesyReply, detectCopilotIntent, FLEETMATE_SCOPE_REDIRECT, parseSimulationScenario } from '@/lib/dispatch/copilot-intents';
import { runReservationSimulation } from '@/services/dispatch-simulate.service';
import { buildDispatchPlan } from '@/services/dispatch-plan.service';
import { readPlanRevision } from '@/services/dispatch-plan-evidence.service';
import { compareQueueImpact } from '@/lib/dispatch/queue-impact';
import { findReturnMatches } from '@/services/dispatch-return.service';
import { rateLimit } from '@/lib/rate-limit';

// Deterministic evidence-only answers for intent results, used when the
// provider is unavailable. Plain facts, no model prose.
function intentFallback(intent) {
  if (!intent || intent.status === 'not-a-scenario') return null;
  if (intent.type === 'simulate' && intent.status === 'needs-date')
    return `Which date should I simulate?${intent.passengerCount != null ? ` I understood ${intent.passengerCount} passenger(s).` : ''} The reservation itself is unchanged.`;
  if (intent.type === 'simulate' && intent.status === 'ok') {
    const r = intent.result;
    const opts = (r.options ?? []).map(o => `${o.plate ?? `Vehicle #${o.vehicleId}`} / driver #${o.driverId}: ${o.state}.`).join(' ');
    return `Simulation — reservation unchanged. Proposed: ${r.interpreted.pickupLocal ?? 'same time'}${r.interpreted.passengerCount != null ? `, ${r.interpreted.passengerCount} passenger(s)` : ''}. ${opts || 'No simulated options.'}`;
  }
  if (intent.type === 'impact' && intent.status === 'ok') {
    const affected = intent.result.affected ?? [];
    return affected.length
      ? `Within the evaluated queue, choosing differently affects: ${affected.map(a => `request #${a.requestId} (${a.withChoiceA} vs ${a.withChoiceB})`).join('; ')}.`
      : 'Within the evaluated queue, the two choices preserve the same coverage.';
  }
  if (intent.type === 'return' && intent.status === 'ok') {
    const ms = intent.result.matches ?? [];
    return ms.length
      ? `Possible follow-on: ${ms.map(m => `request #${m.requestId}`).join(', ')}. Review each in its own conversation before assigning.`
      : (intent.result.note ?? 'No follow-on booking found within the evaluated scope.');
  }
  return 'That comparison is currently unavailable. The current findings above still stand.';
}

function scopeOnlyResponse(answer) {
  return Response.json({
    answer,
    choiceOptions: [],
    mode: 'scope-only',
    evaluatedAt: null,
    selection: null,
    coverage: null,
    recoveryActions: [],
    pairRecovery: [],
    comparisonProof: null,
    snapshot: null,
    baselineStatus: 'none',
    changes: { changed: false, fingerprint: null, changes: [] },
    intent: null,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(req,{params}) {
  try {
    const session=await requirePermission(req,'reservations','read');
    await requirePermission(req,'reservations','recommend');
    const limit=await rateLimit(`copilot:${session?.user?.employeeId ?? session?.user?.email}`,{limit:10,windowMs:60_000});
    if(!limit.allowed)throw new AuthError('Too many questions. Please wait a minute and try again.',429);
    const body=await parseBody(req);
    if(typeof body?.message!=='string' || !body.message.trim() || body.message.length>1000 ||
      (body.history!=null && (!Array.isArray(body.history) || body.history.length>8 || body.history.some(m=>!['user','assistant'].includes(m?.role)||typeof m.content!=='string'||m.content.length>2000))))
      throw new AuthError('Enter a question of up to 1,000 characters with at most eight recent messages.',400);
    if (body.selectedPair != null &&
      (typeof body.selectedPair !== 'object' || Array.isArray(body.selectedPair) ||
        ![body.selectedPair.vehicleId,body.selectedPair.driverId].every(id=>Number.isSafeInteger(id) && id>0)))
      throw new AuthError('Selected pair must contain valid vehicle and driver IDs.',400);
    if (body.displayedEvaluatedAt != null && (typeof body.displayedEvaluatedAt !== 'string' ||
      body.displayedEvaluatedAt.length>64 || !Number.isFinite(Date.parse(body.displayedEvaluatedAt))))
      throw new AuthError('Displayed evaluation time must be a valid timestamp.',400);
    if (body.displayedOptions != null && (!Array.isArray(body.displayedOptions) || body.displayedOptions.length>2 ||
      body.displayedOptions.some(p=>![p?.vehicleId,p?.driverId].every(id=>Number.isSafeInteger(id) && id>0))))
      throw new AuthError('Displayed options must contain up to two valid pairs.',400);
    const scope = classifyCopilotScope(body.message, body.history ?? [], {
      hasActiveContext: Boolean(body.selectedPair || body.displayedOptions?.length || body.planToken),
    });
    if (scope.kind === 'courtesy') return scopeOnlyResponse(copilotCourtesyReply());
    if (scope.kind === 'out-of-scope') return scopeOnlyResponse(FLEETMATE_SCOPE_REDIRECT);
    const {id}=await params;
    const request=await loadRequest(id);
    if(!request)throw new AuthError('Reservation not found.',404);
    const prepared=await prepareDispatchRecommendation(request,{persistRoute:false});
    await applyDispatchRadar({...prepared,includePosition:false});
    const evidence=conversationEvidence(request,prepared.recommendation,body.selectedPair);
    // Phase B1 — signed proof refs ride alongside recovery actions so the
    // drawer can prove each finding. Non-fatal without signing config.
    try { attachEvidenceProofs(evidence, request.request_id, evidence.evaluatedAt); } catch { /* proofs stay null */ }
    try { attachClearanceProofs(evidence, request.request_id, evidence.evaluatedAt); } catch { /* clearance stays empty */ }
    // Card numbers are viewing context only. Resolve every pair against fresh server evidence.
    evidence.displayedOptions=(body.displayedOptions ?? []).map((p,index)=>({option:index+1,vehicleId:p.vehicleId,driverId:p.driverId,
      status:evidence.pairs.some(c=>c.vehicleId===p.vehicleId && c.driverId===p.driverId)?'resolved':'missing'}));
    let queue={status:'Not analyzed for this conversation'};
    if(body.planToken) {
      try {
        const verified=await verifyPlanToken(body.planToken);
        queue={status:'Validated plan scope',window:verified.window,confirmableChoices:verified.choices};
      } catch {queue={status:'Prior queue plan is stale or unavailable; re-analyze before relying on queue impact'};}
    }
    // Phase 2 — verified baseline comparison. A snapshot is never assignment
    // authority; tampered/cross-request baselines yield current findings only.
    const snapshot=buildExplanationSnapshot(evidence);
    let baseline=null, baselineStatus='none', changes={changed:false,fingerprint:null,changes:[]};
    if (typeof body.baseline === 'string' && body.baseline.length) {
      try {
        baseline=verifyExplanationSnapshot(body.baseline,{requestId:request.request_id});
        baselineStatus='verified';
        changes=diffExplanationSnapshots(baseline,snapshot);
      } catch (e) { baselineStatus = e?.code === 'SCOPE' || e?.code === 'TAMPERED' ? 'invalid' : 'stale'; }
    }
    const askedWhatChanged=/\bwhat changed\b|\bwhat('| i)s (new|different)\b|nagbago/i.test(body.message ?? '');
    let snapshotToken=null;
    try { snapshotToken=signExplanationSnapshot(snapshot); } catch { snapshotToken=null; }
    // Phase 3/4/4B — resolve "what if / impact / return" questions against
    // verified server runs, never hypothetical prose. Bounded and read-only;
    // any failure degrades to current-findings evidence with an explicit note.
    // Gated by this route's own 10/min limiter.
    let intentResult=null;
    const intent=detectCopilotIntent(body.message);
    if (intent?.type === 'simulate') {
      const scenario=parseSimulationScenario(body.message,{now:new Date()});
      if (!scenario) intentResult={type:'simulate',status:'not-a-scenario'};
      else if (scenario.needsClarification) intentResult={type:'simulate',status:'needs-date',passengerCount:scenario.passenger_count ?? null};
      else {
        try { intentResult={type:'simulate',status:'ok',result:await runReservationSimulation(request,scenario)}; }
        catch (e) { intentResult={type:'simulate',status:'error',note:e?.message ?? 'Simulation unavailable.'}; }
      }
    } else if (intent?.type === 'impact') {
      const resolved=(evidence.displayedOptions ?? []).filter(o=>o.status === 'resolved');
      const pairFor=option=>evidence.pairs.find(p=>p.vehicleId === option.vehicleId && p.driverId === option.driverId);
      if (resolved.length === 2 && resolved.every(o=>pairFor(o))) {
        try {
          const revision=await readPlanRevision();
          const routeMemo=new Map(), half=Date.now()+8000;
          const date=String(request.pickup_datetime).slice(0,10);
          const [runA,runB]=await Promise.all([
            buildDispatchPlan({date,deadline:half,routeMemo,selection:{requestId:request.request_id,vehicleId:resolved[0].vehicleId,driverId:resolved[0].driverId}}),
            buildDispatchPlan({date,deadline:half,routeMemo,selection:{requestId:request.request_id,vehicleId:resolved[1].vehicleId,driverId:resolved[1].driverId}}),
          ]);
          if (await readPlanRevision() !== revision) intentResult={type:'impact',status:'stale'};
          else intentResult={type:'impact',status:'ok',result:compareQueueImpact(runA,runB,{requestId:request.request_id})};
        } catch { intentResult={type:'impact',status:'error'}; }
      } else intentResult={type:'impact',status:'needs-options'};
    } else if (intent?.type === 'return') {
      const pair=evidence.selection && evidence.selection.status === 'resolved'
        ? {vehicleId:evidence.selection.vehicleId,driverId:evidence.selection.driverId}
        : evidence.recommended;
      if (!pair) intentResult={type:'return',status:'needs-pair'};
      else {
        try { intentResult={type:'return',status:'ok',result:await findReturnMatches({outboundId:request.request_id,vehicleId:pair.vehicleId,driverId:pair.driverId,timeWindowHours:4,candidateCap:6,deadline:Date.now()+10000})}; }
        catch (e) { intentResult={type:'return',status:'error',note:e?.message ?? 'Return search unavailable.'}; }
      }
    }
    const result=await executeLlmCompletion({feature_used:'Dispatch Copilot conversation',user_email:session?.user?.email,
      max_tokens:450,timeout_ms:12000,prefer_fast_model:true,defer_log:true,temperature:0.2,
      system_instructions:buildCopilotSystemInstructions(),
      user_prompt:JSON.stringify({serverEvidence:evidence,queue,baselineStatus,verifiedChanges:changes,intent:intentResult,
        displayedEvaluatedAt:body.displayedEvaluatedAt ?? null,conversation:body.history ?? [],question:body.message.trim()})});
    const fallbackAnswer = intentFallback(intentResult)      ?? (askedWhatChanged && baselineStatus === 'verified'
        ? summarizeChanges(changes)
        : askedWhatChanged && baselineStatus !== 'verified'
          ? `${evidenceSummary(evidence,body.message)} The prior verified state is unavailable, so only current findings are shown.`
          : evidenceSummary(evidence,body.message));
    const resolvedOptions = (evidence.displayedOptions ?? []).filter(o => o.status === 'resolved');
    // Phase B4 — comparison proof for exactly two resolved displayed options.
    // Bound to both option identities; resolver re-evaluates both server-side.
    let comparisonProof = null;
    if (resolvedOptions.length === 2) {
      try {
        comparisonProof = {
          type: EVIDENCE_TYPES.COMPARISON,
          ref: signEvidenceRef({
            requestId: request.request_id,
            vehicleId: resolvedOptions[0].vehicleId, driverId: resolvedOptions[0].driverId,
            proofType: EVIDENCE_TYPES.COMPARISON,
            recordId: `${resolvedOptions[1].vehicleId}:${resolvedOptions[1].driverId}`,
            evaluatedAt: evidence.evaluatedAt,
          }),
        };
      } catch { comparisonProof = null; }
    }
    // The evaluated-window disclosure and the narration guards are server-owned.
    // A model that omits the bound would let a bounded projection read as the
    // complete set (FM-ADV-008); a model left to answer a rate bait, a GPS
    // question on an inapplicable evaluation, an absent entity or a
    // record-override claim from its own judgement turns those answers into a
    // sampling outcome. Each is a closed fact about (question, evidence), so the
    // route states it. Two further guards read the model's own prose instead, for
    // the claims it volunteers that nobody asked for - which is why `narrated` is
    // computed first and handed to the guards. The model's prose is kept verbatim
    // (SEC-AI-007): these sentences append, never replace.
    const narrated = result.success && result.content ? plainChatText(result.content) : null;
    const guards = narrationGuards({ question: body.message, evidence, answer: narrated });
    const answer = narrated
      ? withGuards(withCoverageDisclosure(narrated, evidence.coverage), guards).slice(0, 8000)
      : fallbackAnswer;
    // Observability only, on the narrated path only. 'Flagged' is deliberately
    // not 'error': the AI error counters match ILIKE 'error', so guard frequency
    // is visible without inflating the error rate or entering the review queue.
    const guardFired = narrated ? guardLabels(guards) : [];
    if (guardFired.length) {
      void logAiRequest({feature_used:'Dispatch Copilot conversation',provider_name:'Narration Guard',
        model_name:'Deterministic Guard',status:'Flagged',user_email:session?.user?.email,
        error_message:`Narration guard fired: ${guardFired.join(', ')}`});
    }
    return Response.json({answer,
      choiceOptions:evidence.selection ? [] : evidence.displayedOptions.filter(o=>evidence.pairs.some(p=>p.vehicleId===o.vehicleId && p.driverId===o.driverId && p.canChoose)).map(o=>o.option),
      mode:result.success && result.content?'conversation':'evidence-only',evaluatedAt:evidence.evaluatedAt,
      selection:evidence.selection,coverage:evidence.coverage,
      recoveryActions:evidence.recoveryActions ?? [],
      pairRecovery:(evidence.pairs ?? []).slice(0,2).map(p=>({vehicleId:p.vehicleId,driverId:p.driverId,actions:p.recoveryActions ?? [],clearance:p.clearance ?? [],meta:p.clearanceMeta ?? null})),
      comparisonProof,
      snapshot:snapshotToken, baselineStatus, changes, intent:intentResult},
      {headers:{'Cache-Control':'private, no-store'}});
  } catch(error) {return handleError(error);}
}
