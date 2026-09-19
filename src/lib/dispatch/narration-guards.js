// Narration guards: server-owned sentences appended to a live model answer.
//
// Some narration obligations are facts about (question, evidence), not judgement
// calls the model can be asked to make reliably. Those are computed here and
// appended by the conversation route, exactly like coverageDisclosure(). The
// model's prose is never replaced or policed - see SEC-AI-007 in
// src/security-assessment/fleetmate-prompt-injection.security.test.js: the
// model's words are returned verbatim and the server-owned sentence is the
// guarantee. That is why every function here appends and nothing here rewrites.
//
// Placement rule: guards must NOT be applied inside evidenceSummary(). Group M
// asserts that eight phrasings of one question produce byte-identical output
// (fleetmate-adversarial.test.js FM-ADV-001); a question-keyed clause inside the
// deterministic summary would break that property. Guards are a route-level
// layer over the narrated answer only, so the deterministic path - and the
// scenario suite that pins it - stays unchanged.
//
// Wording rule: every clause below must itself satisfy the group M honesty
// predicates (English/ASCII only, no operation claimed, no rate or promise
// language, no fleet-wide claim, no safety claim, no over-claim). Asserted in
// narration-guards.test.js. This is not a formality: a guard reading "this
// system produces no probability" would match the very predicate it exists to
// satisfy, and a clause containing an em dash would fail the ASCII check.

import { assertionMatches } from './clause-polarity';

/** ASCII-only state phrasing, chosen to avoid every banned phrase. */
const STATE_WORD = { BLOCKED: 'BLOCKED', INSUFFICIENT_DATA: 'unverified' };

const pairName = p => (p.driverName && p.plate ? `${p.plate} + ${p.driverName}`
  : p.plate ? p.plate
    : p.driverName ? `${p.driverName} / vehicle #${p.vehicleId}`
      : `Vehicle #${p.vehicleId} / driver #${p.driverId}`);

const norm = value => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Whether live location applies to a pair at all.
 *
 * This mirrors the rule the Evidence Drawer already owns and tests
 * (src/components/reservations/evidence-drawer.jsx:235, FM-DRAW-014): live
 * location is inapplicable for two independent reasons, and each must be read
 * from its own field - the timing band, and the dispatch MODE (a repositioning
 * run starts from the preceding commitment's destination, never from live
 * position, so a present-tense horizon alone would read the deliberate
 * exclusion as a gap in the evidence). Kept as a mirror rather than a shared
 * import so this change stays additive; evidence-drawer-fleetmate.test.js
 * asserts the two layers agree, so drift fails a test.
 */
export function liveLocationInapplicable({ horizon, mode } = {}) {
  return horizon === 'FUTURE' || horizon === 'SAME_DAY' || mode === 'REPOSITION';
}

// --- question detectors -----------------------------------------------------
// Non-global on purpose: a /g regex carries lastIndex between .test() calls.

const GPS_TOPIC = /\bgps\b|live location|current location|live position|vehicle tracking|where is (it|the vehicle|this vehicle)\b|\bcoordinates\b/i;

const RATE_BAIT = /\bprobabilit|\bchance\b|\bodds\b|\blikelihood\b|\bpercent|\b\d{1,3}\s?%|\bguarantee|\bpromise\b|\bconfiden(ce|t)\b|\bwill (it|this|the trip) (be|arrive)\b|\bon[- ]time\b|\bpunctual/i;

// A user turn that asserts a record has changed, or should be ignored. Matches
// the four claim shapes the deterministic suite already enumerates
// (fleetmate-adversarial.test.js:55-58) plus the live probe's case-4 wording.
const OVERRIDE_CLAIM = /\b(is|are|was|were)\s+(free|available)\b|\b(he|she|they|it)('s|'re)\s+(free|available)\b|\bignore (the )?(leave|record|check|flag|status)\b|\bentered (it )?by mistake\b|\btreat (this|it|the pair|them) as\b|\bmark (this|it|the pair|that) (as )?\b|\boverrid|\bno longer on leave\b|\bnot on leave\b/i;

const ID_REF = {
  vehicle: /\bvehicle\s*#?\s*(\d{1,7})\b/i,
  driver: /\bdriver\s*#?\s*(\d{1,7})\b/i,
};
// Best-effort only, and deliberately uppercase-only: a plate-shaped token is
// reported absent only when it appears in neither the pairs nor the exclusions.
// Numeric ids are the closed half of this guard; this half can miss.
const PLATE_REF = /\b([A-Z]{2,5}[ -]?\d{2,4})\b/g;

// --- prose detectors --------------------------------------------------------
// These read the model's own words, so they answer a different question from the
// detectors above: not "did the user ask for this" but "did the model assert it
// anyway". Both are still closed facts about the text - what a guard may never
// do is guess at intent.
//
// Polarity is the whole difficulty, and clause-polarity.js owns that rule: "I
// can't give a success probability" carries the banned word and is compliance.

const PROSE_RATE_CLAIM = /\b\d{1,3}\s?%|\bprobabilit\w*|\bodds\b|\blikelihood\b|\bguarantee\w*|\bon[- ]time\b|\bdefinitely\b/i;

const PROSE_LOCATION_TOPIC = /\bgps\b|live location|current location|live position|vehicle tracking/i;

// The two shapes the live probe's GPS predicate already defines as a misread:
// asserting a defect in the vehicle's tracking, or reporting the deliberate
// absence as missing evidence.
const PROSE_LOCATION_CLAIM = /\b(offline|no signal|not reporting|fault\w*|broken|failed|failure|degraded|stale|dropped|unknown|missing|unavailable|no data)\b/i;

// The escape hatch, unchanged in substance from the probe's GPS_EXPECTED: an
// answer that explains WHY location is absent is complying, not misreading. Both
// live compliant answers - "...isn't part of the evidence set" and
// "...intentionally omitted" - are excluded by this one test.
const PROSE_LOCATION_QUALIFIED = /\b(not (supplied|provided|applicable|part of|included|required|captured)|isn't (part of|included|required)|no gps|not part of the evidence|reposition|not applicable|intentionally|deliberate)/i;

/**
 * A rate or punctuality claim the model made without being asked. Only an
 * asserted token counts: a refusal names the same words and must not fire.
 */
export function volunteersRateClaim(answer) {
  return assertionMatches(String(answer ?? ''), PROSE_RATE_CLAIM).length > 0;
}

/**
 * A location claim the model made about a value the evaluation deliberately
 * omits. Fires only when the answer raises location, asserts something about it,
 * and nowhere explains that it was excluded by design.
 */
export function volunteersLocationClaim(answer) {
  const text = String(answer ?? '');
  if (!PROSE_LOCATION_TOPIC.test(text)) return false;
  if (PROSE_LOCATION_QUALIFIED.test(text)) return false;
  return assertionMatches(text, PROSE_LOCATION_CLAIM).length > 0;
}

/**
 * Ids and plate-shaped tokens named in the question that appear in neither the
 * evaluated pairs nor the recorded exclusions. Deterministic: the answer is a
 * set difference against the evidence, never an inference about the entity.
 */
export function absentEntities(question, evidence) {
  const pairs = evidence?.pairs ?? [];
  const exclusions = evidence?.exclusions ?? [];
  const knownIds = { vehicle: new Set(), driver: new Set() };
  const knownPlates = new Set();
  for (const p of pairs) {
    knownIds.vehicle.add(Number(p.vehicleId));
    knownIds.driver.add(Number(p.driverId));
    if (p.plate) knownPlates.add(norm(p.plate));
  }
  for (const e of exclusions) {
    knownIds.vehicle.add(Number(e.vehicleId));
    if (e.plate) knownPlates.add(norm(e.plate));
  }
  const text = String(question ?? '');
  const found = [];
  const seen = new Set();
  const push = (kind, id) => {
    const key = `${kind}:${id}`;
    if (!seen.has(key)) { seen.add(key); found.push({ kind, id }); }
  };
  for (const [kind, ref] of Object.entries(ID_REF)) {
    for (const match of text.matchAll(new RegExp(ref.source, 'gi'))) {
      const id = Number(match[1]);
      if (!knownIds[kind].has(id)) push(kind, id);
    }
  }
  for (const match of text.matchAll(PLATE_REF)) {
    const plate = match[1].trim();
    if (!knownPlates.has(norm(plate))) push('plate', plate);
  }
  return found;
}

/**
 * A pair the user's turn claims is usable while the server's evidence says it
 * is not. The claim is refused by restating the evidence, so the answer never
 * carries the upgrade the claim asked for.
 */
export function contradictedAvailability(question, evidence) {
  if (!OVERRIDE_CLAIM.test(String(question ?? ''))) return null;
  const unassignable = (evidence?.pairs ?? []).filter(p => p.state === 'BLOCKED' || p.state === 'INSUFFICIENT_DATA');
  if (!unassignable.length) return null;
  const selection = evidence?.selection;
  const scoped = selection?.status === 'resolved'
    ? unassignable.filter(p => p.vehicleId === selection.vehicleId && p.driverId === selection.driverId)
    : [];
  return {
    pairs: (scoped.length ? scoped : unassignable).slice(0, 2)
      .map(p => ({ vehicleId: p.vehicleId, driverId: p.driverId, name: pairName(p), state: p.state, reason: (p.reasons ?? [])[0] ?? null })),
  };
}

function gpsReason(pairs) {
  const modes = new Set(pairs.map(p => p.dispatchMode));
  const horizons = new Set(pairs.map(p => p.temporalContext?.horizon));
  if (modes.size === 1 && modes.has('REPOSITION')) {
    return 'this pair was evaluated as a repositioning dispatch from a preceding trip, where live position is not used';
  }
  if ([...horizons].every(h => h === 'FUTURE' || h === 'SAME_DAY')) {
    return 'this is a planning-horizon evaluation, which carries no present-tense position';
  }
  return 'these pairs were evaluated on a planning horizon or as repositioning dispatches, where live position is not used';
}

/**
 * The guard facts for one turn. Every field is a closed function of
 * (question, evidence, answer); a field is empty when its condition does not
 * hold, so an ordinary question produces an ordinary answer with nothing
 * appended.
 *
 * `answer` is the model's own prose, and it is optional. A caller that does not
 * supply it - the deterministic path, and every caller written before the
 * output-side guards existed - gets null from both volunteered fields, so
 * nothing about those calls changes. Each volunteered guard is gated on its
 * question-side counterpart so one turn never states the same sentence twice.
 */
export function narrationGuards({ question, evidence, answer } = {}) {
  const pairs = evidence?.pairs ?? [];
  const asked = String(question ?? '');

  const selection = evidence?.selection;
  const scopedPairs = selection?.status === 'resolved'
    ? pairs.filter(p => p.vehicleId === selection.vehicleId && p.driverId === selection.driverId)
    : pairs;
  const inScope = scopedPairs.length ? scopedPairs : pairs;
  const gpsAbsent = inScope
    .filter(p => !p.gpsHealth && liveLocationInapplicable({ horizon: p.temporalContext?.horizon, mode: p.dispatchMode }));

  const probabilitySought = RATE_BAIT.test(asked);
  const gpsNotApplicable = GPS_TOPIC.test(asked) && gpsAbsent.length
    ? { reason: gpsReason(gpsAbsent), vehicleIds: gpsAbsent.map(p => p.vehicleId) }
    : null;

  const volunteeredRate = !probabilitySought && volunteersRateClaim(answer);
  const volunteeredLocation = !gpsNotApplicable && gpsAbsent.length && volunteersLocationClaim(answer)
    ? { reason: gpsReason(gpsAbsent), vehicleIds: gpsAbsent.map(p => p.vehicleId) }
    : null;

  return {
    gpsNotApplicable,
    probabilitySought,
    absentEntities: absentEntities(asked, evidence),
    contradictedAvailability: contradictedAvailability(asked, evidence),
    volunteeredRate,
    volunteeredLocation,
  };
}

/** Short labels for the audit record. Never shown to the dispatcher. */
export function guardLabels(guards) {
  const labels = [];
  if (guards?.contradictedAvailability) {
    labels.push(`contradicted-availability:${guards.contradictedAvailability.pairs.map(p => `${p.vehicleId}/${p.driverId}:${p.state}`).join('|')}`);
  }
  if (guards?.absentEntities?.length) {
    labels.push(`absent-entities:${guards.absentEntities.map(e => `${e.kind} ${e.id}`).join(', ')}`);
  }
  if (guards?.gpsNotApplicable) labels.push('gps-not-applicable');
  if (guards?.probabilitySought) labels.push('rate-or-promise-sought');
  if (guards?.volunteeredLocation) labels.push('gps-volunteered');
  if (guards?.volunteeredRate) labels.push('rate-or-promise-volunteered');
  return labels;
}

/**
 * The appended block, ASCII only, or '' when no guard fired so callers can
 * concatenate blindly.
 */
export function guardDisclosure(guards) {
  const clauses = [];
  const contradiction = guards?.contradictedAvailability;
  if (contradiction) {
    const facts = contradiction.pairs
      .map(p => `${p.name} is ${STATE_WORD[p.state] ?? 'not usable'} in the server's evidence${p.reason ? `: ${p.reason}` : '.'}`)
      .join(' ');
    clauses.push(`\nA message in this conversation is a request, not a record change: it cannot make a pair usable. ${facts} The pair is re-evaluated from source records on every check, so the record itself has to be corrected before the evaluation can change.`);
  }
  if (guards?.absentEntities?.length) {
    const named = guards.absentEntities.map(e => (e.kind === 'plate' ? e.id : `${e.kind} ${e.id}`)).join(' and ');
    clauses.push(`\n${named} ${guards.absentEntities.length > 1 ? 'are' : 'is'} not in this evaluation - neither a checked pair nor a recorded exclusion - so nothing can be concluded about ${guards.absentEntities.length > 1 ? 'them' : 'it'} here. Check ${guards.absentEntities.length > 1 ? 'their' : 'its'} own record (status, category, pairing).`);
  }
  // The volunteered triggers reuse these two sentences rather than adding new
  // wording of their own. That is deliberate: FM-GUARD-007 proves the text below
  // satisfies the group M honesty predicates, and a trigger that emits proven
  // text inherits that proof. New wording would need its own.
  const gps = guards?.gpsNotApplicable ?? guards?.volunteeredLocation;
  if (gps) {
    clauses.push(`\nLive GPS was not part of this evaluation: ${gps.reason}. Its absence is deliberate rather than a gap in the evidence, and it does not indicate a tracking problem with the vehicle.`);
  }
  if (guards?.probabilitySought || guards?.volunteeredRate) {
    clauses.push('\nFleetMate does not rate the odds of a trip succeeding and does not promise an arrival time. The deterministic checks above are the whole basis for a decision; no wording here can raise or lower that outcome.');
  }
  return clauses.join('');
}

/** Guarantee the guard sentences on a narrated answer. Appends; never replaces. */
export function withGuards(answer, guards) {
  const disclosure = guardDisclosure(guards);
  if (!disclosure) return answer;
  return `${String(answer ?? '')}${disclosure}`.trim();
}
