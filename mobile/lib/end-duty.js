// End Duty nudge timing — pure, so the boundary is testable without a screen.
//
// The window opens `leadMinutes` before the shift ends and STAYS open
// afterwards. A driver who is still checked in past their out-time still owes
// the report; a window that closed itself at the stroke of the hour would hide
// the report from exactly the driver who is running late, and they would have
// no way to end duty cleanly.
//
// `shiftEnd` is the SERVER's roster-derived out-time — "HH:MM:SS" off the TIME
// column, reached via GET /api/mobile/driver/duty → today.duty.end. The client
// deliberately does not derive it: setDuty enforces that same window server
// side, so reading it from the endpoint is what keeps the nudge and the gate
// answering with one computation instead of two that can drift.
const MINUTE_MS = 60_000;

export const END_DUTY_LEAD_MINUTES = 30;

/** "HH:MM" / "HH:MM:SS" → [hours, minutes]; null when it is not a clock time. */
function parseClock(value) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return [hours, minutes];
}

/**
 * @returns {{ due: boolean, minsToEnd: number|null }}
 *   `due` is false when the shift end is unusable — that is the honest answer,
 *   not a guess: with no window there is no basis for telling a driver their
 *   report is owed, and the nudge fails quiet rather than inventing a deadline.
 *   `minsToEnd` is null in that case, negative once the shift end has passed.
 */
export function endDutyWindow({ now, shiftEnd, leadMinutes = END_DUTY_LEAD_MINUTES } = {}) {
  const clock = parseClock(shiftEnd);
  const at = now instanceof Date ? now : new Date(now ?? Date.now());
  if (!clock || Number.isNaN(at.getTime())) return { due: false, minsToEnd: null };

  // Same calendar day as `now`. Overnight spans (start 22:00, end 06:00) are not
  // expressible: the roster stores a pair of TIME columns with no day-crossing
  // flag, and setDuty tests the current time against them the same same-day way
  // — so this inherits the roster's limitation rather than adding one.
  const end = new Date(at);
  end.setHours(clock[0], clock[1], 0, 0);
  const msToEnd = end.getTime() - at.getTime();

  // The predicate is millisecond-exact and `minsToEnd` is rounded only for
  // display ("shift ends in 12 min"). Rounding inside the comparison would move
  // the boundary by up to half a minute in whichever direction it fell, so the
  // 30-minute edge would not be reproducible.
  return {
    due: msToEnd <= leadMinutes * MINUTE_MS,
    minsToEnd: Math.round(msToEnd / MINUTE_MS),
  };
}
