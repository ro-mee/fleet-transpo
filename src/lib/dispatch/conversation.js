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
  const pairs = ordered.slice(0, 12).map(p => ({
    vehicleId:Number(p.vehicle_id), driverId:Number(p.driver_id), plate:p.vehicle?.plate_number,
    state:dispatchDecision(p).state, reasons:dispatchDecision(p).reasons,
    checks:(p.checks ?? []).map(c=>({label:c.label,status:c.status,message:c.message})),
    rankingReasons:p.reasons, routeVerdict:p.feasibility?.verdict,
    temporalContext:p.temporalContext, scheduleEvidence:p.scheduleEvidence,
    workloadEvidence:p.workloadEvidence, decisionEvidence:p.decisionEvidence,
    livePickupEta:p.proximity ?? null, predictedTransfer:p.expectedRoute ?? null,
    travelToPickupMinutes:p.proximity?.etaMinutes ?? p.expectedRoute?.etaMinutes ?? null,
    departureSlackMinutes:p.feasibility?.pickupBufferMin ?? null,
    nextTrips:(p.downstream ?? []).map(d=>({dispatchId:d.nextDispatchId,verdict:d.verdict,reasons:d.reasons})),
  }));
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

export function evidenceSummary(evidence) {
  if (evidence.selection?.status === 'missing') {
    return `The selected vehicle #${evidence.selection.vehicleId} / driver #${evidence.selection.driverId} is no longer in the current candidate evidence. Recheck this reservation before relying on that pair.`;
  }
  const reasons=evidence.exclusions.map(e=>e.reason).filter(Boolean);
  const pairs = evidence.selection
    ? evidence.pairs.filter(p=>p.vehicleId===evidence.selection.vehicleId && p.driverId===evidence.selection.driverId)
    : evidence.pairs;
  const summary = pairs.length
    ? pairs.slice(0,3).map(p=>`${p.plate || `Vehicle #${p.vehicleId}`} / driver #${p.driverId}: ${p.state}. ${p.reasons.join(' ')}`).join('\n')
    : reasons.length ? `No pair is currently recommended. Recorded exclusions:\n${reasons.join('\n')}`
      : 'No evaluated pair or exclusion explanation is available. Recheck this reservation; this does not prove the fleet is unavailable.';
  const coverage = evidence.coverage;
  const comparison = evidence.pairs.find(p => p.vehicleId === evidence.recommended?.vehicleId && p.driverId === evidence.recommended?.driverId)?.decisionEvidence;
  const facts = evidence.pairs.slice(0,2).map(p => `${p.plate || `Vehicle #${p.vehicleId}`}: ${p.scheduleEvidence?.gapMinutes ?? 'unverified'} min schedule gap; ${p.scheduleEvidence?.usableSlackMinutes ?? 'unverified'} min usable slack; ${p.workloadEvidence?.complete ? `${p.workloadEvidence.totalTrips} recorded trips on ${p.workloadEvidence.serviceDate}` : 'workload unknown'}.`).join('\n');
  return summary + (comparison ? `\n${comparison.explanation}\n${facts}` : '') + (coverage?.pairs.truncated || coverage?.exclusions.truncated
    ? `\nLimited context: ${coverage.pairs.included} of ${coverage.pairs.total} candidate pairs and ${coverage.exclusions.included} of ${coverage.exclusions.total} exclusions in this evaluation.` : '');
}
