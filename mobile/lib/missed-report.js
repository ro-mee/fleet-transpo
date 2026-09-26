// The prompt for a duty day that still owes an End Duty report.
//
// The server decides WHETHER (it returns `unreported`, non-null only for a past
// day that owes one). This module only decides how to say it. Two pieces of copy
// are load-bearing:
//
//   - The title names the day. "You forgot to report" without a date is a
//     question the driver cannot answer, because they do not know which shift
//     is being asked about.
//   - The body never says "end your shift". By the time most drivers see this
//     the sweep has already closed the row, so the shift IS ended. An action
//     label that contradicts the record is exactly the kind of small lie the
//     End Duty screen was built to avoid.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** 'YYYY-MM-DD' → 'September 23'. Parsed by hand, not by Date: `new Date('2026-09-23')`
 *  is UTC midnight, which is the previous day west of Greenwich, and a prompt
 *  naming the wrong day is worse than no prompt. */
function longDay(date) {
  const [, month, day] = String(date).split("-").map(Number);
  if (!month || !day) return String(date);
  return `${MONTHS[month - 1]} ${day}`;
}

export function plateLabel(plateNumber) {
  return plateNumber || "the vehicle on that day's check";
}

export function missedReportCopy(unreported) {
  if (!unreported?.date) return null;
  const when = longDay(unreported.date);
  return {
    title: `You didn't file a report for ${when}`,
    body: `Your shift for ${when} was closed without one. You drove ${plateLabel(unreported.plateNumber)} that day — if you noticed anything wrong with it, say so now and it goes to the maintenance team. Answering "nothing unusual" is fine too.`,
    ctaLabel: "File that report",
  };
}

export function lateReportHref(date) {
  return `/end-duty?reportFor=${date}`;
}
