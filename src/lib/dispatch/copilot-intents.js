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
const CONTEXTUAL_FOLLOW_UP = /^(?:why(?: not)?(?: this (?:pair|option|match))?|what changed|what(?:'s| is) different|compare(?: them| these| those| the options)?|how about (?:the other (?:one|option)|option\s*[12ab])?|what about (?:tomorrow|today|that day|the other one|traffic|weather|gps|eta)|tomorrow|today|bukas|ngayon|can you explain(?: that)?|explain(?: that)?|the other (?:one|option)|is anyone free(?: that day)?|summarize(?: the situation)?(?: in (?:one|two) sentences)?|what should i check next|sign(?: it)?)[.!?, ]*$/i;
const FLEET_SIGNAL = /\b(?:fleetops?|fleetmate|reservation|bookings?|dispatch|assignment|assign(?:ed|ment)?|driver|vehicle|van|car|bus|passenger|pax|seat(?:s|ing)?|capacity|pickup|drop[- ]?off|trip|route|eta|arrival|gps|location|maintenance|incident|compliance|licen[cs]e|registration|insurance|leave|attendance|schedule|availability|available|unavailable|ready|readiness|workload|reassign|replacement|substitute|fairness|option\s*[12ab]|pair|match|recommend(?:ation)?|conflict|overlap|blocked|queue)\b/i;
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
  if (isFleetQuestion(text)) return { kind: 'in-scope' };

  const priorContext = hasFleetConversationContext(history);
  const lastUser = lastMeaningfulUserTurn(history);
  const contextAllowed = priorContext || (hasActiveContext && !isUnrelatedTask(lastUser) &&
    (!lastUser || isFleetQuestion(lastUser) || CONTEXTUAL_FOLLOW_UP.test(lastUser)));
  return CONTEXTUAL_FOLLOW_UP.test(text) && contextAllowed
    ? { kind: 'in-scope' }
    : { kind: 'out-of-scope' };
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
