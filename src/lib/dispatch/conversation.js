import { dispatchDecision, recoveryActionForCheck, recoveryActionForExclusion, sortRecoveryActions } from './decision';

// Prompt blocks live in copilot-prompt.js (single owner per rule). These
// re-exports preserve the existing import surface.
export {
  ANSWER_GUIDANCE,
  TEMPORAL_INSTRUCTIONS,
  SELECTION_INSTRUCTIONS,
  CONVERSATION_STYLE,
} from './copilot-prompt';

// Exact user commands only: quoted commands, questions and LLM replies never act.
export function parseCopilotIntent(message) {
  const text = String(message).trim().toLowerCase();
  if (/^assign it[.!]?$/.test(text)) return {type:'assign'};
  if (/^change selection[.!]?$/.test(text)) return {type:'change'};
  const match = /^(?:(?:i (?:choose|select|pick)|choose|select|pick|pipiliin ko|piliin|gusto ko)\s+)?(?:option\s+)?([12ab])(?:\s+(?:please|na lang|nalang))?[.!]?$/.exec(text);
  return match ? {type:'choose',index:['1','a'].includes(match[1]) ? 0 : 1} : null;
}

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
    const ctx = { vehicleId: Number(p.vehicle_id), driverId: Number(p.driver_id), requestId: request.request_id };
    const recoveryActions = sortRecoveryActions((p.checks ?? []).map(c => recoveryActionForCheck({ id: c.id, status: c.status, message: c.message }, ctx)).filter(Boolean)).slice(0, 3);
    return ({
    vehicleId:Number(p.vehicle_id), driverId:Number(p.driver_id), plate:p.vehicle?.plate_number, driverName:p.driver?.driver_name,
    canChoose:decision.canConfirm || decision.canReview,
    state:decision.state, reasons:decision.reasons,
    checks:(p.checks ?? []).map(c=>({id:c.id ?? null,label:c.label,status:c.status,message:c.message})),
    recoveryActions,
    rankingReasons:p.reasons, routeVerdict:p.feasibility?.verdict,
    temporalContext:p.temporalContext, scheduleEvidence:p.scheduleEvidence,
    workloadEvidence:p.workloadEvidence, decisionEvidence:p.decisionEvidence,
    livePickupEta:live, predictedTransfer:p.expectedRoute ?? null,
    // GPS health label only, when the server supplies it (IMMEDIATE branch).
    // FUTURE/SAME_DAY/REPOSITION intentionally omit it: absence is not missing
    // evidence. Label only — never coordinates or raw fixes.
    ...(p.dispatchContext?.gpsHealth ? {gpsHealth:p.dispatchContext.gpsHealth} : {}),
    // Dispatch mode as a label (IMMEDIATE / REPOSITION / SCHEDULED). Separate
    // taxonomy from the horizon, and the only field that says whether live
    // location was ever applicable — a repositioning pair runs NEAR_DISPATCH or
    // LAST_MINUTE, so the drawer cannot infer it from the horizon. Label only:
    // never originType, previousDispatchId, standby coordinates or release times.
    dispatchMode:p.dispatchContext?.mode ?? null,
    travelToPickupMinutes:live?.etaMinutes ?? p.expectedRoute?.etaMinutes ?? null,
    departureSlackMinutes:p.feasibility?.pickupBufferMin ?? null,
    nextTrips:(p.downstream ?? []).map(d=>({dispatchId:d.nextDispatchId,verdict:d.verdict,reasons:d.reasons})),
    // Blocking incident ids only (record scope for incident proof). No
    // descriptions, locations, or actions — the drawer resolves those safely.
    incidentIds:(p.hardConflicts ?? []).filter(c=>c?.type === 'incident').map(c=>Number(c?.detail?.incident_id)).filter(id=>Number.isSafeInteger(id)),
  });});
  const exclusionCtx = { requestId: request.request_id };
  const projectedExclusions = exclusions.slice(0,30).map(r=>({vehicleId:r.vehicle_id,plate:r.plate ?? null,reason:r.reason,prefiltered:r.prefiltered === true,
    recovery:recoveryActionForExclusion({ reason: r.reason, vehicleId: r.vehicle_id }, exclusionCtx)}));
  return {requestId:request.request_id,pickupAt:request.pickup_datetime,status:request.fleet_status,
    pickupLocal:request.pickup_datetime && Number.isFinite(+new Date(request.pickup_datetime)) ? new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(new Date(request.pickup_datetime))+' (Philippine time)' : null,
    passengers:request.passenger_count,evaluatedAt:recommendation.evaluatedAt,
    evaluation:recommendation.evaluation, pairs,
    selection: selectedPair ? {vehicleId:selectedPair.vehicleId,driverId:selectedPair.driverId,status:selected?'resolved':'missing'} : null,
    coverage: {
      pairs: {total:candidates.length,included:pairs.length,truncated:candidates.length>pairs.length},
      exclusions: {total:exclusions.length,included:Math.min(exclusions.length,30),truncated:exclusions.length>30},
    },
    exclusions:projectedExclusions,
    recoveryActions:sortRecoveryActions(projectedExclusions.slice(0,3).map(e=>e.recovery).filter(Boolean)),
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
  if (pairs.length === 1 && pairs[0].state === 'BLOCKED') { const next = pairs[0].recoveryActions?.[0]?.label ? ` Next step: ${pairs[0].recoveryActions[0].label}.` : ' Resolve the flagged records, then recheck this reservation.'; return `${name(pairs[0])} cannot be assigned. ${pairs[0].reasons.slice(0,2).join(' ')}${next}`; }
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
    ? pairs.slice(0,2).map(p=>`${name(p)}: ${{ALL_CLEAR:'the recorded checks passed',REVIEW_REQUIRED:'needs review',BLOCKED:'cannot be assigned',INSUFFICIENT_DATA:'some required evidence is unverified'}[p.state] || 'needs verification'}. ${p.reasons.slice(0,2).join(' ')}${p.recoveryActions?.[0]?.label ? ` Next step: ${p.recoveryActions[0].label}.` : ''}`).join('\n')
    : reasons.length ? `No pair is currently recommended. Recorded exclusions:\n${reasons.join('\n')}${evidence.recoveryActions?.[0]?.label ? `\nNext step: ${evidence.recoveryActions[0].label}.` : ''}`
      : 'No evaluated pair or exclusion explanation is available. Recheck this reservation; this does not prove the fleet is unavailable.';
  return summary + coverageDisclosure(evidence.coverage);
}

/**
 * The evaluated-window disclosure for a truncated projection.
 *
 * This is an evidence fact, not a narration choice: it is a pure function of
 * evidence.coverage, so it must never depend on model sampling.
 * conversationEvidence() caps the projection at 12 pairs and 30 exclusions, and
 * a bounded list read as the complete set is a wrong answer (FM-ADV-008). The
 * route appends this sentence, so the disclosure survives a model that omits it.
 * Returns '' when nothing was truncated, so callers can concatenate blindly.
 */
export function coverageDisclosure(coverage) {
  return coverage?.pairs.truncated || coverage?.exclusions.truncated
    ? `\nLimited context: ${coverage.pairs.included} of ${coverage.pairs.total} candidate pairs and ${coverage.exclusions.included} of ${coverage.exclusions.total} exclusions in this evaluation.`
    : '';
}

/**
 * Guarantee the evaluated-window disclosure on a narrated answer.
 *
 * The model is told not to state coverage counts, so this normally appends. The
 * totals are still checked first: if the model disclosed the window in its own
 * words the sentence would be redundant, and the failure direction must stay
 * toward disclosure, never away from it.
 */
export function withCoverageDisclosure(answer, coverage) {
  const disclosure = coverageDisclosure(coverage);
  if (!disclosure) return answer;
  const text = String(answer ?? '');
  const stated = [coverage.pairs.total, coverage.exclusions.total]
    .every(total => new RegExp(`\\b${total}\\b`).test(text));
  return stated ? answer : `${text}${disclosure}`.trim();
}
