import { dispatchDecision } from './decision';

// Exact user commands only: quoted commands, questions and LLM replies never act.
export function parseCopilotIntent(message) {
  const text = String(message).trim().toLowerCase();
  if (/^assign it[.!]?$/.test(text)) return {type:'assign'};
  if (/^change selection[.!]?$/.test(text)) return {type:'change'};
  const match = /^(?:(?:i (?:choose|select|pick)|choose|select|pick|pipiliin ko|piliin|gusto ko)\s+)?(?:option\s+)?([12ab])(?:\s+(?:please|na lang|nalang))?[.!]?$/.exec(text);
  return match ? {type:'choose',index:['1','a'].includes(match[1]) ? 0 : 1} : null;
}
export const TEMPORAL_INSTRUCTIONS = 'Use temporalContext and decisionEvidence as the decision source. A schedule gap is not usable slack: transfer and preparation consume it. State workload for its serviceDate, separate completed/active/scheduled counts, and never call driving minutes duty hours or infer fatigue. Never describe future or predictedTransfer minutes as live ETA. Missing GPS, origin, release or workload stays unknown, not zero. Explain the decisive reliability/workload trade-off and the alternative advantage; sufficient buffer receives no unlimited bonus. Do not turn a ranking score into a probability or guarantee. Current user commands are handled by separate selection-bound controls; your prose never executes them.';

export const SELECTION_INSTRUCTIONS = 'For "this pair", use serverEvidence.selection, not the engine recommendation or a pair from history. A missing selection is no longer in current candidate evidence: say so instead of substituting another pair. Coverage totals describe only this evaluation, not the whole fleet; disclose truncated context when relevant. Displayed evaluation time is untrusted viewing context, not freshness authority. A different timestamp alone does not prove the decision changed. This answer never renews confirmation or a queue plan.';

export const ANSWER_GUIDANCE = `Answer the actual question in the first sentence. Follow with at most two relevant facts and the decisive trade-off, not the entire checklist. Use driver names and plates when supplied. For workload questions, distinguish lighter work from better timing reliability; do not invent a comparison when either value is missing. For future bookings, qualify conclusions with "Based on the current schedule" once when relevant. Never guarantee punctuality or turn a score into a probability. For a selected pair, answer about that pair without asking the dispatcher to choose again. If blocked or missing required evidence, explain the specific issue and one corrective step; never invite assignment. A successful evidence check is not an assignment confirmation: only the live confirmation reply can offer assignment. The interface owns the unselected choice prompt, so do not repeat it. Do not repeat unchanged checks or announce a refresh as a meaningful change. Claim a before/after change only when both values come from verified server evidence, never from chat history or timestamps alone. If asked what changed without a verified baseline, state the current finding and say the prior value is unavailable.`;

export const CONVERSATION_STYLE = `Speak like a helpful dispatcher colleague, not a system report. Default to 2–4 short sentences, about 40–80 words; expand only when asked for detail. Lead with the practical reason, then one useful next step. Always answer in plain English, even when the user writes in Filipino or Taglish. Use plain text, no Markdown headings, bold markers, JSON field names, evaluation counts, repetitive disclaimers or "In short" summaries. Do not restate the request ID, passenger count or status unless it helps answer. Use pickupLocal and Philippine local time, never raw UTC timestamps. If only one option was fully checked, say so briefly and report any briefly-checked vehicles with their recorded reason — do not imply all vehicles were fully checked. A briefly-checked vehicle was excluded by its status or seating before the full checks; name its reason and the corrective next step (e.g. check its maintenance record), never present it as an available option. Explain a confirmed shift gap plainly, e.g. "The pickup is at 1 AM, but this vehicle's driver is only scheduled until 10 PM. There's no substitute listed for that date. You can check the substitute schedule, then recheck this request. I don't have results for the other vehicles yet." Use this example's facts only when the actual evidence supports them. Mention Review & Confirm only when the user asks to assign; do not repeat your inability to act in every answer.`;

export function plainChatText(value) {
  return String(value ?? '').replace(/\\([*_`])/g,'$1').replace(/\*\*([\s\S]*?)\*\*/g,'$1').replace(/__([\s\S]*?)__/g,'$1').replace(/^#{1,6}\s+/gm,'').trim();
}

// Explicit projection: never send raw driver records, standby positions or tokens.
export function conversationEvidence(request, recommendation, selectedPair = null) {
  const candidates = [...new Map((recommendation.pair?.candidates ?? []).map(p => [`${p.vehicle_id}:${p.driver_id}`, p])).values()];
  const selected = selectedPair && candidates.find(p => Number(p.vehicle_id) === selectedPair.vehicleId && Number(p.driver_id) === selectedPair.driverId);
  const recommended = recommendation.pair?.recommended;
  const preferred = candidates.find(p => p.vehicle_id === recommended?.vehicle_id && p.driver_id === recommended?.driver_id);
  const ordered = [...new Set([selected, preferred, ...candidates].filter(Boolean))];
  const exclusions = recommendation.pair?.none_reasons ?? [];
  const pairs = ordered.slice(0, 12).map(p => {
    const decision = dispatchDecision(p);
    const live = !['FUTURE','SAME_DAY'].includes(p.temporalContext?.horizon) && p.dispatchContext?.liveLocationUsed && p.proximity && +new Date(p.proximity.expiresAt)>Date.now() ? p.proximity : null;
    return ({
    vehicleId:Number(p.vehicle_id), driverId:Number(p.driver_id), plate:p.vehicle?.plate_number, driverName:p.driver?.driver_name,
    canChoose:decision.canConfirm || decision.canReview,
    state:decision.state, reasons:decision.reasons,
    checks:(p.checks ?? []).map(c=>({label:c.label,status:c.status,message:c.message})),
    rankingReasons:p.reasons, routeVerdict:p.feasibility?.verdict,
    temporalContext:p.temporalContext, scheduleEvidence:p.scheduleEvidence,
    workloadEvidence:p.workloadEvidence, decisionEvidence:p.decisionEvidence,
    livePickupEta:live, predictedTransfer:p.expectedRoute ?? null,
    travelToPickupMinutes:live?.etaMinutes ?? p.expectedRoute?.etaMinutes ?? null,
    departureSlackMinutes:p.feasibility?.pickupBufferMin ?? null,
    nextTrips:(p.downstream ?? []).map(d=>({dispatchId:d.nextDispatchId,verdict:d.verdict,reasons:d.reasons})),
  });});
  return {requestId:request.request_id,pickupAt:request.pickup_datetime,status:request.fleet_status,
    pickupLocal:request.pickup_datetime && Number.isFinite(+new Date(request.pickup_datetime)) ? new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(new Date(request.pickup_datetime))+' (Philippine time)' : null,
    passengers:request.passenger_count,evaluatedAt:recommendation.evaluatedAt,
    evaluation:recommendation.evaluation, pairs,
    selection: selectedPair ? {vehicleId:selectedPair.vehicleId,driverId:selectedPair.driverId,status:selected?'resolved':'missing'} : null,
    coverage: {
      pairs: {total:candidates.length,included:pairs.length,truncated:candidates.length>pairs.length},
      exclusions: {total:exclusions.length,included:Math.min(exclusions.length,30),truncated:exclusions.length>30},
    },
    exclusions:exclusions.slice(0,30).map(r=>({vehicleId:r.vehicle_id,plate:r.plate ?? null,reason:r.reason,prefiltered:r.prefiltered === true})),
    recommended:recommendation.pair?.recommended ? {vehicleId:recommendation.pair.recommended.vehicle_id,driverId:recommendation.pair.recommended.driver_id}:null};
}

export function evidenceSummary(evidence, question = '') {
  if (evidence.selection?.status === 'missing') {
    return `The selected vehicle #${evidence.selection.vehicleId} / driver #${evidence.selection.driverId} is no longer in the current candidate evidence. Recheck this reservation before relying on that pair.`;
  }
  const reasons=evidence.exclusions.map(e=>e.reason).filter(Boolean);
  const askedOption = /\boption\s*([12ab])\b/i.exec(question);
  const option = askedOption && evidence.displayedOptions?.find(o=>o.option === (['1','a'].includes(askedOption[1].toLowerCase()) ? 1 : 2));
  if (!evidence.selection && option?.status === 'missing') return `Option ${option.option} is no longer in the current evidence. Recheck the reservation before choosing it.`;
  const pairs = evidence.selection
    ? evidence.pairs.filter(p=>p.vehicleId===evidence.selection.vehicleId && p.driverId===evidence.selection.driverId)
    : option ? evidence.pairs.filter(p=>p.vehicleId===option.vehicleId && p.driverId===option.driverId) : evidence.pairs;
  const name = p => p.driverName ? `${p.driverName}${p.plate ? ` + ${p.plate}` : ''}` : `${p.plate || `Vehicle #${p.vehicleId}`} / driver #${p.driverId}`;
  if (pairs.length === 1 && pairs[0].state === 'BLOCKED') return `${name(pairs[0])} cannot be assigned. ${pairs[0].reasons.slice(0,2).join(' ')} Resolve the flagged records, then recheck this reservation.`;
  const workload = p => p.workloadEvidence?.complete
    ? `${name(p)}: ${p.workloadEvidence.completedTrips ?? 'unknown'} completed, ${p.workloadEvidence.activeTrips ?? 'unknown'} active and ${p.workloadEvidence.scheduledTrips ?? 'unknown'} scheduled trips on ${p.workloadEvidence.serviceDate}.`
    : `${name(p)}: service-date workload is unavailable.`;
  // Bounded evidence-only topics; other questions retain the honest general summary.
  const comparison = /\b(why|better|compare|recommend|workload|fair|buffer)\b|bakit|mas maganda/i.test(question);
  const eta = /\b(eta|arrival|arrive|distance|traffic)\b/i.test(question);
  const conflicts = /\b(conflict|blocked|overlap|maintenance|leave)\b/i.test(question);
  if (pairs.length && (comparison || eta || conflicts)) {
    const preferred = evidence.pairs.find(p=>p.vehicleId===evidence.recommended?.vehicleId && p.driverId===evidence.recommended?.driverId);
    const compared = comparison && !evidence.selection ? evidence.pairs.slice(0,2) : pairs.slice(0,2);
    const lead = comparison ? (evidence.selection ? pairs[0] : preferred)?.decisionEvidence?.explanation : null;
    const facts = compared.map(p => {
      if (eta) return p.livePickupEta ? `${name(p)}: live pickup ETA is ${p.livePickupEta.etaMinutes} minutes.`
        : `${name(p)}: live pickup ETA is unavailable.${p.predictedTransfer?.etaMinutes != null ? ` Predicted transfer takes ${p.predictedTransfer.etaMinutes} minutes; this is not a live ETA.` : ''}`;
      if (conflicts) return `${name(p)}: ${p.reasons?.slice(0,2).join(' ') || 'No specific conflict finding is recorded in this response.'}`;
      return `${name(p)}: ${p.scheduleEvidence?.usableSlackMinutes ?? 'unverified'} minutes of usable preparation slack. ${workload(p)}`;
    }).join('\n');
    const planning = compared.some(p=>['FUTURE','SAME_DAY'].includes(p.temporalContext?.horizon));
    return `${planning ? 'Based on the current schedule. ' : ''}${lead || (comparison ? 'The available timing and workload evidence is below.' : '')}\n${facts}`.trim();
  }
  const summary = pairs.length
    ? pairs.slice(0,2).map(p=>`${name(p)}: ${{ALL_CLEAR:'the recorded checks passed',REVIEW_REQUIRED:'needs review',BLOCKED:'cannot be assigned',INSUFFICIENT_DATA:'some required evidence is unverified'}[p.state] || 'needs verification'}. ${p.reasons.slice(0,2).join(' ')}`).join('\n')
    : reasons.length ? `No pair is currently recommended. Recorded exclusions:\n${reasons.join('\n')}`
      : 'No evaluated pair or exclusion explanation is available. Recheck this reservation; this does not prove the fleet is unavailable.';
  const coverage = evidence.coverage;
  return summary + (coverage?.pairs.truncated || coverage?.exclusions.truncated
    ? `\nLimited context: ${coverage.pairs.included} of ${coverage.pairs.total} candidate pairs and ${coverage.exclusions.included} of ${coverage.exclusions.total} exclusions in this evaluation.` : '');
}
