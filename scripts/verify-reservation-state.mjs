// Stage 1 verification — reservation state machine.
//
// Asserts the strict linear chain from migration 016 / the Phase 11 spec:
//   Pending → Under Review → Approved|Rejected → Scheduled → Assigned
//          → In Progress → Completed
// plus terminal locking and Cancelled reachability. Pure logic, no DB.
//
// Run: node --import ./scripts/alias-loader.mjs scripts/verify-reservation-state.mjs
import { RESERVATION_LIFECYCLE as L } from "@/lib/constants";
import {
  canTransitionReservation,
  transitionPath,
  nextStatuses,
  isTerminalReservationStatus,
  isValidReservationStatus,
} from "@/lib/scheduling/reservation-state";

let pass = 0;
const failures = [];

function check(label, condition) {
  if (condition) pass++;
  else failures.push(label);
}

function allows(from, to) {
  return canTransitionReservation(from, to).ok === true;
}

const ALL = Object.values(L);
const TERMINALS = [L.REJECTED, L.COMPLETED, L.CANCELLED];
const NON_TERMINAL = ALL.filter((s) => !TERMINALS.includes(s));

// 1. Vocabulary is exactly the 9 statuses in the DB CHECK.
const EXPECTED = [
  "Pending", "Under Review", "Approved", "Rejected",
  "Scheduled", "Assigned", "In Progress", "Completed", "Cancelled",
];
check(
  `vocabulary is exactly the 9 spec statuses (got ${ALL.length}: ${ALL.join(", ")})`,
  ALL.length === 9 && EXPECTED.every((s) => ALL.includes(s))
);
check("every status validates", ALL.every(isValidReservationStatus));
check("unknown status is rejected", !isValidReservationStatus("Waiting for Fleet Review"));

// 2. The happy path is legal hop by hop.
const HAPPY = [
  L.PENDING, L.UNDER_REVIEW, L.APPROVED, L.SCHEDULED,
  L.ASSIGNED, L.IN_PROGRESS, L.COMPLETED,
];
for (let i = 0; i < HAPPY.length - 1; i++) {
  check(`happy path hop ${HAPPY[i]} → ${HAPPY[i + 1]}`, allows(HAPPY[i], HAPPY[i + 1]));
}
check("Under Review → Rejected", allows(L.UNDER_REVIEW, L.REJECTED));

// 3. The full path resolves end to end and walks every hop (no jumping).
const full = transitionPath(L.PENDING, L.COMPLETED);
check(
  `transitionPath(Pending, Completed) walks all 7 states (got ${full ? full.join(" → ") : "null"})`,
  Array.isArray(full) && full.length === 7 && full.every((s, i) => s === HAPPY[i])
);

// 4. Illegal jumps are refused — the regressions that motivated the rewrite.
//
// Two different questions, so two different assertions per pair:
//   canTransitionReservation = may status go from A to B in ONE hop? Never, here.
//   transitionPath           = is there a legal WALK from A to B? Often yes.
// A forward pair like Pending → Completed is refused as a jump but reachable as
// a walk — that is exactly what advanceReservation() does, stepping each hop
// with its own UPDATE and timeline event. So the invariant is not "no path", it
// is "no *direct* path": a walk must pass through the intermediate states.
// `reach: "walk"` = must be reachable, but only the long way.
// `reach: null`   = not reachable at all (nothing walks backward into Rejected).
const ILLEGAL = [
  [L.PENDING, L.APPROVED, "walk"],       // the jump approve/ used to make
  [L.PENDING, L.SCHEDULED, "walk"],
  [L.PENDING, L.ASSIGNED, "walk"],
  [L.PENDING, L.IN_PROGRESS, "walk"],
  [L.PENDING, L.COMPLETED, "walk"],
  [L.PENDING, L.REJECTED, "walk"],       // must go through review first
  [L.APPROVED, L.IN_PROGRESS, "walk"],
  [L.APPROVED, L.COMPLETED, "walk"],
  [L.APPROVED, L.REJECTED, null],        // reject is a review decision; too late
  [L.UNDER_REVIEW, L.SCHEDULED, "walk"],
  [L.UNDER_REVIEW, L.ASSIGNED, "walk"],
  [L.SCHEDULED, L.IN_PROGRESS, "walk"],
  [L.SCHEDULED, L.COMPLETED, "walk"],
  [L.ASSIGNED, L.COMPLETED, "walk"],
];
for (const [from, to, reach] of ILLEGAL) {
  const gate = canTransitionReservation(from, to);
  check(`refuses ${from} → ${to}`, gate.ok === false && typeof gate.reason === "string");

  const path = transitionPath(from, to);
  if (reach === "walk") {
    check(
      `${from} → ${to} is reachable only as a walk (got ${path ? path.join(" → ") : "null"})`,
      Array.isArray(path) && path.length > 2 && path[0] === from && path[path.length - 1] === to
    );
    // Every hop of the returned walk must itself be legal, or the walker would
    // be laundering an illegal jump through a path that looks well-formed.
    check(
      `every hop of the ${from} → ${to} walk is legal`,
      Array.isArray(path) && path.slice(0, -1).every((s, i) => allows(s, path[i + 1]))
    );
  } else {
    check(`no path ${from} → ${to}`, path === null);
  }
}

// 5. Backward moves are refused.
const BACKWARD = [
  [L.APPROVED, L.PENDING],
  [L.APPROVED, L.UNDER_REVIEW],
  [L.ASSIGNED, L.SCHEDULED],
  [L.IN_PROGRESS, L.ASSIGNED],
  [L.SCHEDULED, L.APPROVED],
];
for (const [from, to] of BACKWARD) {
  check(`refuses backward ${from} → ${to}`, !allows(from, to));
  check(`no backward path ${from} → ${to}`, transitionPath(from, to) === null);
}

// 6. Terminal states are locked in every direction.
for (const terminal of TERMINALS) {
  check(`${terminal} is terminal`, isTerminalReservationStatus(terminal));
  check(`${terminal} has no next statuses`, nextStatuses(terminal).length === 0);
  for (const to of ALL) {
    if (to === terminal) continue;
    check(`${terminal} is locked (→ ${to})`, !allows(terminal, to));
    check(`${terminal} has no path out (→ ${to})`, transitionPath(terminal, to) === null);
  }
}

// 7. Cancelled is reachable from every non-terminal state, in exactly one hop.
for (const from of NON_TERMINAL) {
  check(`Cancelled reachable from ${from}`, allows(from, L.CANCELLED));
  const path = transitionPath(from, L.CANCELLED);
  check(
    `Cancelled is one hop from ${from}`,
    Array.isArray(path) && path.length === 2 && path[0] === from && path[1] === L.CANCELLED
  );
  check(`nextStatuses(${from}) offers Cancelled`, nextStatuses(from).includes(L.CANCELLED));
}

// 8. Same-status is an idempotent no-op (double-clicks must be harmless).
for (const s of ALL) {
  check(`${s} → ${s} is a no-op OK`, allows(s, s));
  const path = transitionPath(s, s);
  check(`${s} → ${s} path is zero hops`, Array.isArray(path) && path.length === 1);
}

// 9. Fresh ingest (no prior status) may set any valid status.
check("no-prior-status allows Pending", allows(null, L.PENDING));
check("invalid target always refused", !allows(null, "Bogus Status"));

// 10. The multi-hop cases the routes actually rely on.
const assignPath = transitionPath(L.APPROVED, L.ASSIGNED);
check(
  `assign walks Approved → Scheduled → Assigned (got ${assignPath ? assignPath.join(" → ") : "null"})`,
  Array.isArray(assignPath) && assignPath.length === 3 && assignPath[1] === L.SCHEDULED
);
const startPath = transitionPath(L.SCHEDULED, L.IN_PROGRESS);
check(
  `trip start walks Scheduled → Assigned → In Progress (got ${startPath ? startPath.join(" → ") : "null"})`,
  Array.isArray(startPath) && startPath.length === 3 && startPath[1] === L.ASSIGNED
);
const approvePath = transitionPath(L.PENDING, L.APPROVED);
check(
  `approve walks Pending → Under Review → Approved (got ${approvePath ? approvePath.join(" → ") : "null"})`,
  Array.isArray(approvePath) && approvePath.length === 3 && approvePath[1] === L.UNDER_REVIEW
);
// Rejection must also route through review rather than jumping.
const rejectPath = transitionPath(L.PENDING, L.REJECTED);
check(
  `reject walks Pending → Under Review → Rejected (got ${rejectPath ? rejectPath.join(" → ") : "null"})`,
  Array.isArray(rejectPath) && rejectPath.length === 3 && rejectPath[1] === L.UNDER_REVIEW
);

console.log(`\nstate machine: ${pass} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("\nFAILURES:");
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log("✓ all reservation state machine assertions hold");
