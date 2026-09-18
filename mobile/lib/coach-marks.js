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
        body: "Inspect each item carefully. Choose PASS when the item is safe, or FAIL when you find a problem.",
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
        body: "Tap here once all 7 items are checked. You must complete the inspection before you can start the trip.",
        actionText: "Got it",
        canSkip: true,
        interaction: "blocked",
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
        body: "Complete the required vehicle inspection before departure. The start button unlocks once safety is confirmed.",
        actionText: "Next →",
        canSkip: true,
        interaction: "observe",
      },
      {
        id: "trip.primary_action",
        targetId: "trip.primary_action",
        title: "Start vs. Continue",
        dynamicBody: (ctx) =>
          ctx?.isContinue
            ? "Once the trip is active, Continue to Map only returns you to the live trip and navigation."
            : "Start Trip begins the trip when readiness and inspection requirements are satisfied.",
        actionText: "Got it",
        canSkip: false,
        interaction: "blocked",
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

  FUEL_SCAN_CAPTURE: {
    key: "fuel_scan_capture",
    version: 1,
    route: "/fuel-report",
    steps: [
      {
        id: "fuel.viewfinder",
        targetId: "fuel.viewfinder",
        title: "Position the receipt",
        body: "Place the full receipt inside the frame. Ensure good lighting and avoid glare or folds so AI can read the text.",
        actionText: "Got it",
        canSkip: true,
        interaction: "observe",
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
        title: "Verify the details",
        body: "Always check the extracted liters and total amount before submitting. Correct any values that were read incorrectly.",
        actionText: "Got it",
        canSkip: false,
        interaction: "passthrough",
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
