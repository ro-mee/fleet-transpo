// Phase 16 verification — the calendar's pure core.
//
// The calendar detects conflicts client-side while the dispatch INSERT enforces
// them server-side. If those two rules disagree, the calendar either cries wolf
// or hides a real double-booking. These assertions pin the shared rule.
//
// Run: node --import ./scripts/route-harness-loader.mjs scripts/verify-calendar.mjs

import {
  CALENDAR_VIEW,
  dayPosition,
  dispatchToEvent,
  downtimeToEvent,
  findOverlaps,
  leaveToEvent,
  maintenanceToEvent,
  onDay,
  overlaps,
  packColumns,
  rangeFor,
  shiftAnchor,
} from "../src/lib/scheduling/calendar.js";

let pass = 0;
let fail = 0;

function check(label, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(name) {
  console.log(`\n${name}`);
}

const iso = (d, h, m = 0) => new Date(2026, 7, d, h, m).toISOString();

// ---------------------------------------------------------------------------
section("1. Half-open overlap matches findDispatchConflicts SQL");

const a = { start: new Date(2026, 7, 3, 9), end: new Date(2026, 7, 3, 10) };
const b = { start: new Date(2026, 7, 3, 10), end: new Date(2026, 7, 3, 11) };
const c = { start: new Date(2026, 7, 3, 9, 30), end: new Date(2026, 7, 3, 10, 30) };

check("back-to-back trips do not conflict", !overlaps(a, b));
check("straddling trips conflict", overlaps(a, c));
check("overlap is symmetric", overlaps(c, a) === overlaps(a, c));
check("a window never conflicts with a gap after it", !overlaps(a, { start: b.end, end: new Date(2026, 7, 3, 12) }));

// ---------------------------------------------------------------------------
section("2. Dispatch normalization");

const noArrival = dispatchToEvent({
  dispatch_id: 1,
  dispatch_number: "DSP-1",
  status: "Scheduled",
  scheduled_departure: iso(3, 9),
  scheduled_arrival: null,
  vehicle_id: 7,
  driver_id: 4,
});

check("missing arrival still yields a non-zero block", noArrival.end > noArrival.start);
check(
  "nominal body is 60 minutes",
  (noArrival.end - noArrival.start) / 60000 === 60,
  `${(noArrival.end - noArrival.start) / 60000}m`
);
check("scheduled dispatch holds its resources", noArrival.holdsResource === true);
check("dispatch links to its detail page", noArrival.href === "/dispatch/1");

const cancelled = dispatchToEvent({
  dispatch_id: 2,
  status: "Cancelled",
  scheduled_departure: iso(3, 9),
  scheduled_arrival: iso(3, 11),
  vehicle_id: 7,
});
check("cancelled dispatch releases its resources", cancelled.holdsResource === false);
check("cancelled dispatch is still drawn", cancelled.start instanceof Date);

check(
  "a dispatch with no departure is dropped rather than drawn at epoch",
  dispatchToEvent({ dispatch_id: 3, scheduled_departure: null }) === null
);

// ---------------------------------------------------------------------------
section("3. Cancelled dispatches are excluded from conflict detection");

const shared = [
  dispatchToEvent({
    dispatch_id: 10,
    status: "Scheduled",
    scheduled_departure: iso(3, 9),
    scheduled_arrival: iso(3, 12),
    vehicle_id: 7,
    driver_id: 4,
  }),
  dispatchToEvent({
    dispatch_id: 11,
    status: "Cancelled",
    scheduled_departure: iso(3, 10),
    scheduled_arrival: iso(3, 11),
    vehicle_id: 7,
    driver_id: 4,
  }),
];

check("a cancelled overlap raises no conflict", findOverlaps(shared).size === 0);

const doubleBooked = [
  shared[0],
  dispatchToEvent({
    dispatch_id: 12,
    status: "Scheduled",
    scheduled_departure: iso(3, 10),
    scheduled_arrival: iso(3, 11),
    vehicle_id: 7,
    driver_id: 9,
  }),
];
const dbConflicts = findOverlaps(doubleBooked);
check("a real double-booking is flagged", dbConflicts.size === 2, `size=${dbConflicts.size}`);
check("both participants are flagged", dbConflicts.has("dispatch-10") && dbConflicts.has("dispatch-12"));
check(
  "the shared vehicle is named as the reason",
  dbConflicts.get("dispatch-10")[0].reason === "Double-booked vehicle",
  dbConflicts.get("dispatch-10")[0].reason
);

// ---------------------------------------------------------------------------
section("4. Dispatch over maintenance / leave / downtime");

const overMaintenance = [
  dispatchToEvent({
    dispatch_id: 20,
    status: "Scheduled",
    scheduled_departure: iso(5, 9),
    scheduled_arrival: iso(5, 12),
    vehicle_id: 7,
  }),
  maintenanceToEvent({
    maintenance_id: 1,
    vehicle_id: 7,
    maintenance_type: "Routine",
    maintenance_date: "2026-08-05",
    completed_date: null,
    status: "Scheduled",
  }),
];
const maintConflicts = findOverlaps(overMaintenance);
check("dispatch during maintenance is flagged", maintConflicts.has("dispatch-20"));
check(
  "maintenance conflict reads as unavailability, not double-booking",
  maintConflicts.get("dispatch-20")[0].reason === "Vehicle unavailable",
  maintConflicts.get("dispatch-20")?.[0]?.reason
);

const openMaint = maintenanceToEvent({
  maintenance_id: 2,
  vehicle_id: 8,
  maintenance_date: "2026-08-05",
  completed_date: null,
});
check(
  "an open maintenance record covers its own day only",
  onDay(openMaint, new Date(2026, 7, 5)) && !onDay(openMaint, new Date(2026, 7, 6))
);

// DATE columns must be read as LOCAL midnight. `new Date("2026-08-05")` is UTC
// midnight, which at a negative offset is 4 August locally — the window would
// render a day early and the dispatch it should collide with would look clear.
// lib/dates.js documents this trap; toLocalDay() is what avoids it here.
const dateStringMaint = maintenanceToEvent({
  maintenance_id: 3,
  vehicle_id: 9,
  maintenance_date: "2026-08-05",
  completed_date: "2026-08-05",
});
check(
  "a DATE string lands on its own local day",
  onDay(dateStringMaint, new Date(2026, 7, 5)),
  `start=${dateStringMaint.start}`
);
check(
  "a DATE string does not bleed into the previous day",
  !onDay(dateStringMaint, new Date(2026, 7, 4))
);
check(
  "a DATE string does not bleed into the next day",
  !onDay(dateStringMaint, new Date(2026, 7, 6))
);

// pg may hand back a Date pinned to local midnight instead of a string; both
// shapes must resolve to the same day.
const dateObjMaint = maintenanceToEvent({
  maintenance_id: 4,
  vehicle_id: 9,
  maintenance_date: new Date(2026, 7, 5),
  completed_date: null,
});
check(
  "a Date object and a DATE string agree on the day",
  dateObjMaint.start.getTime() === dateStringMaint.start.getTime()
);

const leaveDay = leaveToEvent({ attendance_id: 9, driver_id: 1, date: "2026-08-07", status: "On Leave" });
check(
  "driver leave lands on its own local day",
  onDay(leaveDay, new Date(2026, 7, 7)) && !onDay(leaveDay, new Date(2026, 7, 6))
);

const overLeave = [
  dispatchToEvent({
    dispatch_id: 21,
    status: "Scheduled",
    scheduled_departure: iso(6, 9),
    scheduled_arrival: iso(6, 12),
    driver_id: 4,
  }),
  leaveToEvent({ attendance_id: 1, driver_id: 4, date: "2026-08-06", status: "On Leave" }),
];
const leaveConflicts = findOverlaps(overLeave);
check("dispatch during driver leave is flagged", leaveConflicts.has("dispatch-21"));
check(
  "driver leave conflict names the driver",
  leaveConflicts.get("dispatch-21")[0].reason === "Driver unavailable"
);

const downtime = downtimeToEvent({
  kind: "vehicle",
  id: 7,
  label: "ABC-123 · Under Maintenance",
  start: new Date(2026, 7, 3),
  end: new Date(2026, 7, 9),
});
const overDowntime = findOverlaps([
  dispatchToEvent({
    dispatch_id: 22,
    status: "Scheduled",
    scheduled_departure: iso(4, 9),
    scheduled_arrival: iso(4, 12),
    vehicle_id: 7,
  }),
  downtime,
]);
check("dispatch during standing downtime is flagged", overDowntime.has("dispatch-22"));

// ---------------------------------------------------------------------------
section("5. Unrelated resources never collide");

const different = findOverlaps([
  dispatchToEvent({
    dispatch_id: 30,
    status: "Scheduled",
    scheduled_departure: iso(3, 9),
    scheduled_arrival: iso(3, 12),
    vehicle_id: 1,
    driver_id: 1,
  }),
  dispatchToEvent({
    dispatch_id: 31,
    status: "Scheduled",
    scheduled_departure: iso(3, 9),
    scheduled_arrival: iso(3, 12),
    vehicle_id: 2,
    driver_id: 2,
  }),
]);
check("simultaneous trips on different resources do not conflict", different.size === 0);

const unassigned = findOverlaps([
  dispatchToEvent({ dispatch_id: 32, status: "Scheduled", scheduled_departure: iso(3, 9), scheduled_arrival: iso(3, 12) }),
  dispatchToEvent({ dispatch_id: 33, status: "Scheduled", scheduled_departure: iso(3, 9), scheduled_arrival: iso(3, 12) }),
]);
check("two unassigned dispatches do not conflict with each other", unassigned.size === 0);

// ---------------------------------------------------------------------------
section("6. Ranges and navigation");

const anchor = new Date(2026, 7, 5); // Wed 5 Aug 2026
const day = rangeFor(CALENDAR_VIEW.DAY, anchor);
const week = rangeFor(CALENDAR_VIEW.WEEK, anchor);
const month = rangeFor(CALENDAR_VIEW.MONTH, anchor);

check("day view spans one day", day.days.length === 1);
check("week view spans seven days", week.days.length === 7, `${week.days.length}`);
check("week starts on Monday", week.days[0].getDay() === 1);
check("month view is whole weeks", month.days.length % 7 === 0, `${month.days.length}`);
check("month view covers the whole month", month.start <= new Date(2026, 7, 1) && month.end >= new Date(2026, 7, 31));

check("stepping a week moves seven days", Math.round((shiftAnchor(CALENDAR_VIEW.WEEK, anchor, 1) - anchor) / 86400000) === 7);
check("stepping back a day moves one day", Math.round((anchor - shiftAnchor(CALENDAR_VIEW.DAY, anchor, -1)) / 86400000) === 1);
check("stepping a month lands in September", shiftAnchor(CALENDAR_VIEW.MONTH, anchor, 1).getMonth() === 8);

// ---------------------------------------------------------------------------
section("7. Layout: midnight-crossing and side-by-side packing");

const overnight = dispatchToEvent({
  dispatch_id: 40,
  status: "Scheduled",
  scheduled_departure: iso(3, 22),
  scheduled_arrival: iso(4, 2),
  vehicle_id: 5,
});

const firstDay = dayPosition(overnight, new Date(2026, 7, 3));
const secondDay = dayPosition(overnight, new Date(2026, 7, 4));

check("a midnight-crossing trip stays inside day one", firstDay.top + firstDay.height <= 100.01, `${firstDay.top + firstDay.height}`);
check("it is marked as continuing past day one", firstDay.continuesAfter === true);
check("it starts at the top of day two", secondDay.top === 0);
check("it is marked as continuing from before on day two", secondDay.continuesBefore === true);
check("it appears on both days", onDay(overnight, new Date(2026, 7, 3)) && onDay(overnight, new Date(2026, 7, 4)));

const packed = packColumns([
  { id: "x", start: new Date(2026, 7, 3, 9), end: new Date(2026, 7, 3, 11) },
  { id: "y", start: new Date(2026, 7, 3, 10), end: new Date(2026, 7, 3, 12) },
]);
check("two overlapping blocks are placed side by side", packed[0].leftPct !== packed[1].leftPct);
check("overlapping blocks each take half the width", packed.every((p) => Math.round(p.widthPct) === 50));

const sequential = packColumns([
  { id: "x", start: new Date(2026, 7, 3, 9), end: new Date(2026, 7, 3, 10) },
  { id: "y", start: new Date(2026, 7, 3, 10), end: new Date(2026, 7, 3, 11) },
]);
check("sequential blocks reuse one full-width column", sequential.every((p) => p.widthPct === 100));

// ---------------------------------------------------------------------------
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
