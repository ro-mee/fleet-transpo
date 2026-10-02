import { dispatchDecision, recoveryActionForCheck, recoveryActionForExclusion, sortRecoveryActions } from './decision';
import { DAY_NAMES } from '@/lib/scheduling/driver-schedule';

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

// The interface appends the choice prompt for unselected options. Provider
// narration sometimes repeats it despite the prompt rule, so remove only the
// known trailing prompt and leave the model's operational explanation intact.
export function stripChoicePrompt(answer, { hasSelection = false, choiceOptions = [] } = {}) {
  const text = String(answer ?? '').trim();
  if (hasSelection || !choiceOptions.length) return text;
  return text.replace(/\s*(?:Which would you like to choose:?\s*Option 1 or Option 2\??|Would you like to choose Option [12]\??|Choose Option 1 or Option 2\.?)\s*$/i, '').trim();
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
    temporalContext:p.temporalContext, scheduleEvidence:projectScheduleEvidence(p.scheduleEvidence),
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
    driverId:r.driver_id ?? null,driverName:r.driver_name ?? null,
    recovery:recoveryActionForExclusion({ reason: r.reason, vehicleId: r.vehicle_id }, {...exclusionCtx, driverId: r.driver_id ?? null})}));
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

// Philippine wall-clock for a schedule instant. The raw evidence carries ISO
// UTC (07:09Z) while the UI renders Manila (3:09 PM); handing the model only
// the ISO invites it to repeat the UTC hour with a correct minute-gap beside
// it (RS-UZYD 2026-10-02). Project the Manila string alongside so narration
// never has to convert.
function formatReleaseLocal(value) {
  const d = new Date(value);
  if (!Number.isFinite(+d)) return null;
  return (
    new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d) + ' (Philippine time)'
  );
}

function projectScheduleEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return evidence;
  const releaseAt = evidence.releaseAt ?? null;
  const releaseLocal = releaseAt ? formatReleaseLocal(releaseAt) : null;
  if (!releaseLocal || evidence.releaseLocal === releaseLocal) return evidence;
  return { ...evidence, releaseLocal };
}

const FRIENDLY_PAIR_STATES = {
  ALL_CLEAR: 'Ready for review',
  REVIEW_REQUIRED: 'Needs review',
  BLOCKED: 'Blocked',
  INSUFFICIENT_DATA: 'Needs verification',
};

function pairLabel(pair = {}) {
  if (pair.driverName && pair.plate) return `${pair.driverName} with ${pair.plate}`;
  if (pair.driverName) return pair.driverName;
  if (pair.plate) return `${pair.plate}${pair.driverId != null ? ` with driver #${pair.driverId}` : ''}`;
  return `Vehicle #${pair.vehicleId ?? '?'} / driver #${pair.driverId ?? '?'}`;
}

function cleanOperationalText(value) {
  return String(value ?? '')
    .replace(/\busable preparation slack\b/gi, 'preparation time')
    .replace(/\busable slack\b/gi, 'preparation time')
    .replace(/\bservice-date workload\b/gi, 'workload for this date')
    .replace(/\bdriver-vehicle pair\b/gi, 'driver and vehicle')
    .replace(/\bINSUFFICIENT_DATA\b/gi, 'needs verification')
    .replace(/\bREVIEW_REQUIRED\b/gi, 'needs review')
    .replace(/\bALL_CLEAR\b/gi, 'ready for review')
    .replace(/\bUNKNOWN\b/gi, 'unverified')
    .replace(/\bthis pair\b/gi, 'this option')
    .replace(/\bestimated travel to pickup\b/gi, 'travel to the pickup')
    .replace(/\s+/g, ' ')
    .trim();
}

function pairReasons(pair = {}) {
  const reasons = [];
  const seen = new Set();
  const add = (value) => {
    const text = cleanOperationalText(value);
    const key = text.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    reasons.push(text);
  };

  (pair.reasons ?? []).forEach(add);
  (pair.nextTrips ?? []).forEach((trip) => {
    (trip.reasons ?? []).forEach((reason) => {
      const dispatchId = trip.dispatchId;
      add(dispatchId != null && !new RegExp(`dispatch\\s*#?${dispatchId}`, 'i').test(String(reason))
        ? `Downstream dispatch #${dispatchId}: ${reason}`
        : reason);
    });
  });
  return reasons;
}

function firstPairReason(pair = {}) {
  return pairReasons(pair)[0] ?? null;
}

function pairReasonText(pair = {}) {
  return pairReasons(pair).slice(0, 2).join(' ');
}

function stateDisclosure(pair = {}) {
  if (pair.state === 'ALL_CLEAR') return 'the recorded checks passed.';
  if (pair.state === 'BLOCKED') return 'This option cannot be assigned.';
  if (pair.state === 'INSUFFICIENT_DATA') return 'some required evidence is unverified.';
  return null;
}

function decisionReason(pair = {}) {
  const code = pair.decisionEvidence?.code;
  const raw = String(pair.decisionEvidence?.explanation ?? '');
  if (code === 'RELIABILITY') return 'This option has the stronger timing evidence.';
  if (code === 'EFFICIENCY') return 'Both options have comparable timing, and this option needs less travel to the pickup.';
  if (code === 'WORKLOAD') return 'Both options have enough preparation time, and this driver has the lighter workload for this date.';
  if (code === 'ONLY_OPTION') return 'the recorded checks passed, and this is the only option checked.';
  if (code === 'SCHEDULE_FIT') {
    if (/designated driver|standing preference/i.test(raw)) return 'Both options have workable timing, and the designated driver pairing puts this option first.';
    if (/no supported material timing|no meaningful|no material|verified timing advantage|stable tie-breaker/i.test(raw)) return 'No clear advantage was verified over the other option.';
    if (/required timing evidence|unverified preparation/i.test(raw)) return 'Pickup timing is not verified yet, so this option is not fully ready.';
    if (/checked schedule fits/i.test(raw)) return 'Both options have workable timing, with no meaningful timing or workload difference.';
  }
  if (pair.state === 'ALL_CLEAR' && !raw && !firstPairReason(pair)) return 'the recorded checks passed.';
  return cleanOperationalText(raw || firstPairReason(pair) || 'The latest check did not identify a single decisive advantage.');
}

function pairStatus(pair = {}) {
  return FRIENDLY_PAIR_STATES[pair.state] ?? 'Needs verification';
}

function pendingReason(pair = {}) {
  if (pair.routeVerdict === 'UNKNOWN' || /timing evidence|preparation time|turnaround/i.test(String(pair.decisionEvidence?.explanation ?? ''))) {
    return 'pickup timing is not verified yet';
  }
  return cleanOperationalText(firstPairReason(pair) || 'some required information is not verified yet').replace(/[.]+$/, '').toLowerCase();
}

function nextStep(pair = {}) {
  const code = pair.recoveryActions?.[0]?.code;
  const steps = {
    ROUTE_EVIDENCE: 'Verify departure positioning and timing, then recheck this request.',
    MAINTENANCE_CONFLICT: 'Check maintenance record, then recheck this request.',
    PAIRING: 'Check the substitute schedule, then recheck this request.',
    DRIVER_UNAVAILABLE: 'Pick an available driver, then recheck this request.',
    VEHICLE_STATUS: 'Check the vehicle record, then recheck this request.',
    REQUEST_EVIDENCE: 'Check the reservation details, then recheck this request.',
  };
  if (steps[code]) return steps[code];
  if (pair.state === 'BLOCKED') return 'Resolve the blocker, then recheck this request.';
  if (pair.state && pair.state !== 'ALL_CLEAR') return 'Recheck this request after the pending information is verified.';
  return null;
}

function pairLine(pair = {}) {
  const status = pairStatus(pair);
  const reason = pair.state === 'BLOCKED'
    ? pairReasonText(pair) || 'A blocking issue was found.'
    : decisionReason(pair);
  const action = nextStep(pair);
  const disclosure = stateDisclosure(pair);
  const hasDisclosure = disclosure && reason.toLowerCase().includes(disclosure.replace(/[.]+$/, '').toLowerCase());
  return `${pairLabel(pair)} - ${status}. ${reason}${action ? ` Next step: ${action}` : ''}${disclosure && !hasDisclosure ? ` ${disclosure}` : ''}`;
}

// Words that are never part of a driver's name. Stripping them keeps "Why is
// Driver Marco unavailable?" resolving to Marco — while a claim like "the
// driver told me he is free" strips to nothing and falls through to the
// evidence verdict instead of hijacking the answer.
const NAME_STOP_WORDS = new Set(('a,an,the,this,that,these,those,is,are,was,were,be,been,being,do,does,did,can,could,should,would,will,shall,may,might,must,not,no,yes,why,how,what,who,whom,which,when,where,and,or,but,for,with,without,on,off,of,in,to,at,by,free,busy,available,unavailable,verified,unverified,blocked,blocking,ready,eligible,ineligible,okay,ok,goods,good,clear,cleared,fixed,assigned,leave,here,there,now,today,still,already,yet,again,ever,never,always,please,lang,na,ba,pa,bang,daw,raw,din,rin,naman,nga,siya,niya,kaniya,kayo,ka,mo,ko,namin,natin,sila,yung,yong,ang,mga,ng,sa,kay,si,ni,driver,drivers,vehicle,option,pair,he,she,it,they,we,you,me,him,her,them,us,his,hers,theirs,ours,yours,mine,told,said,says,say,tell,claim,mark,assign').split(','));
function stripNameStops(name) {
  return String(name).split(/[\s.]+/).filter(t => t.length > 1 && !NAME_STOP_WORDS.has(t.toLowerCase())).join(' ');
}
function optionNumberForPair(evidence, pair, fallback) {
  const option = (evidence.displayedOptions ?? []).find(o => o.status === 'resolved' && o.vehicleId === pair?.vehicleId && o.driverId === pair?.driverId);
  return option?.option ?? fallback;
}

// "Okay na ba si Karlo?" — resolve a named person against the current
// evidence before any topic branch. Matches first/last-name tokens against
// checked pairs first, then exclusions (which now carry driver identity).
// Returns null when no name is asked about, or a bounded honest answer.
function askedDriverName(question = '') {
  const m = /(?:\bsi|\bni|\bkay|\bkina)\s+([a-zà-ÿ][a-zà-ÿ'’.~-]*(?:\s+[a-zà-ÿ][a-zà-ÿ'’.~-]*){0,3})/i.exec(String(question))
    ?? /\bdriver\s+([a-zà-ÿ][a-zà-ÿ'’.~-]*(?:\s+[a-zà-ÿ][a-zà-ÿ'’.~-]*){0,3})/i.exec(String(question));
  if (!m) return null;
  const name = m[1].replace(/[.?!]+$/, '').trim();
  return name || null;
}
function nameTokenMatch(known, asked) {
  // Null is not a name: String(null) is "null", which would otherwise match
  // another null and report a driver nobody asked about.
  if (known == null || asked == null) return false;
  const parts = String(known).toLowerCase().split(/[\s.]+/).filter(p => p.length > 1);
  const tokens = String(asked).toLowerCase().split(/[\s.]+/).filter(p => p.length > 1);
  if (!parts.length || !tokens.length) return false;
  return tokens.every(t => parts.some(p => p === t || p.startsWith(t)));
}
function exclusionLine(e = {}) {
  const who = e.driverName && e.plate ? `${e.driverName} with ${e.plate}`
    : e.driverName || e.plate || 'That option';
  const reason = cleanOperationalText(e.reason || 'No detailed reason recorded.');
  const step = e.recovery?.label ? ` Next step: ${cleanOperationalText(e.recovery.label)}.` : '';
  return `${who} — ${reason}${step}`;
}
function namedDriverStatus(evidence, question = '') {
  const raw = askedDriverName(question);
  if (!raw) return null;
  const asked = stripNameStops(raw);
  if (!asked) return null;
  const inPairs = (evidence.pairs ?? []).filter(p => nameTokenMatch(p.driverName, asked));
  if (inPairs.length) return inPairs.slice(0, 2).map(pairLine).join('\n');
  const inExclusions = (evidence.exclusions ?? []).filter(e =>
    nameTokenMatch(e.driverName, asked) || nameTokenMatch(e.reason, asked));
  if (inExclusions.length) return inExclusions.slice(0, 2).map(exclusionLine).join('\n');
  // A name with no match is not an answer — fall through to the evidence
  // verdict so claims and unknown names can never divert the conclusion.
  return null;
}

function samePair(a, b) {
  return Boolean(a && b && a.vehicleId === b.vehicleId && a.driverId === b.driverId);
}

function workloadLine(pair = {}) {
  const workload = pair.workloadEvidence;
  if (!workload?.complete) return `${pairLabel(pair)}: workload for this date is not available.`;
  return `${pairLabel(pair)}: ${workload.completedTrips ?? 'unknown'} completed, ${workload.activeTrips ?? 'unknown'} active, and ${workload.scheduledTrips ?? 'unknown'} scheduled on ${workload.serviceDate}.`;
}

function scheduleGapNote(pair = {}) {
  const releaseLocal = pair.scheduleEvidence?.releaseLocal ?? null;
  const gap = pair.scheduleEvidence?.usableSlackMinutes ?? pair.scheduleEvidence?.gapMinutes ?? null;
  if (releaseLocal == null && gap == null) return null;
  if (releaseLocal != null && gap != null) return `Previous booking ends ${releaseLocal} with ${gap} minutes of preparation time.`;
  if (releaseLocal != null) return `Previous booking ends ${releaseLocal}.`;
  return `${gap} minutes of preparation time after the previous booking.`;
}

function nextTripNote(pair = {}) {
  const trips = pair.nextTrips ?? [];
  if (!trips.length) return null;
  const blocked = trips.filter(t => String(t.verdict).toUpperCase() === 'INFEASIBLE' || String(t.verdict).toUpperCase() === 'BLOCKED');
  if (blocked.length) {
    const first = blocked[0];
    const reason = (first.reasons ?? [])[0] ? ` ${(first.reasons ?? [])[0]}` : '';
    return `Downstream dispatch #${first.dispatchId} is affected.${reason}`;
  }
  return `${trips.length} downstream trip${trips.length > 1 ? 's were' : ' was'} checked with no blocking conflict.`;
}

function conflictAnswer(pair = {}) {
  const name = pairLabel(pair);
  if (pair.state === 'BLOCKED') return pairLine(pair);
  const base = pair.state === 'ALL_CLEAR'
    ? `No hard conflict found for ${name}. This option is ready for review.`
    : `No hard conflict found for ${name}. It still needs verification because ${pendingReason(pair)}.`;
  const extras = [scheduleGapNote(pair), nextTripNote(pair)].filter(Boolean);
  return extras.length ? `${base} ${extras.join(' ')}` : base;
}

function fixingAnswer(evidence, pairs) {
  const troubled = pairs.filter(p => p.state === 'BLOCKED' || p.state === 'REVIEW_REQUIRED' || p.state === 'INSUFFICIENT_DATA');
  if (!troubled.length) {
    const exclusions = evidence.exclusions ?? [];
    const base = pairs.slice(0, 2).map(pairLine).join('\n');
    return exclusions.length
      ? `${base}\nNothing in the checked options blocks assignment. Other evaluated vehicles were excluded:\n${exclusions.slice(0, 2).map(exclusionLine).join('\n')}`
      : `${base} Nothing in the current evidence needs fixing.`;
  }
  return troubled.slice(0, 2).map(pairLine).join('\n');
}

// "06:00:00" -> "6:00 AM". Duty rows store Manila wall-clock, so this is
// display formatting only, never a timezone conversion. ASCII by construction
// (group M answers must stay in printable ASCII).
function fmtClock(value) {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value ?? '').trim());
  if (!m) return String(value ?? '');
  const h = Number(m[1]) % 12 || 12;
  return `${h}:${m[2]} ${Number(m[1]) >= 12 ? 'PM' : 'AM'}`;
}

function clockMinutes(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function hypoMinutes(match) {
  let h = Number(match[1]) % 12;
  if (String(match[3]).toUpperCase() === 'PM') h += 12;
  return h * 60 + Number(match[2] ?? '00');
}

function dutySpan(w) {
  const span = `${fmtClock(w.shiftStart)} to ${fmtClock(w.shiftEnd)}`;
  return w.breakStart && w.breakEnd
    ? `${span} with a ${fmtClock(w.breakStart)} to ${fmtClock(w.breakEnd)} break`
    : `${span} with no recorded break`;
}

// Shift/break policy answers, read off the projected duty windows (Task 1).
// A hypothetical time is tested against the window with the same comparisons
// as scheduleBlockReason (inclusive shift edges, half-open break overlap) —
// and the answer says so, because overlap, leave and the other checks were
// never run for that time.
function shiftBreakAnswer(evidence, pairs, question) {
  const withWindow = pairs.filter(p => p.scheduleEvidence?.dutyWindow);
  if (!withWindow.length) {
    return `I can't verify that yet - no shift record was projected for this evaluation. Recheck this reservation.`;
  }
  const figured = withWindow.slice(0, 2);
  const windows = figured.map(p => ({ pair: p, w: p.scheduleEvidence.dutyWindow }));
  const hypo = /(\d{1,2})(?::(\d{2}))?\s?(AM|PM)/i.exec(question);
  if (hypo) {
    const t = hypoMinutes(hypo);
    const label = `${Number(hypo[1])}:${hypo[2] ?? '00'} ${hypo[3].toUpperCase()}`;
    const lines = windows.map(({ pair, w }) => {
      const day = DAY_NAMES[Number(w.dayOfWeek)] ?? 'that day';
      const s = clockMinutes(w.shiftStart);
      const e = clockMinutes(w.shiftEnd);
      const bs = w.breakStart ? clockMinutes(w.breakStart) : null;
      const be = w.breakEnd ? clockMinutes(w.breakEnd) : null;
      const name = pairLabel(pair);
      if (s == null || e == null) return `I can't verify that yet for ${name} - the shift record is incomplete.`;
      if (t < s || t > e) return `A ${label} pickup would be blocked by the shift rule for ${name}: the ${day} window is ${fmtClock(w.shiftStart)} to ${fmtClock(w.shiftEnd)}.`;
      if (bs != null && be != null && bs <= t && t < be) return `A ${label} pickup would be blocked by the break rule for ${name}: break is ${fmtClock(w.breakStart)} to ${fmtClock(w.breakEnd)}.`;
      return `A ${label} pickup fits the shift and break rule for ${name}: the ${day} window is ${dutySpan(w)}.`;
    });
    return `${lines.join('\n')}\nOther checks were not run for that time, so this covers the shift and break rule only.`;
  }
  const pickupT = evidence.pickupAt && Number.isFinite(+new Date(evidence.pickupAt))
    ? new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }).format(new Date(evidence.pickupAt))
    : null;
  return figured.map(p => {
    const w = p.scheduleEvidence.dutyWindow;
    const day = DAY_NAMES[Number(w.dayOfWeek)] ?? 'that day';
    return `Yes. The ${day} window for ${pairLabel(p)} is ${dutySpan(w)}${pickupT ? `, and this pickup at ${pickupT} sits inside it` : ''}.`;
  }).join('\n');
}

function otherOptionsAnswer(evidence, pairs) {
  const exclusions = evidence.exclusions ?? [];
  if (!pairs.length) return null;
  const eligible = pairs.slice(0, 2).map(pairLine).join('\n');
  if (!exclusions.length) {
    return pairs.length === 1
      ? `${eligible} This is the only evaluated option, so there is nothing else to compare it against.`
      : eligible;
  }
  const blocked = exclusions.slice(0, 2).map(exclusionLine).join('\n');
  return `${eligible}\nOther evaluated vehicles were excluded:\n${blocked}`;
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
  const name = pairLabel;
  // A named driver ("okay na ba si Karlo?") is answered from the evidence
  // first: the pair line when checked, the exclusion line when skipped, or an
  // honest no-match — never a generic summary wearing the name.
  const named = namedDriverStatus(evidence, question);
  if (named) return named + coverageDisclosure(evidence.coverage);
  // Bounded evidence-only topics; other questions retain the honest general summary.
  // Shift/break policy goes first: a hypothetical like "Would a 12:30 PM
  // pickup be blocked?" also contains "blocked", which would otherwise route
  // it to the generic conflicts answer. None of the eight FM-ADV-001
  // phrasings names a shift, break, lunch, duty hours, or clock time, so
  // their byte-identical verdict is unaffected.
  const hypoClock = /(\d{1,2})(?::(\d{2}))?\s?(AM|PM)/i.exec(question);
  const shiftTopic = /\bshift\b|\bbreak\b|\bduty hours\b|\blunch\b/i.test(question)
    || (hypoClock != null && /\bblock|enforce|allow|fit\b/i.test(question));
  if (pairs.length && shiftTopic) {
    return shiftBreakAnswer(evidence, pairs, question) + coverageDisclosure(evidence.coverage);
  }
  const comparison = /\b(why|better|compare|recommend|workload|fair|buffer)\b|bakit|mas maganda/i.test(question);
  const eta = /\b(eta|arrival|arrive|distance|traffic)\b/i.test(question);
  const conflicts = /\b(conflicts?|blocked|overlap|maintenance|leave)\b/i.test(question);
  if (pairs.length && (comparison || eta || conflicts)) {
    if (conflicts) {
      return pairs.slice(0,2).map(conflictAnswer).join('\n');
    }
    if (eta) {
      return pairs.slice(0,2).map(p => p.livePickupEta
        ? `${name(p)}: live pickup ETA is ${p.livePickupEta.etaMinutes} minutes.`
        : `${name(p)}: live pickup ETA is unavailable.${p.dispatchMode === 'SCHEDULED' ? ' Live tracking does not apply to this advance booking.' : ''}${p.predictedTransfer?.etaMinutes != null ? ` Predicted transfer takes ${p.predictedTransfer.etaMinutes} minutes; this is not a live ETA.` : ''}`
      ).join('\n');
    }
    if (/workload|fair|buffer/i.test(question)) {
      const compared = comparison && !evidence.selection ? evidence.pairs.slice(0,2) : pairs.slice(0,2);
      const planning = compared.some(p=>['FUTURE','SAME_DAY'].includes(p.temporalContext?.horizon));
      const lead = comparison ? (evidence.selection ? pairs[0] : evidence.recommended ? evidence.pairs.find(p=>samePair(p,evidence.recommended)) : null) : null;
      return `${planning ? 'Based on the current schedule. ' : ''}${lead ? decisionReason(lead) : ''}\n${compared.map(p => `${p.scheduleEvidence?.usableSlackMinutes ?? 'Unverified'} minutes of preparation time. ${workloadLine(p)}`).join('\n')}`.trim();
    }
    if (!evidence.selection && comparison) {
      if (pairs.length === 1) {
        const planning = pairs[0].state !== 'BLOCKED' && ['FUTURE', 'SAME_DAY'].includes(pairs[0].temporalContext?.horizon);
        return `${planning ? 'Based on the current schedule. ' : ''}${option ? `Option ${option.option}: ` : ''}${pairLine(pairs[0])}`;
      }
      if (option) return `Option ${option.option}: ${pairLine(pairs[0])}`;
      const preferred = evidence.recommended ? evidence.pairs.find(p=>samePair(p,evidence.recommended)) : evidence.pairs[0];
      const alternative = evidence.pairs.find(p=>!samePair(p,preferred));
      const preferredOption = optionNumberForPair(evidence, preferred, 1);
      const alternativeOption = optionNumberForPair(evidence, alternative, preferredOption === 1 ? 2 : 1);
      const reason = decisionReason(preferred);
      if (alternative && /No clear advantage was verified|no meaningful timing or workload difference/i.test(reason)) {
        const bothPending = preferred.state !== 'ALL_CLEAR' && alternative.state !== 'ALL_CLEAR';
        return `You have not selected an option yet. Option ${preferredOption} is listed first, but no clear advantage over Option ${alternativeOption} was verified. ${bothPending ? 'Both options still need timing verification.' : `${name(alternative)} remains ${pairStatus(alternative).toLowerCase()}.`}`;
      }
      return `You have not selected an option yet. Option ${preferredOption} is currently the stronger fit. ${reason}${alternative ? ` Option ${alternativeOption} remains ${pairStatus(alternative).toLowerCase()}.` : ''}`;
    }
    return pairLine(pairs[0]);
  }
  // The "What needs fixing?" shortcut: lead with whatever blocks or holds each
  // option (pairLine already carries the reason plus one next step), not the
  // generic ranking summary. Placed with the other shortcut branches so the
  // eight FM-ADV-001 phrasings (none of which ask about fixing) keep their
  // byte-identical verdict.
  if (pairs.length && /\bwhat needs fixing\b|\bwhat (?:should|do) (?:i|we) fix\b|\bneeds? (?:to be )?fix(?:ed|ing)?\b/i.test(question)) {
    return fixingAnswer(evidence, pairs) + coverageDisclosure(evidence.coverage);
  }
  // The "Other options?" shortcut: name the eligible pair(s) plus the recorded
  // exclusion reasons, so a single-option evaluation still answers why the
  // rest of the fleet is not offered (RS-UZYD: insurance + license blocks).
  // Placed after the topic branches so the eight FM-ADV-001 phrasings (none of
  // which ask about other options) keep their byte-identical verdict.
  if (pairs.length && /\bother options?\b|\balternatives?\b|\bwhat else\b|\banyone else\b|\bwho else\b/i.test(question)) {
    return otherOptionsAnswer(evidence, pairs) + coverageDisclosure(evidence.coverage);
  }
  const summary = pairs.length
    ? pairs.slice(0,2).map(pairLine).join('\n')
    : reasons.length ? `I couldn't find an eligible option right now. No pair is currently recommended. ${reasons.slice(0,2).map(cleanOperationalText).join(' ')}${evidence.recoveryActions?.[0]?.label ? ` Next step: ${cleanOperationalText(evidence.recoveryActions[0].label)}.` : ''}`
      : 'I couldn\'t verify an eligible option from the current records. Recheck this reservation; this does not prove the fleet is unavailable.';
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
