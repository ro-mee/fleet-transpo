/**
 * FleetOps Driver Companion — Contextual Coach Marks Definition
 *
 * Operational, non-intrusive, just-in-time guidance configurations.
 * Adheres strictly to:
 * - "Guidance when needed, not guidance everywhere."
 * - "Teach the difficult decision or workflow, not the button the driver already understands."
 * - Zero mascots, zero gamification, zero celebration screens.
 */

export const COACH_MARK_MILESTONES = {
  WELCOME: {
    key: "welcome",
    version: 1,
    route: "/",
    // Copy verbatim from Capstone: Driver In-App Guide §2. The card was
    // paraphrasing it in both places, which is how the two drifted from the spec
    // it claims to implement.
    title: "Welcome to FleetOps!",
    body: "We'll guide you through important actions as you use the app. Tips will appear only when they're relevant.",
    steps: [
      {
        id: "welcome.card",
        targetId: null, // Dialog/card presentation, no spotlight target
        title: "Welcome to FleetOps!",
        body: "We'll guide you through important actions as you use the app. Tips will appear only when they're relevant.",
        actionText: "Got it",
        canSkip: true,
        interaction: "observe",
      },
    ],
  },

  PRETRIP: {
    key: "pretrip",
    version: 1,
    route: "/inspection",
    steps: [
      {
        id: "pretrip.pass_fail",
        targetId: "inspection.pass_fail",
        title: "Mark each item",
        body: "Work down the list and choose PASS for each item that is safe, or FAIL for one you find a problem with. Marking FAIL asks you to describe the issue, so dispatch knows what needs attention.",
        // Renders in both modes. `body` stays the per-trip variant and doubles
        // as the no-context fallback; only the sentence that explains what the
        // baseline is for differs.
        dynamicBody: (ctx) =>
          ctx?.mode === "preshift"
            ? "Work down the list and choose PASS for each item that is safe, or FAIL for one you find a problem with. This is your once-a-day baseline — each trip still needs its own quick check before departure."
            : "Work down the list and choose PASS for each item that is safe, or FAIL for one you find a problem with. Marking FAIL asks you to describe the issue, so dispatch knows what needs attention.",
        actionText: "Got it",
        canSkip: true,
        interaction: "passthrough",
      },
    ],
  },

  PRETRIP_REMARKS: {
    key: "pretrip_remarks",
    version: 1,
    route: "/inspection",
    steps: [
      {
        id: "pretrip.remarks",
        targetId: "inspection.remarks",
        title: "Add remarks",
        body: "Failed checks require a short description so dispatch knows what needs attention.",
        actionText: "Got it",
        canSkip: false,
        interaction: "passthrough",
      },
    ],
  },

  PRETRIP_COMPLETE: {
    key: "pretrip_complete",
    version: 1,
    route: "/inspection",
    steps: [
      {
        id: "pretrip.complete",
        targetId: "inspection.complete",
        title: "Complete to continue",
        body: "Tap here once every item is checked. You must complete this check before the trip can start.",
        // The count is the part that two inspection types made untrue, so it is
        // passed in from the screen that knows it and never hardcoded here.
        dynamicBody: (ctx) =>
          ctx?.total
            ? `Tap here once all ${ctx.total} items are checked. You must complete this check before the trip can start.`
            : "Tap here once every item is checked. You must complete this check before the trip can start.",
        actionText: "Got it",
        canSkip: true,
        // `passthrough`, not `blocked`. The step's copy tells the driver to
        // "tap here", and under `blocked` the cutout swallows that tap — the
        // only way through was the tooltip's own "Got it" first, so the
        // instruction was untrue and the real button took two taps to reach.
        // Blocking is for actions that must not fire by accident (SOS, Start
        // Trip, the trip-progression swipe); this one is a plain submit whose
        // tour path writes nothing at all (`handleSubmit` returns after opening
        // the completion modal when `isTour`).
        interaction: "passthrough",
      },
    ],
  },

  TRIP_READINESS: {
    key: "trip_readiness",
    version: 1,
    route: "/trip",
    steps: [
      {
        id: "trip.readiness",
        targetId: "trip.readiness",
        title: "Start when it's time",
        body: "This shows when your trip can begin. FleetOps will not let the trip start before the allowed readiness window.",
        actionText: "Next →",
        canSkip: true,
        interaction: "observe",
      },
      {
        id: "trip.pretrip_requirement",
        targetId: "trip.pretrip_requirement",
        title: "Pre-trip requirement",
        body: "Complete the pre-shift vehicle safety check once a day, then the quick pre-trip check for each trip. The start button unlocks once safety is confirmed.",
        actionText: "Next →",
        canSkip: true,
        interaction: "observe",
      },
      {
        id: "trip.primary_action",
        targetId: "trip.primary_action",
        title: "Start vs. Continue",
        body: "Start Trip begins the trip when readiness and inspection requirements are satisfied.",
        dynamicBody: (ctx) =>
          ctx?.isContinue
            ? "Once the trip is active, Continue to Map only returns you to the live trip and navigation."
            : ctx?.reason === "pre_shift"
              ? "START YOUR SHIFT opens the full vehicle safety check. Complete it once today and this button becomes the start control for your trips."
              : "Start Trip begins the trip when readiness and inspection requirements are satisfied.",
        actionText: "Got it",
        canSkip: false,
        interaction: "blocked",
      },
    ],
  },

  // Guide 1's Home entry point, not a seventh guide: §3's six areas are the
  // areas that *receive* guidance, and this teaches the same Pre-Shift check
  // Guide 1 already covers — from the control that starts it.
  PRESHIFT_INTRO: {
    key: "preshift",
    version: 1,
    route: "/",
    steps: [
      {
        id: "preshift.start",
        targetId: "home.preshift_start",
        title: "Start with the vehicle check",
        body: "Complete the full vehicle safety check once a day, before your first trip. Each trip afterwards still needs its own quick pre-trip check — this one does not count for a trip.",
        actionText: "Got it",
        canSkip: true,
        // `passthrough` — the `observe` this replaces was simply wrong, and the
        // spec's own description of this step is what proves it.
        //
        // §3.1c says: "The driver's next act is to read this, then tap the real
        // button." That is not achievable under `observe` — the overlay maps
        // `observe` to cutout `pointerEvents="auto"` (its header calls `auto`
        // the PROTECTED-ACTIONS setting), so the cutout swallowed every tap on
        // the button and the driver had to dismiss the card first. The spec
        // described an interaction model its own `interaction` value delivered
        // the opposite of. `passthrough` makes the code match the intent.
        //
        // Still no `requiresInteraction` (§7 Rule 3, and the "Explained, Not
        // Required" property): this guide explains the control, it does not gate
        // it. `tour_preshift` and `tour_end_duty` likewise stay `observe`, and
        // for a further reason there — a tour tap on this button would run a
        // REAL baseline and start duty.
        interaction: "passthrough",
      },
    ],
  },

  // Guide 1's closing half. Closing the shift is the one duty action with a
  // consequence the driver cannot see from the button: it files a vehicle
  // condition report for the day. Same shape as PRESHIFT_INTRO — one step, Home,
  // `observe`, skip-forgiving — so the card stays tappable underneath.
  END_DUTY_INTRO: {
    key: "end_duty",
    version: 1,
    route: "/",
    steps: [
      {
        id: "end_duty.report",
        targetId: "home.end_duty",
        title: "Close your shift with a quick report",
        body: "Before you clock out, tell FleetOps whether you noticed anything unusual about the vehicle. Say nothing was unusual and your shift closes right away; describe a problem and it opens a work order for the vehicle.",
        actionText: "Got it",
        canSkip: true,
        // Same correction as `preshift.start`: `observe` blocked the very button
        // the card was describing, which §3.1d explicitly says the driver's next
        // act is. `passthrough` makes the code match that. Still no
        // `requiresInteraction` — §7 Rule 3 / "Explained, Not Required". This
        // button only navigates to `/end-duty`; the shift-closing write is the
        // Submit on the next screen, and the guide never reaches it.
        interaction: "passthrough",
      },
    ],
  },

  MAP_INTRO: {
    key: "map_intro",
    version: 1,
    route: "/map",
    title: "Your Live Map",
    body: "FleetOps shows your live position here. When you don't have an active trip, the map stays ready and waits for your next assignment.",
    steps: [
      {
        id: "map.intro.standby_status",
        targetId: "map.standby_status",
        title: "Your Live Map",
        body: "FleetOps shows your live position here. When you don't have an active trip, the map stays ready and waits for your next assignment.",
        actionText: "Next →",
        canSkip: true,
        interaction: "observe",
      },
      {
        id: "map.intro.controls",
        targetId: "map.controls",
        title: "Stay oriented",
        body: "Use these controls to recenter the map, manage visible map information, or quickly return to your vehicle location.",
        actionText: "Next →",
        canSkip: true,
        interaction: "observe",
      },
      {
        id: "map.intro.layers",
        targetId: "map.layers",
        title: "Choose what you see",
        body: "Map layers help you show or hide useful operational information such as your vehicle, nearby fuel stations, fleet drivers, and dispatch requests.",
        actionText: "Next →",
        canSkip: true,
        interaction: "observe",
      },
      {
        id: "map.practice.start",
        targetId: "map.trip_practice",
        title: "Start Route",
        body: "Swipe START ROUTE to practice the gesture. This is only a tutorial — no trip status will be changed.",
        actionText: "Swipe right →",
        canSkip: true,
        allowBack: false,
        requiresInteraction: true,
        interaction: "passthrough",
      },
      {
        id: "map.practice.pickup",
        targetId: "map.trip_practice",
        title: "Arrived at Pickup",
        body: "Swipe ARRIVED AT PICKUP to practice the next trip stage. This is only a tutorial — no trip status will be changed.",
        actionText: "Swipe right →",
        canSkip: true,
        allowBack: false,
        requiresInteraction: true,
        interaction: "passthrough",
      },
      {
        id: "map.practice.guest",
        targetId: "map.trip_practice",
        title: "Picked Up Guest",
        body: "Swipe PICKED UP GUEST to practice confirming the guest onboard. This is only a tutorial — no trip status will be changed.",
        actionText: "Swipe right →",
        canSkip: true,
        allowBack: false,
        requiresInteraction: true,
        interaction: "passthrough",
      },
      {
        id: "map.practice.destination",
        targetId: "map.trip_practice",
        title: "Arrived at Destination",
        body: "Swipe ARRIVED AT DESTINATION to practice reaching the final waypoint. This is only a tutorial — no trip status will be changed.",
        actionText: "Swipe right →",
        canSkip: true,
        allowBack: false,
        requiresInteraction: true,
        interaction: "passthrough",
      },
      {
        id: "map.practice.dropoff",
        targetId: "map.trip_practice",
        title: "Dropped Off Guest",
        body: "Swipe DROPPED OFF GUEST to practice confirming a safe drop-off. This is only a tutorial — no trip status will be changed.",
        actionText: "Swipe right →",
        canSkip: true,
        allowBack: false,
        requiresInteraction: true,
        interaction: "passthrough",
      },
      {
        id: "map.practice.complete",
        targetId: "map.trip_practice",
        title: "You're ready",
        body: "During a real assignment, FleetOps will show the correct action automatically based on your current trip stage.",
        actionText: "Finish Tour",
        canSkip: false,
        allowBack: false,
        interaction: "observe",
      },
    ],
  },

  LIVE_TRIP: {
    key: "live_trip",
    version: 1,
    route: "/map",
    steps: [
      {
        id: "map.current_target",
        targetId: "map.current_target",
        title: "Your current mission",
        body: "This shows your current trip target and next service point. Use it to confirm whether you're heading to Pickup or Drop-off.",
        actionText: "Next →",
        canSkip: true,
        interaction: "observe",
      },
      {
        id: "map.telemetry",
        targetId: "map.telemetry",
        title: "Live telemetry",
        body: "Live route, ETA, and distance are calculated continuously. Telemetry is automatically shared with dispatch.",
        actionText: "Next →",
        canSkip: true,
        interaction: "observe",
      },
      {
        id: "map.trip_progression",
        targetId: "map.trip_progression",
        title: "Trip progression",
        body: "Slide this control when you reach your waypoint or complete a leg to advance the trip status.",
        actionText: "Got it",
        canSkip: false,
        interaction: "blocked",
      },
    ],
  },

  FUEL_SCAN_INTRO: {
    key: "fuel_scan_intro",
    version: 1,
    route: "/fuel-report",
    steps: [
      {
        id: "fuel.scan_intro",
        targetId: "fuel.scan_entry",
        title: "Scan your fuel receipt",
        body: "FleetOps can read key receipt details for you. Try a quick sample scan, then use the real scanner.",
        actionText: "Try sample scan",
        canSkip: true,
        interaction: "observe",
        presentation: "simulation",
        demoKey: "fuel_receipt_scan",
        handoff: "fuel.scan_entry",
      },
    ],
  },

  FUEL_SCAN_CAPTURE: {
    key: "fuel_scan_capture",
    version: 2,
    route: "/fuel-report",
    steps: [
      {
        id: "fuel.capture.viewfinder",
        targetId: "fuel.viewfinder",
        title: "Frame the whole receipt",
        body: "Keep the full receipt inside the frame. Use good lighting and avoid glare or folds.",
        actionText: "Got it",
        canSkip: true,
        interaction: "observe",
        presentation: "compact",
      },
    ],
  },

  FUEL_SCAN_VERIFY: {
    key: "fuel_scan_verify",
    version: 1,
    route: "/fuel-report",
    steps: [
      {
        id: "fuel.verify",
        targetId: "fuel.verify",
        title: "Verify the extracted values",
        body: "Check Volume and Total Cost against the receipt. Correct anything FleetOps read incorrectly.",
        actionText: "Got it",
        canSkip: false,
        interaction: "passthrough",
        presentation: "compact",
      },
    ],
  },

  SOS: {
    key: "sos",
    version: 1,
    route: "/",
    steps: [
      {
        id: "incident.sos",
        targetId: "incident.sos",
        title: "Emergency Assistance",
        body: "Use SOS only for real emergencies (accidents, medical threats, or breakdowns). Your location is immediately shared with the fleet team.",
        actionText: "Got it",
        canSkip: false,
        interaction: "blocked",
        presentation: "floating_bubble",
      },
    ],
  },

  INCIDENT: {
    key: "incident",
    version: 1,
    route: "/incidents",
    steps: [
      {
        id: "incident.banner",
        targetId: "incident.banner",
        title: "Immediate dispatch alert",
        body: "Submitting an incident immediately alerts the fleet coordinator. Emergency assistance will be deployed if requested.",
        actionText: "Next →",
        canSkip: true,
        interaction: "observe",
      },
      {
        id: "incident.category",
        targetId: "incident.category",
        title: "Select incident category",
        body: "Choose the category that best describes the situation so dispatch knows what equipment or assistance to send.",
        actionText: "Got it",
        canSkip: false,
        interaction: "passthrough",
      },
    ],
  },

  OFFLINE: {
    key: "offline",
    version: 1,
    route: null,
    steps: [
      {
        id: "offline.banner",
        targetId: "offline.banner",
        title: "Offline Mode",
        // Copy verbatim from Capstone: Driver In-App Guide §3.6.
        body: "You can continue viewing saved trip information. Any updates you make will be saved locally and automatically synced when you're back online.",
        actionText: "Got it",
        canSkip: false,
        interaction: "observe",
      },
    ],
  },

  TOUR_SOS: {
    key: "tour_sos",
    version: 1,
    route: "/",
    steps: [
      {
        id: "tour.sos.prompt",
        targetId: "incident.sos",
        title: "Emergency Assistance",
        body: "Tap the floating SOS button to practice opening emergency actions. Don't worry, this is only a simulation.",
        actionText: "Tap SOS",
        canSkip: true,
        interaction: "passthrough",
        presentation: "floating_bubble",
      },
    ],
  },

  // The two duty controls, taught back to back and immediately after SOS. They
  // are a matched pair — Pre-Shift opens the shift, End Duty closes it — and
  // pairing them lands the duty model's core lesson in one beat instead of
  // splitting it across the length of the tour. Everything that follows
  // (incident, fuel, trip progression) is then "what you do during the shift".
  TOUR_PRESHIFT: {
    key: "tour_preshift",
    version: 1,
    route: "/",
    steps: [
      {
        id: "tour.preshift.start",
        targetId: "home.preshift_start",
        title: "Start Your Shift",
        // Both facts a driver cannot see from the button: that this runs once a
        // day, and that it does NOT clear their trips. Without the second
        // sentence a driver concludes the baseline covers the whole day's
        // departures, which is exactly the confusion the two-type model fixes.
        body: "Every working day starts here, with the full vehicle safety check. It runs once a day, before your first trip — and each trip still needs its own quick check afterwards, so this one does not clear them.",
        actionText: "Got it",
        canSkip: true,
        // `observe`: the driver reads this, then the tour walks the real screen.
        // The tap is not what the tour waits for here — the cascade navigates,
        // and the cutout is pointer-blocking so the real button cannot be
        // pressed mid-tour (a bare press would run a REAL baseline and start
        // duty; see §7 Rule 3 and the entry-point guard in the plan).
        interaction: "observe",
      },
    ],
  },

  // Taught immediately after Pre-Shift, not held to the end of the tour: the
  // two duty bookends belong in one lesson. The copy therefore has to frame
  // itself as the END of the day rather than as the next thing to do — a driver
  // meets this roughly a minute into onboarding.
  TOUR_END_DUTY: {
    key: "tour_end_duty",
    version: 1,
    route: "/",
    steps: [
      {
        id: "tour.end_duty.report",
        targetId: "home.end_duty",
        title: "Close Your Shift",
        // Both halves of the consequence: the uneventful path closes the shift,
        // and a description is not a note — it files a work order that can
        // ground the vehicle. That is the part a driver cannot infer.
        body: "At the end of the day your shift closes here. Say nothing was unusual and it closes right away; describe a problem and it opens a work order for the vehicle. Nothing to do right now — just know where it lives.",
        actionText: "Got it",
        canSkip: true,
        // `observe`: same shape as TOUR_PRESHIFT — the guide explains, the driver
        // does not act. The card stays rendered underneath but its button is
        // pointer-blocked for the step's duration.
        interaction: "observe",
      },
    ],
  },

  TOUR_INCIDENT: {
    key: "tour_incident",
    version: 1,
    route: "/",
    steps: [
      {
        id: "tour.incident.shortcut",
        targetId: "home.shortcut_incident",
        title: "Report an Incident",
        body: "Tap Report Incident to notify dispatch about vehicle breakdowns, road hazards, or route delays.",
        actionText: "Tap Report Incident",
        canSkip: true,
        interaction: "passthrough",
      },
    ],
  },

  TOUR_INCIDENT_CATEGORY: {
    key: "tour_incident_category",
    version: 1,
    route: "/incidents",
    steps: [
      {
        id: "tour.incident.category",
        targetId: "incident.category",
        title: "1. Select Category",
        body: "Tap any category (such as Vehicle Breakdown) to classify the situation for dispatch.",
        actionText: "Select category",
        canSkip: true,
        // The category tap IS the step. Without this the card advances on its
        // own button and the driver reaches "2. Confirm Details" having chosen
        // nothing — the classification this screen exists to teach is skipped.
        // Same shape as the Map practice swipes: the button states the required
        // action and does nothing until the driver performs it, and `canSkip`
        // keeps a way out.
        requiresInteraction: true,
        interaction: "passthrough",
      },
      {
        id: "tour.incident.details",
        targetId: "incident.details",
        title: "2. Confirm Details & Assistance",
        body: "FleetOps pre-fills sample breakdown details and requests assistance (e.g. Tow Truck).",
        actionText: "Next →",
        canSkip: true,
        interaction: "observe",
      },
      {
        id: "tour.incident.photos",
        targetId: "incident.photos",
        title: "3. Attach Photo Evidence",
        body: "Attach up to 3 photos of vehicle damage, road hazards, or the scene to assist dispatch.",
        actionText: "Next →",
        canSkip: true,
        interaction: "observe",
      },
      {
        id: "tour.incident.submit",
        targetId: "incident.submit",
        title: "4. Send Incident Report",
        body: "Tap Send Incident Report to preview the report flow. In tutorial mode, no real incident is sent.",
        actionText: "Tap Submit",
        canSkip: true,
        interaction: "passthrough",
      },
    ],
  },

  TOUR_FUEL: {
    key: "tour_fuel",
    version: 1,
    route: "/",
    steps: [
      {
        id: "tour.fuel.shortcut",
        targetId: "home.shortcut_fuel",
        title: "Fuel Logging & Approval",
        body: "Tap Fuel to submit fuel requests and scan receipts for fleet expense reimbursement.",
        actionText: "Tap Fuel",
        canSkip: true,
        interaction: "passthrough",
      },
    ],
  },

  TOUR_FUEL_ENTRY: {
    key: "tour_fuel_entry",
    version: 1,
    route: "/fuel-report",
    steps: [
      {
        id: "tour.fuel.gauge_entry",
        targetId: "fuel.gauge_entry",
        title: "1. Capture Fuel Gauge",
        body: "Every fuel request requires a photo of your dashboard fuel gauge. Tap to practice capturing it.",
        actionText: "Capture Gauge",
        canSkip: true,
        interaction: "passthrough",
      },
    ],
  },

  TOUR_FUEL_FLOW: {
    key: "tour_fuel_flow",
    version: 1,
    route: "/fuel-report",
    // The gating rule for this flow, and the two places it does not apply:
    //
    //   A step whose subject is an ACTION the driver performs is latched. Its
    //   real control is the only way past it, and the tooltip's own button
    //   renders disabled. A step that only ASKS TO BE READ is `observe`, and
    //   "Got it" is the honest way past it.
    //
    //   The two exceptions are step 5 (nothing to press) and step 6 (§7 Rule 3
    //   names Submit Fuel protected). Each is explained at its own step.
    //
    // Before this, every step here was ungated passthrough, so "Next" was a
    // second, always-open exit: the whole six-step flow could be completed in
    // three taps having pressed nothing. Same shape as the incident category
    // step's fix, and for the same reason.
    steps: [
      {
        id: "tour.fuel.gauge_entry",
        targetId: "fuel.gauge_entry",
        title: "1. Capture Fuel Gauge",
        body: "Every fuel request begins with a photo of your dashboard gauge. Tap to practice capturing it.",
        actionText: "Capture Gauge",
        canSkip: true,
        requiresInteraction: true,
        interaction: "passthrough",
      },
      {
        id: "tour.fuel.request_button",
        targetId: "fuel.request_button",
        title: "2. Submit Fuel Request",
        body: "Gauge reading extracted (~75%). Tap Request Fuel to submit for fleet coordinator approval.",
        actionText: "Request Fuel",
        canSkip: true,
        requiresInteraction: true,
        interaction: "passthrough",
      },
      {
        id: "tour.fuel.approval",
        targetId: "fuel.approval",
        title: "3. Vehicle Fuel Check",
        body: "Your request goes to the fleet coordinator, who approves a volume against your vehicle's tank and route. Here they approved 35.50 L — you may now refuel.",
        // `observe`, correctly: there is nothing to press. The approval is
        // something that HAPPENED to the driver, not something they do. "Got
        // it" is the true way past it.
        actionText: "Got it",
        canSkip: true,
        interaction: "observe",
      },
      {
        id: "tour.fuel.scan_entry",
        targetId: "fuel.scan_entry",
        title: "4. Scan Fuel Receipt",
        body: "Tap Scan receipt to practice scanning your gas station receipt.",
        actionText: "Scan Receipt",
        canSkip: true,
        requiresInteraction: true,
        interaction: "passthrough",
      },
      {
        id: "tour.fuel.verify",
        targetId: "fuel.verify",
        title: "5. Verify Extracted Data",
        body: "Review the extracted liters (35.50 L), cost (₱2,350.00), and station (Shell). If the scan got any value wrong, tap that field and correct it before saving.",
        // `observe`, NOT a latched passthrough — and this is the one step in the
        // flow where the general rule does not apply, so it is called out rather
        // than left to look like an oversight.
        //
        // A latch needs something to latch onto: a control the driver presses
        // that then reports success. `fuel.verify` has neither. No code path
        // anywhere calls `notifyInteraction("fuel.verify")`, and there is no
        // discrete control to notify — the step points at a whole verification
        // panel of fields the driver reads and may optionally correct, which is
        // not a single event. Latching it would therefore have been
        // un-completable: the tour would stop on step 5 forever.
        //
        // It is a read step, exactly like step 3, so "Next" is honest here.
        actionText: "Next →",
        canSkip: true,
        interaction: "observe",
      },
      {
        id: "tour.fuel.submit_button",
        targetId: "fuel.submit_button",
        title: "6. Save Fuel Entry",
        body: "Tap Save Fuel Entry to record your fuel log in tutorial mode.",
        actionText: "Save Entry",
        canSkip: true,
        // NOT latched, and this is the one step where the general rule above is
        // deliberately not applied. §7 Rule 3 names **Submit Fuel** in the
        // Protected Action Guarantee: it must never become a tutorial-required
        // action. Latching it would be exactly that, whatever the tour's
        // `handleSubmit` happens to do today.
        //
        // The mitigating fact — that the tour branch opens a completion modal
        // and writes nothing — is a property of the current implementation, not
        // a guarantee the guide system can enforce, and a future change to that
        // branch would silently inherit the protection. So the rule is honoured
        // at the milestone level instead. Amending Rule 3 to carve out the
        // simulated submit is a spec decision, not one to be made here.
        interaction: "passthrough",
      },
    ],
  },
};

/**
 * Validates whether a given pathname matches the expected route for a milestone.
 * @param {string} pathname
 * @param {string|Function|null} expectedRoute
 * @returns {boolean}
 */
export function isRouteMatch(pathname, expectedRoute) {
  if (!expectedRoute) return true;
  if (pathname === null || pathname === undefined) return false;
  if (typeof expectedRoute === "function") {
    return expectedRoute(pathname);
  }
  // Normalize by stripping Expo Router route group segments like /(tabs) or /(app)
  const normPath = pathname.replace(/\/\([^)]+\)/g, "") || "/";
  const normExpected = expectedRoute.replace(/\/\([^)]+\)/g, "") || "/";

  if (normExpected === "/") {
    return (
      normPath === "/" ||
      normPath === "" ||
      normPath === "/index" ||
      normPath.startsWith("/index")
    );
  }
  return normPath.startsWith(normExpected) || pathname.startsWith(expectedRoute);
}

/**
 * Returns the milestone configuration for a given key.
 * @param {string} key
 * @returns {object|null}
 */
export function getMilestoneConfig(key) {
  if (!key) return null;
  const match = Object.values(COACH_MARK_MILESTONES).find(
    (m) => m.key === key.toLowerCase()
  );
  return match || null;
}

/**
 * List of all supported coach mark keys for batch resets.
 */
export const ALL_COACH_MARK_KEYS = Object.values(COACH_MARK_MILESTONES).map(
  (m) => m.key
);
