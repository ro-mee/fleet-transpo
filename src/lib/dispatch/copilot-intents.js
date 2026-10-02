// Phase 3/4/4B — natural-language intent detection for Copilot questions.
// Pure and conservative: returns null unless the question clearly asks for a
// simulation, queue-impact comparison, or return-trip search, so ordinary Q&A
// never changes path. Schema validation and server facts still decide meaning.
export function detectCopilotIntent(message = '') {
  const text = String(message).toLowerCase();
  if (/\bwhat if\b|\bpaano kung\b|\bwhat happens if\b/.test(text)) return { type: 'simulate' };
  if (/affect (other|another) booking|impact on (other|another|the queue)|effect on (other|the) booking|makakaapekto/i.test(text)) return { type: 'impact' };
  if (/return (booking|trip|ride)|find a return|pabalik|connecting booking/i.test(text)) return { type: 'return' };
  return null;
}

export const FLEETMATE_SCOPE_REDIRECT = "I'm focused on FleetOps and transportation operations. I can help with reservations, dispatch, drivers, vehicles, trips, ETA, incidents, or related fleet decisions.";

const FLEETMATE_COURTESY_REPLY = 'Hi. How can I help with this reservation or fleet operation?';
const HISTORY_PAIR_PREFIX = /^\[asked about vehicle #[^/]+ \/ driver #[^\]]+\]\s*/i;
const COURTESY = /^(?:hi|hello|hey|good morning|good afternoon|good evening|thanks?|thank you|salamat|ok(?:ay)?|got it|noted|understood|great)[.!?, ]*$/i;
const CONTEXTUAL_FOLLOW_UP = /^(?:why(?: not)?(?: this (?:pair|option|match))?|what changed|what(?:'s| is) different|compare(?: them| these| those| the options)?|how about (?:the other (?:one|option)|option\s*[12ab])?|what about (?:tomorrow|today|that day|the other one|traffic|weather|gps|eta)|tomorrow|today|bukas|ngayon|can you explain(?: that)?|explain(?: that)?|the other (?:one|option)|is anyone free(?: that day)?|summarize(?: the situation)?(?: in (?:one|two) sentences)?|what (?:do i need to do|i need to do|do i do(?: next)?|should i do(?: next)?)|what(?:'s| is) (?:my )?next step|what next|ano (?:ang )?(?:kailangan kong gawin|kailangan ko gawin|gagawin ko|dapat kong gawin|susunod kong gawin)|anong (?:kailangan kong gawin|kailangan ko gawin|gagawin ko)|what should i check next|sign(?: it)?)[.!?, ]*$/i;
const FLEET_SIGNAL = /\b(?:fleetops?|fleetmate|reservation|bookings?|dispatch|assignment|assign(?:ed|ment)?|drivers?|vehicle|van|car|bus|passenger|pax|seat(?:s|ing)?|capacity|pickup|drop[- ]?off|trip|route|eta|arrival|gps|location|maintenance|incident|compliance|licen[cs]e|verif\w*|registration|insurance|leave|attendance|schedule|availability|available|unavailable|ready|readiness|workload|reassign|replacement|substitute|fairness|options?(?:\s*[12ab])?|pair|match|recommend(?:ation)?|conflicts?|overlap|blocked|queue)\b/i;
// The exact suggestion chips the UI renders (copilot-conversation.jsx
// suggestions). The interface offers these, so each is always a question about
// this reservation — never general knowledge — regardless of history. RS-UZYD
// QA 2026-10-02: three of the five chips redirected on a fresh conversation
// ("conflicts" missed the singular-only signal, bare "options" and "fixing"
// matched nothing), and after an injection-test turn even "Why this option?"
// bricked because context gating blocks every follow-up after unrelated input.
// Exact-match only, so no general question can ride it; unrelated-task routing
// above still runs first.
const SUGGESTION_CHIPS = new Set([
  'why this option',
  'any conflicts',
  'other options',
  'why no match',
  'what needs fixing',
]);
function isSuggestionChip(value) {
  return SUGGESTION_CHIPS.has(normalizeScopeText(value).toLowerCase().replace(/[.?!]+$/, '').trim());
}
// A named person the dispatcher is asking about ("okay na ba si karlo?",
// "kamusta si Jack?", "is Karlo verified?"). The classifier cannot resolve
// the name — that happens against server evidence later — but a person
// reference plus a status word is a question about this reservation's people,
// never general knowledge. Gated on conversation context like other
// follow-ups, so a cold "si karlo" with nothing to resolve against still
// stays out of scope.
const PERSON_MARKER = /\b(?:si|ni|kay|kina)\s+[a-zà-ÿ][a-zà-ÿ'’.~-]*|\bdriver\s+[a-zà-ÿ][a-zà-ÿ'’.~-]*/i;
// Bare check-ins that only make sense as a follow-up ("okay na ba?", "ok na?",
// "kamusta?"). Meaningless without context, so they need it.
const STATUS_CHECK_IN = /^(?:ok(?:ay)?|goods?|pwede(?: na)?|kamusta(?: na)?|ayos(?: na)?|all good\??)(?:\s+(?:na(?: ba)?|ba|pa))?[.?! ]*$/i;
const UNRELATED_TASK = [
  /^(?:recommend|suggest|what|which)\s+(?:a\s+)?(?:movie|film|show|game|song)\b/i,
  /\bwho\s+should\s+i\s+vote\s+for\b/i,
  /\bsolve\s+(?:my\s+)?(?:calculus|math|homework|assignment)\b/i,
  /^(?:write|generate|debug|fix|explain|teach(?:\s+me)?)\b[\s\S]*\b(?:code|program|python|javascript|sql)\b/i,
  /\b(?:general\s+)?(?:programming|coding)(?:\s+(?:help|question|assignment|project))?\b/i,
  /\b(?:what(?:'s| is)\s+)?the\s+capital\s+of\b/i,
  /\b(?:recipe|random trivia|celebrity|politics|current events|gaming)\b/i,
];

function normalizeScopeText(value) {
  return String(value ?? '').replace(HISTORY_PAIR_PREFIX, '').replace(/\s+/g, ' ').trim();
}

function isCourtesy(value) {
  return COURTESY.test(normalizeScopeText(value));
}

function isUnrelatedTask(value) {
  const text = normalizeScopeText(value);
  return UNRELATED_TASK.some(pattern => pattern.test(text));
}

function isFleetQuestion(value) {
  return FLEET_SIGNAL.test(normalizeScopeText(value));
}

function lastMeaningfulUserTurn(history = []) {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.role !== 'user') continue;
    const text = normalizeScopeText(history[i].content);
    if (text && !isCourtesy(text)) return text;
  }
  return '';
}

function isPersonFollowUp(value) {
  const text = normalizeScopeText(value);
  // A bare name with context ("si Jack?", "driver Karlo") is a follow-up
  // about this reservation's people; with a status word it is even clearer.
  // Without context there is nothing to resolve the name against.
  return PERSON_MARKER.test(text) || STATUS_CHECK_IN.test(text);
}

function hasFleetConversationContext(history = []) {
  let active = false;
  for (const turn of history) {
    if (turn?.role !== 'user') continue;
    const text = normalizeScopeText(turn.content);
    if (!text || isCourtesy(text)) continue;
    if (isUnrelatedTask(text)) {
      active = false;
    } else if (isFleetQuestion(text)) {
      active = true;
    } else if (isPersonFollowUp(text)) {
      // A name/status follow-up rides on existing context — it neither
      // creates it (nothing to resolve against) nor destroys it.
    } else if (!CONTEXTUAL_FOLLOW_UP.test(text)) {
      active = false;
    }
  }
  return active;
}

/** Scope routing never reads or changes operational evidence or state. */
export function classifyCopilotScope(message = '', history = [], { hasActiveContext = false } = {}) {
  const text = normalizeScopeText(message);
  if (isCourtesy(text)) return { kind: 'courtesy' };
  if (isUnrelatedTask(text)) return { kind: 'out-of-scope' };
  if (isSuggestionChip(text)) return { kind: 'in-scope' };
  if (isFleetQuestion(text)) return { kind: 'in-scope' };

  const priorContext = hasFleetConversationContext(history);
  const lastUser = lastMeaningfulUserTurn(history);
  const contextAllowed = priorContext || (hasActiveContext && !isUnrelatedTask(lastUser) &&
    (!lastUser || isFleetQuestion(lastUser) || CONTEXTUAL_FOLLOW_UP.test(lastUser)));
  if (CONTEXTUAL_FOLLOW_UP.test(text) && contextAllowed) return { kind: 'in-scope' };
  // "Okay na ba si Karlo?" — a person reference, or a bare check-in, is a
  // follow-up about this reservation's people. Without context there is
  // nothing to resolve the name against, so it stays out.
  if (isPersonFollowUp(text) && contextAllowed && !isUnrelatedTask(text)) return { kind: 'in-scope' };
  return { kind: 'out-of-scope' };
}

export function copilotCourtesyReply() {
  return FLEETMATE_COURTESY_REPLY;
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

function parseTimeOfDay(text) {
  // "7 PM", "7:30pm", "19:00", "7am"
  const m12 = /(\b1[0-2]|\b[1-9])(?::([0-5]\d))?\s*(am|pm)\b/.exec(text);
  if (m12) {
    let h = Number(m12[1]) % 12;
    if (m12[3] === 'pm') h += 12;
    return { hour: h, minute: Number(m12[2] ?? 0) };
  }
  const m24 = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text);
  if (m24) return { hour: Number(m24[1]), minute: Number(m24[2]) };
  return null;
}

function parseDateRef(text, now = new Date()) {
  const lower = String(text).toLowerCase();
  if (/\btomorrow\b|\bbukas\b/.test(lower)) {
    const d = new Date(now.getTime() + 24 * 3600_000);
    return partsInManila(d);
  }
  if (/\btoday\b|\bngayon\b/.test(lower)) return partsInManila(now);
  const m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/.exec(lower);
  if (m) {
    const year = new Date(now).getFullYear();
    return { year, month: MONTHS[m[1]], day: Number(m[2]) };
  }
  return null;
}

function partsInManila(date) {
  // Calendar parts in Asia/Manila without locale-string parsing.
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' });
  const [y, mo, d] = fmt.format(date).split('-').map(Number);
  return { year: y, month: mo - 1, day: d };
}

function manilaISO({ year, month, day }, { hour, minute }) {
  const pad = n => String(n).padStart(2, '0');
  return `${year}-${pad(month + 1)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+08:00`;
}

// Extracts an allowlisted scenario from free text. Never guesses a date:
// time without date yields needsClarification:'date'.
export function parseSimulationScenario(message = '', { now = new Date() } = {}) {
  const text = String(message).toLowerCase();
  const time = parseTimeOfDay(text);
  const date = parseDateRef(text, now);
  const pax = /(?:for\s+)?(\d{1,2})\s*(?:passengers?|pax|persons?|tao)\b/.exec(text);
  const passenger_count = pax ? Number(pax[1]) : null;
  if (!time && passenger_count == null) return null;
  if (time && !date) return { needsClarification: 'date', passenger_count };
  return {
    pickup_datetime: time && date ? manilaISO(date, time) : null,
    passenger_count: passenger_count != null && passenger_count >= 1 && passenger_count <= 60 ? passenger_count : null,
  };
}
