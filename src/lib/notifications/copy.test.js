import { describe, it, expect } from "vitest";
import {
  incidentUnderReview,
  incidentAcknowledged,
  incidentResolvedByStaff,
  incidentResolvedByResponder,
  vehicleRepaired,
  helpResponding,
  helpEnRoute,
  helpArrived,
  helpNewEta,
  responderAssignedResponder,
  responderAssignedReporter,
  driverAutoSuspendedDriver,
  driverAutoSuspendedStaff,
  driverReinstatedDriver,
  driverReinstatedStaff,
  tripStartWindowOpen,
  timeToHeadToPickup,
  tripNotStartedDriver,
  tripNotStartedStaff,
} from "./copy";

// Every driver-facing variant. Staff variants are exercised separately —
// they are allowed to use staff vocabulary.
const DRIVER_CASES = [
  ["incidentUnderReview", incidentUnderReview, { incidentTypeLabel: "Vehicle Breakdown", incidentId: 47 }],
  ["incidentAcknowledged", incidentAcknowledged, { incidentId: 47, note: "Tow truck requested." }],
  ["incidentResolvedByStaff", incidentResolvedByStaff, { incidentId: 47, actions: "Tire replaced" }],
  ["incidentResolvedByResponder", incidentResolvedByResponder, { responderName: "Juan Dela Cruz", incidentId: 47, note: "Tire replaced" }],
  ["vehicleRepaired", vehicleRepaired, { incidentId: 47, plate: "ABC 1234" }],
  ["helpResponding en route", helpResponding, { responseLabel: "Tow Truck", status: "En Route", etaMinutes: 8 }],
  ["helpResponding arrived", helpResponding, { responseLabel: "Tow Truck", status: "Arrived" }],
  ["helpEnRoute", helpEnRoute, { responderName: "Juan Dela Cruz", etaMinutes: 8 }],
  ["helpArrived", helpArrived, { responderName: "Juan Dela Cruz" }],
  ["helpNewEta", helpNewEta, { responderName: "Juan Dela Cruz", etaMinutes: 12 }],
  ["responderAssignedResponder", responderAssignedResponder, { driverName: "Maria Clara", location: "NAIA Terminal 2", etaMinutes: 15 }],
  ["responderAssignedReporter", responderAssignedReporter, { responderName: "Juan Dela Cruz", etaMinutes: 15 }],
  ["driverAutoSuspendedDriver", driverAutoSuspendedDriver, { expiry: "2026-01-01" }],
  ["driverReinstatedDriver", driverReinstatedDriver, {}],
  ["tripStartWindowOpen", tripStartWindowOpen, { pickup: "2026-09-09T02:30:00.000Z", etaMinutes: 12 }],
  ["timeToHeadToPickup", timeToHeadToPickup, { pickup: "2026-09-09T02:30:00.000Z", etaMinutes: 12 }],
  ["tripNotStartedDriver", tripNotStartedDriver, { pickup: "2026-09-09T02:30:00.000Z" }],
];

const ALL_CASES = [
  ...DRIVER_CASES,
  ["driverAutoSuspendedStaff", driverAutoSuspendedStaff, { name: "Juan Dela Cruz", expiry: "2026-01-01" }],
  ["driverReinstatedStaff", driverReinstatedStaff, { name: "Juan Dela Cruz" }],
  ["tripNotStartedStaff", tripNotStartedStaff, { driverName: "Juan Dela Cruz", pickup: "2026-09-09T02:30:00.000Z" }],
];

describe("copy module — structural invariants (all variants)", () => {
  it.each(ALL_CASES)("%s returns non-empty title, message and pushBody", (_name, fn, params) => {
    const out = fn(params);
    for (const field of ["title", "message", "pushBody"]) {
      expect(typeof out[field], field).toBe("string");
      expect(out[field].trim().length, field).toBeGreaterThan(0);
    }
  });

  it.each(ALL_CASES)("%s stays inside the column / push length limits", (_name, fn, params) => {
    const out = fn(params);
    // notifications.title is varchar(200), message varchar(1000); pushBody is
    // a push body — OS truncation makes anything past ~120 chars invisible.
    expect(out.title.length).toBeLessThanOrEqual(200);
    expect(out.message.length).toBeLessThanOrEqual(1000);
    expect(out.pushBody.length).toBeLessThanOrEqual(120);
  });

  it.each(ALL_CASES)("%s has no newline characters", (_name, fn, params) => {
    const out = fn(params);
    for (const field of ["title", "message", "pushBody"]) {
      expect(out[field], field).not.toMatch(/[\r\n]/);
    }
  });

  it.each(ALL_CASES)("%s never leaks raw snake_case values", (_name, fn, params) => {
    const out = fn(params);
    for (const field of ["title", "message", "pushBody"]) {
      // incident_type/status vocabularies are snake_case ("near_miss");
      // drivers must only ever see the human label.
      expect(out[field], field).not.toMatch(/[a-z]_[a-z]/);
    }
  });
});

describe("copy module — titles are stable event names", () => {
  // Dedupe in sla.js/maintenance.js keys on (employee_id, title, reference),
  // and mobile icons key off type/reference_type — a title that varies with
  // data breaks both. Same event + different data must produce the same title.
  const TITLE_VARIANTS = {
    incidentUnderReview: [
      [{ incidentTypeLabel: "Vehicle Breakdown", incidentId: 1 }],
      [{ incidentTypeLabel: "Near Miss", incidentId: 999999 }],
      [{ incidentId: 5 }], // missing label degrades, does not change the title
    ],
    incidentResolvedByResponder: [
      [{ responderName: "Juan Dela Cruz", incidentId: 1, note: "x" }],
      [{ responderName: "Someone Else", incidentId: 2 }],
    ],
    helpResponding: [
      [{ responseLabel: "Tow Truck", status: "En Route", etaMinutes: 8 }],
      [{ responseLabel: "Fleet Vehicle", status: "Arrived" }],
      [{ status: "Dispatched" }],
    ],
    responderAssignedResponder: [
      [{ driverName: "Maria Clara", location: "NAIA", etaMinutes: 15 }],
      [{ driverName: "Pedro", location: null }],
      [{}],
    ],
    driverAutoSuspendedDriver: [
      [{ expiry: "2026-01-01" }],
      [{}],
    ],
  };

  it.each(Object.entries(TITLE_VARIANTS))("%s keeps one title across data variants", (name, variants) => {
    const titles = new Set(variants.map((params) => name.includes("incidentUnderReview") ? incidentUnderReview(params).title
      : name === "incidentResolvedByResponder" ? incidentResolvedByResponder(params).title
      : name === "helpResponding" ? helpResponding(params).title
      : name === "responderAssignedResponder" ? responderAssignedResponder(params).title
      : driverAutoSuspendedDriver(params).title));
    expect(titles.size).toBe(1);
  });

  it("no title contains an ID, a name, a date, or interpolation debris", () => {
    for (const [_name, fn, params] of ALL_CASES) {
      const title = fn(params).title;
      expect(title).not.toMatch(/#\d|\d{4}-\d{2}-\d{2}|\$\{|undefined|null/);
    }
  });
});

describe("copy module — driver variants use driver vocabulary", () => {
  // Phrases that only make sense to staff (or are instructions TO staff about
  // the driver) must never reach the driver's own notification.
  const STAFF_ONLY_PATTERNS = [
    /\breinstat/i,
    /\breassign/i,
    /their profile/i,
    /compliance suspension/i,
    /automatically suspended/i,
  ];

  it.each(DRIVER_CASES)("%s carries no staff-only wording", (name, fn, params) => {
    const out = fn(params);
    for (const field of ["title", "message", "pushBody"]) {
      for (const pattern of STAFF_ONLY_PATTERNS) {
        expect(out[field], `${name}.${field} must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  // Drivers never see incident numbers ("report #47") — the notification's
  // reference_id deep-links to the incident instead. The cases deliberately
  // pass incidentId: 47 to prove it is dropped from the wording.
  it.each(DRIVER_CASES)("%s never shows an incident number", (name, fn, params) => {
    const out = fn(params);
    for (const field of ["title", "message", "pushBody"]) {
      expect(out[field], `${name}.${field}`).not.toMatch(/#\d/);
    }
  });

  // Dates read as words, never ISO ("2026-01-01").
  it.each(DRIVER_CASES)("%s shows no ISO dates", (name, fn, params) => {
    const out = fn(params);
    for (const field of ["title", "message", "pushBody"]) {
      expect(out[field], `${name}.${field}`).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });
});

describe("copy module — dates read as words", () => {
  it("driverAutoSuspendedDriver spells out the expiry date", () => {
    const out = driverAutoSuspendedDriver({ expiry: "2026-01-01" });
    expect(out.message).toContain("January 1, 2026");
    expect(out.message).not.toContain("2026-01-01");
  });

  it("driverAutoSuspendedStaff spells out the expiry date", () => {
    const out = driverAutoSuspendedStaff({ name: "Juan Dela Cruz", expiry: "2026-01-01" });
    expect(out.message).toContain("January 1, 2026");
    expect(out.pushBody).toContain("January 1, 2026");
    expect(out.pushBody).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("timestamps with time components keep the calendar date", () => {
    const out = driverAutoSuspendedDriver({ expiry: "2025-12-31T16:30:00.000Z" });
    expect(out.message).toContain("December 31, 2025");
  });

  it("an unparseable expiry falls back instead of printing Invalid Date", () => {
    const out = driverAutoSuspendedDriver({ expiry: "not-a-date" });
    expect(out.message).toContain("not-a-date");
    expect(out.message).not.toContain("Invalid");
  });
});

describe("copy module — missing optional data still reads naturally", () => {
  const hasDebris = (s) => /undefined|null|\$\{|NaN/.test(s) || /—\s*[,.]/.test(s) || /\(\s*\)|:\s*[.—]/.test(s) || /\s{2,}/.test(s);

  it("every function tolerates empty params", () => {
    const outputs = [
      incidentUnderReview({}),
      incidentAcknowledged({}),
      incidentResolvedByStaff({}),
      incidentResolvedByResponder({}),
      vehicleRepaired({}),
      helpResponding({}),
      helpEnRoute({}),
      helpArrived({}),
      helpNewEta({}),
      responderAssignedResponder({}),
      responderAssignedReporter({}),
      driverAutoSuspendedDriver({}),
      driverAutoSuspendedStaff({}),
      driverReinstatedDriver({}),
      driverReinstatedStaff({}),
      tripStartWindowOpen({}),
      timeToHeadToPickup({}),
      tripNotStartedDriver({}),
      tripNotStartedStaff({}),
    ];
    for (const out of outputs) {
      for (const field of ["title", "message", "pushBody"]) {
        expect(hasDebris(out[field]), `${field}: "${out[field]}"`).toBe(false);
      }
    }
  });

  it("helpNewEta without an ETA degrades instead of inventing one", () => {
    const out = helpNewEta({ responderName: "Juan Dela Cruz" });
    expect(out.message).toContain("Juan Dela Cruz");
    expect(out.message).not.toContain("about NaN");
    expect(out.message).not.toContain("about  minutes");
  });

  it("helpNewEta with an ETA states the number", () => {
    expect(helpNewEta({ responderName: "Juan", etaMinutes: 12 }).message).toContain("about 12 minutes");
  });
});

describe("copy module — trip start-window group", () => {
  // The start endpoint still gates on pre-trip inspection, vehicle/driver
  // status and work schedule. The copy must reflect the WINDOW, never claim
  // the trip can start — and never mention the inspection.
  const PICKUP_UTC = "2026-09-09T02:30:00.000Z"; // 10:30 AM in Asia/Manila

  it("renders pickup times in Asia/Manila, not the server's zone", () => {
    for (const fn of [tripStartWindowOpen, timeToHeadToPickup, tripNotStartedDriver]) {
      const out = fn({ pickup: PICKUP_UTC, etaMinutes: 12 });
      expect(out.message).toContain("10:30 AM");
      expect(out.message).not.toContain("02:30");
    }
    expect(tripNotStartedStaff({ driverName: "Juan Dela Cruz", pickup: PICKUP_UTC }).message).toContain("10:30 AM");
  });

  it("never claims the trip can be started and never mentions the inspection", () => {
    for (const fn of [tripStartWindowOpen, timeToHeadToPickup]) {
      const out = fn({ pickup: PICKUP_UTC, etaMinutes: 12 });
      for (const field of ["title", "message", "pushBody"]) {
        expect(out[field], field).not.toMatch(/can start|you can now start|inspection/i);
      }
    }
    // The overdue copy may tell the driver to START the trip (it already
    // should have started), but still never mentions the inspection.
    const out = tripNotStartedDriver({ pickup: PICKUP_UTC });
    for (const field of ["title", "message", "pushBody"]) {
      expect(out[field], field).not.toMatch(/inspection/i);
    }
  });

  it("titles are the stable threshold event names (the dedupe keys)", () => {
    expect(tripStartWindowOpen({ pickup: PICKUP_UTC }).title).toBe("Trip Start Window Open");
    expect(timeToHeadToPickup({ pickup: PICKUP_UTC }).title).toBe("Time to Head to Pickup");
    expect(tripNotStartedDriver({ pickup: PICKUP_UTC }).title).toBe("Trip Has Not Started");
    expect(tripNotStartedStaff({ driverName: "X", pickup: PICKUP_UTC }).title).toBe("Scheduled Trip Has Not Started");
  });

  it("ETA text appears only when the ETA resolved", () => {
    expect(tripStartWindowOpen({ pickup: PICKUP_UTC, etaMinutes: 12 }).message).toContain("about 12 minutes");
    expect(tripStartWindowOpen({ pickup: PICKUP_UTC, etaMinutes: null }).message).not.toContain("about");
    expect(timeToHeadToPickup({ pickup: PICKUP_UTC, etaMinutes: 12 }).message).toContain("about 12 min");
    expect(timeToHeadToPickup({ pickup: PICKUP_UTC, etaMinutes: null }).message).not.toContain("about");
  });

  it("staff overdue copy names the driver; driver copy never does", () => {
    expect(tripNotStartedStaff({ driverName: "Juan Dela Cruz", pickup: PICKUP_UTC }).message).toContain("Juan Dela Cruz");
    for (const field of ["title", "message", "pushBody"]) {
      expect(tripNotStartedDriver({ pickup: PICKUP_UTC })[field]).not.toContain("Juan");
    }
  });
});
