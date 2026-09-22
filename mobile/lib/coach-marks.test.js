import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("@react-native-async-storage/async-storage", () => {
  const store = new Map();
  return {
    default: {
      getItem: vi.fn(async (key) => (store.has(key) ? store.get(key) : null)),
      setItem: vi.fn(async (key, value) => {
        store.set(key, String(value));
      }),
      removeItem: vi.fn(async (key) => {
        store.delete(key);
      }),
      multiRemove: vi.fn(async (keys) => {
        for (const k of keys) store.delete(k);
      }),
      clear: vi.fn(async () => {
        store.clear();
      }),
    },
  };
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  COACH_MARK_MILESTONES,
  getMilestoneConfig,
  ALL_COACH_MARK_KEYS,
  isRouteMatch,
} from "./coach-marks";
import {
  getCoachMarkStorageKey,
  isCoachMarkCompleted,
  setCoachMarkCompleted,
  resetCoachMark,
  resetAllCoachMarks,
} from "./coach-mark-storage";

describe("Coach Marks Configuration & Storage", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    vi.clearAllMocks();
  });

  describe("Milestone Definitions & Rules", () => {
    it("defines the approved 7 core contextual guide domains without mascots or celebrations", () => {
      expect(COACH_MARK_MILESTONES.WELCOME).toBeDefined();
      expect(COACH_MARK_MILESTONES.PRETRIP).toBeDefined();
      expect(COACH_MARK_MILESTONES.PRETRIP_REMARKS).toBeDefined();
      expect(COACH_MARK_MILESTONES.PRETRIP_COMPLETE).toBeDefined();
      expect(COACH_MARK_MILESTONES.TRIP_READINESS).toBeDefined();
      expect(COACH_MARK_MILESTONES.MAP_INTRO).toBeDefined();
      expect(COACH_MARK_MILESTONES.LIVE_TRIP).toBeDefined();
      expect(COACH_MARK_MILESTONES.FUEL_SCAN_INTRO).toBeDefined();
      expect(COACH_MARK_MILESTONES.FUEL_SCAN_CAPTURE).toBeDefined();
      expect(COACH_MARK_MILESTONES.FUEL_SCAN_VERIFY).toBeDefined();
      expect(COACH_MARK_MILESTONES.SOS).toBeDefined();
      expect(COACH_MARK_MILESTONES.INCIDENT).toBeDefined();
      expect(COACH_MARK_MILESTONES.OFFLINE).toBeDefined();

      // Zero mascot or celebration milestones
      expect(COACH_MARK_MILESTONES.COMPLETION).toBeUndefined();
      expect(COACH_MARK_MILESTONES.MASCOT).toBeUndefined();
    });

    it("keeps the first Map tour separate from the real-trip guide", () => {
      const mapIntro = getMilestoneConfig("map_intro");
      const liveTrip = getMilestoneConfig("live_trip");

      expect(mapIntro.key).toBe("map_intro");
      expect(mapIntro.version).toBe(1);
      expect(mapIntro.route).toBe("/map");
      expect(mapIntro.steps.slice(0, 3).map((step) => step.targetId)).toEqual([
        "map.standby_status",
        "map.controls",
        "map.layers",
      ]);
      expect(mapIntro.steps.slice(3, 8).every((step) =>
        step.targetId === "map.trip_practice" &&
        step.requiresInteraction === true &&
        step.interaction === "passthrough"
      )).toBe(true);
      expect(mapIntro.steps.at(-1).actionText).toBe("Finish Tour");
      expect(liveTrip.steps.map((step) => step.targetId)).toEqual([
        "map.current_target",
        "map.telemetry",
        "map.trip_progression",
      ]);
    });

    it("makes the incident category a required tap before the next step", () => {
      const tour = getMilestoneConfig("tour_incident_category");
      const [categoryStep, detailsStep] = tour.steps;

      expect(categoryStep.targetId).toBe("incident.category");
      expect(categoryStep.requiresInteraction).toBe(true);
      expect(categoryStep.interaction).toBe("passthrough");
      // `canSkip` is the way out. The gate turns the action button into a
      // no-op, so without Skip the driver would be held on a step that only a
      // category tap can leave.
      expect(categoryStep.canSkip).toBe(true);
      expect(detailsStep.targetId).toBe("incident.details");
    });

    it("ensures Live Trip step 1 does not claim turn-by-turn navigation", () => {
      const liveTrip = getMilestoneConfig("live_trip");
      expect(liveTrip).toBeDefined();
      const step1 = liveTrip.steps[0];
      expect(step1.title).toBe("Your current mission");
      expect(step1.body).toContain("confirm whether you're heading to Pickup or Drop-off");
      expect(step1.body).not.toContain("turn-by-turn");
    });

    it("ensures Remarks guide is an independent conditional micro-guide", () => {
      const pretrip = getMilestoneConfig("pretrip");
      const remarks = getMilestoneConfig("pretrip_remarks");
      expect(pretrip.steps.length).toBe(1);
      expect(remarks.steps[0].targetId).toBe("inspection.remarks");
    });

    it("resolves milestone configs case-insensitively", () => {
      expect(getMilestoneConfig("TRIP_READINESS")?.key).toBe("trip_readiness");
      expect(getMilestoneConfig("offline")?.key).toBe("offline");
      expect(getMilestoneConfig("nonexistent")).toBeNull();
    });
  });

  describe("Route Matching & Route-Group Normalization", () => {
    it("matches root route and strips route group parentheses", () => {
      expect(isRouteMatch("/(app)/(tabs)", "/")).toBe(true);
      expect(isRouteMatch("/(app)/(tabs)/index", "/")).toBe(true);
      expect(isRouteMatch("/", "/")).toBe(true);
      expect(isRouteMatch("", "/")).toBe(true);
    });

    it("matches specific subroutes while rejecting cross-route mismatches", () => {
      expect(isRouteMatch("/(app)/incidents", "/incidents")).toBe(true);
      expect(isRouteMatch("/(app)/(tabs)", "/incidents")).toBe(false);
      expect(isRouteMatch("/(app)/inspection", "/")).toBe(false);
      expect(isRouteMatch("/(app)/trip/105", "/trip")).toBe(true);
      expect(isRouteMatch("/(app)/(tabs)/map", "/map")).toBe(true);
    });

    it("matches universal global milestones when expectedRoute is null", () => {
      expect(isRouteMatch("/anywhere", null)).toBe(true);
      expect(isRouteMatch(null, "/trip")).toBe(false);
    });
  });

  describe("Per-Driver Storage Isolation & Persistence", () => {
    it("generates driver-isolated versioned storage keys", () => {
      const keyA = getCoachMarkStorageKey("pretrip", 1, "driver_101");
      const keyB = getCoachMarkStorageKey("pretrip", 1, "driver_202");
      const keyAnon = getCoachMarkStorageKey("pretrip", 1, null);

      expect(keyA).toBe("fleetops.guide.pretrip.v1_driver_101");
      expect(keyB).toBe("fleetops.guide.pretrip.v1_driver_202");
      expect(keyAnon).toBe("fleetops.guide.pretrip.v1");
    });

    it("isolates completion status between drivers", async () => {
      await setCoachMarkCompleted("trip_readiness", 1, "driver_alpha");

      const alphaDone = await isCoachMarkCompleted("trip_readiness", 1, "driver_alpha");
      const betaDone = await isCoachMarkCompleted("trip_readiness", 1, "driver_beta");

      expect(alphaDone).toBe(true);
      expect(betaDone).toBe(false);
    });

    it("resets an individual coach mark correctly", async () => {
      await setCoachMarkCompleted("welcome", 1, "driver_test");
      expect(await isCoachMarkCompleted("welcome", 1, "driver_test")).toBe(true);

      await resetCoachMark("welcome", 1, "driver_test");
      expect(await isCoachMarkCompleted("welcome", 1, "driver_test")).toBe(false);
    });

    it("resets all coach marks for a specific driver without touching other drivers", async () => {
      await setCoachMarkCompleted("pretrip", 1, "driver_A");
      await setCoachMarkCompleted("live_trip", 1, "driver_A");
      await setCoachMarkCompleted("map_intro", 1, "driver_A");
      await setCoachMarkCompleted("pretrip", 1, "driver_B");

      await resetAllCoachMarks("driver_A");

      expect(await isCoachMarkCompleted("pretrip", 1, "driver_A")).toBe(false);
      expect(await isCoachMarkCompleted("live_trip", 1, "driver_A")).toBe(false);
      expect(await isCoachMarkCompleted("map_intro", 1, "driver_A")).toBe(false);
      // driver_B remains completed
      expect(await isCoachMarkCompleted("pretrip", 1, "driver_B")).toBe(true);
    });
  });

  describe("Interaction Modes & Protected Action Rules", () => {
    it("ensures all milestone steps define explicit interaction modes", () => {
      const allowedModes = ["passthrough", "observe", "blocked"];
      for (const key of ALL_COACH_MARK_KEYS) {
        const config = getMilestoneConfig(key);
        for (const step of config.steps) {
          expect(allowedModes).toContain(step.interaction);
        }
      }
    });

    it("guarantees protected actions are blocked and NEVER tutorial-required", () => {
      // SOS
      const sosConfig = getMilestoneConfig("sos");
      expect(sosConfig.steps[0].interaction).toBe("blocked");
      expect(sosConfig.steps[0].actionText).toBe("Got it");

      // Start Trip
      const readinessConfig = getMilestoneConfig("trip_readiness");
      const startTripStep = readinessConfig.steps[2];
      expect(startTripStep.targetId).toBe("trip.primary_action");
      expect(startTripStep.interaction).toBe("blocked");
      expect(startTripStep.actionText).toBe("Got it");

      // Trip Progression Swipe
      const liveTripConfig = getMilestoneConfig("live_trip");
      const progressionStep = liveTripConfig.steps[2];
      expect(progressionStep.targetId).toBe("map.trip_progression");
      expect(progressionStep.interaction).toBe("blocked");
      expect(progressionStep.actionText).toBe("Got it");
    });

    it("lets Complete Inspection be tapped while its step is open", () => {
      // The deliberate exception to the rule above, so the reason travels with
      // it: this step's copy instructs "Tap here", and `blocked` swallows the
      // tap on the cutout — the only way through was the tooltip's own "Got it"
      // first, which made the instruction false and the button cost two taps.
      //
      // What "blocked" protects is an action that must not fire by accident:
      // SOS, Start Trip, the trip-progression swipe. This is a plain submit, and
      // on the tour path it writes nothing — `handleSubmit` opens the completion
      // modal and returns when `isTour`.
      const completeConfig = getMilestoneConfig("pretrip_complete");
      expect(completeConfig.steps[0].targetId).toBe("inspection.complete");
      expect(completeConfig.steps[0].interaction).toBe("passthrough");
      expect(completeConfig.steps[0].actionText).toBe("Got it");
      expect(completeConfig.steps[0].requiresInteraction).toBeUndefined();
    });

    it("guarantees safe interactive steps have passthrough mode", () => {
      // Pre-Trip PASS/FAIL
      const pretrip = getMilestoneConfig("pretrip");
      expect(pretrip.steps[0].targetId).toBe("inspection.pass_fail");
      expect(pretrip.steps[0].interaction).toBe("passthrough");

      // Pre-Trip Remarks
      const remarks = getMilestoneConfig("pretrip_remarks");
      expect(remarks.steps[0].targetId).toBe("inspection.remarks");
      expect(remarks.steps[0].interaction).toBe("passthrough");

      // Incident category selection
      const incident = getMilestoneConfig("incident");
      const categoryStep = incident.steps.find((s) => s.id === "incident.category");
      expect(categoryStep.targetId).toBe("incident.category");
      expect(categoryStep.interaction).toBe("passthrough");

      // Fuel intro is a protected simulation until the demo hands back to
      // the real Scan receipt card; verification fields remain passthrough.
      const fuelIntro = getMilestoneConfig("fuel_scan_intro");
      expect(fuelIntro.steps[0].targetId).toBe("fuel.scan_entry");
      expect(fuelIntro.steps[0].presentation).toBe("simulation");
      expect(fuelIntro.steps[0].demoKey).toBe("fuel_receipt_scan");

      const fuelCapture = getMilestoneConfig("fuel_scan_capture");
      expect(fuelCapture.version).toBe(2);
      expect(fuelCapture.steps[0].targetId).toBe("fuel.viewfinder");
      expect(fuelCapture.steps[0].presentation).toBe("compact");

      const fuelVerify = getMilestoneConfig("fuel_scan_verify");
      expect(fuelVerify.steps[0].targetId).toBe("fuel.verify");
      expect(fuelVerify.steps[0].interaction).toBe("passthrough");
      expect(fuelVerify.steps[0].presentation).toBe("compact");
    });
  });

  describe("Target Registry & Stale Measurement Prevention", () => {
    // Pure function simulating CoachMarkProvider's target registration logic
    function createTargetRegistry() {
      let targets = {};
      let currentPathname = "/";
      let currentPresentationId = 1;

      return {
        setRoute: (p) => {
          currentPathname = p;
        },
        setPresentationId: (id) => {
          currentPresentationId = id;
        },
        bumpPresentationId: () => {
          currentPresentationId += 1;
          return currentPresentationId;
        },
        register: (targetId, layout, route, presentationId) => {
          if (!targetId || !layout) return false;
          if (layout.width <= 0 || layout.height <= 0) return false;
          const targetRoute = route || layout.route || currentPathname;
          const pid = presentationId ?? layout.presentationId ?? currentPresentationId;
          targets[targetId] = { ...layout, route: targetRoute, presentationId: pid };
          return true;
        },
        unregister: (targetId) => {
          delete targets[targetId];
        },
        getActiveLayout: (step) => {
          if (!step?.targetId) return null;
          const layout = targets[step.targetId];
          if (!layout) return null;
          if (layout.width <= 0 || layout.height <= 0) return null;
          if (layout.route && !isRouteMatch(currentPathname, layout.route)) return null;
          if (layout.presentationId !== currentPresentationId) return null;
          return layout;
        },
        shouldShowOverlay: (milestone, step) => {
          if (!milestone) return false;
          if (!isRouteMatch(currentPathname, milestone.route)) return false;
          if (!step?.targetId) return true; // Dialog/centered card without target
          const activeLayout = targets[step.targetId];
          if (!activeLayout) return false;
          if (activeLayout.width <= 0 || activeLayout.height <= 0) return false;
          if (activeLayout.route && !isRouteMatch(currentPathname, activeLayout.route)) return false;
          if (activeLayout.presentationId !== currentPresentationId) return false;
          return true;
        },
      };
    }

    it("registers valid positive dimensions and retrieves layout on matching route", () => {
      const registry = createTargetRegistry();
      registry.setRoute("/(app)/incidents");

      const success = registry.register(
        "incident.category",
        { x: 16, y: 320, width: 360, height: 280, radius: 14, padding: 8 },
        "/incidents"
      );
      expect(success).toBe(true);

      const step = { targetId: "incident.category" };
      const layout = registry.getActiveLayout(step);
      expect(layout).not.toBeNull();
      expect(layout.width).toBe(360);
      expect(layout.height).toBe(280);
    });

    it("rejects zero-size or negative dimensions (unmeasured/collapsed targets)", () => {
      const registry = createTargetRegistry();
      registry.setRoute("/(app)/inspection");

      const rejectedZero = registry.register("inspection.pass_fail", {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
      expect(rejectedZero).toBe(false);

      const rejectedNeg = registry.register("inspection.remarks", {
        x: 10,
        y: 20,
        width: -5,
        height: 40,
      });
      expect(rejectedNeg).toBe(false);

      expect(registry.getActiveLayout({ targetId: "inspection.pass_fail" })).toBeNull();
    });

    it("prevents stale measurements across screens (Root Cause of Home screen cross-route spotlight bug)", () => {
      const registry = createTargetRegistry();
      // Target was registered on /incidents
      registry.setRoute("/(app)/incidents");
      registry.register(
        "incident.category",
        { x: 16, y: 320, width: 360, height: 280 },
        "/incidents"
      );

      // Driver navigates to Home screen /(app)/(tabs)
      registry.setRoute("/(app)/(tabs)");

      const incidentMilestone = getMilestoneConfig("incident");
      const categoryStep = incidentMilestone.steps.find((s) => s.id === "incident.category");

      // While on Home, getActiveLayout MUST return null for incident.category
      expect(registry.getActiveLayout(categoryStep)).toBeNull();

      // And shouldShowOverlay MUST return false (never spotlights Home quick actions or SOS)
      expect(registry.shouldShowOverlay(incidentMilestone, categoryStep)).toBe(false);
    });

    it("unregisters target on unmount", () => {
      const registry = createTargetRegistry();
      registry.setRoute("/(app)/inspection");
      registry.register("inspection.remarks", { x: 20, y: 400, width: 340, height: 80 });

      expect(registry.getActiveLayout({ targetId: "inspection.remarks" })).not.toBeNull();

      // Component unmounts
      registry.unregister("inspection.remarks");
      expect(registry.getActiveLayout({ targetId: "inspection.remarks" })).toBeNull();
    });

    it("updates coordinates when target changes position after scrolling", () => {
      const registry = createTargetRegistry();
      registry.setRoute("/(app)/incidents");

      // Initial position (e.g. before scroll)
      registry.register("incident.category", { x: 16, y: 550, width: 360, height: 280 });
      expect(registry.getActiveLayout({ targetId: "incident.category" }).y).toBe(550);

      // After user or auto-scroll settles, target remeasures with new window Y
      registry.register("incident.category", { x: 16, y: 220, width: 360, height: 280 });
      expect(registry.getActiveLayout({ targetId: "incident.category" }).y).toBe(220);
    });

    it("handles conditional target mounting (Remarks appears only after FAIL)", () => {
      const registry = createTargetRegistry();
      registry.setRoute("/(app)/inspection");

      const remarksMilestone = getMilestoneConfig("pretrip_remarks");
      const remarksStep = remarksMilestone.steps[0];

      // Initially before FAIL is tapped, Remarks is unmounted
      expect(registry.getActiveLayout(remarksStep)).toBeNull();
      expect(registry.shouldShowOverlay(remarksMilestone, remarksStep)).toBe(false);

      // Driver taps FAIL -> Remarks mounts and measures
      registry.register("inspection.remarks", { x: 20, y: 380, width: 340, height: 90 });

      // Now overlay can safely show
      expect(registry.getActiveLayout(remarksStep)).not.toBeNull();
      expect(registry.shouldShowOverlay(remarksMilestone, remarksStep)).toBe(true);
    });

    it("stands aside safely if target disappears while coach mark is open", () => {
      const registry = createTargetRegistry();
      registry.setRoute("/(app)/inspection");

      const pretripMilestone = getMilestoneConfig("pretrip");
      const passFailStep = pretripMilestone.steps[0];

      registry.register("inspection.pass_fail", { x: 16, y: 240, width: 360, height: 60 });
      expect(registry.shouldShowOverlay(pretripMilestone, passFailStep)).toBe(true);

      // Target unmounts (e.g. list changes or screen navigated away)
      registry.unregister("inspection.pass_fail");
      expect(registry.shouldShowOverlay(pretripMilestone, passFailStep)).toBe(false);
    });

    it("rejects stale presentation generations (Test 1: gen 4 rejected when active is 5)", () => {
      const registry = createTargetRegistry();
      registry.setRoute("/(app)/(tabs)");
      registry.setPresentationId(5);

      // Target registered with older generation 4 (e.g. before milestone or step activated)
      registry.register("incident.sos", { x: 316, y: 357, width: 64, height: 64 }, "/", 4);

      const sosStep = { targetId: "incident.sos" };
      const sosMilestone = getMilestoneConfig("sos");

      // Stale layout rejected: activeLayout is null, overlay is hidden
      expect(registry.getActiveLayout(sosStep)).toBeNull();
      expect(registry.shouldShowOverlay(sosMilestone, sosStep)).toBe(false);
    });

    it("accepts fresh presentation generations (Test 2: gen 5 accepted when active is 5)", () => {
      const registry = createTargetRegistry();
      registry.setRoute("/(app)/(tabs)");
      registry.setPresentationId(5);

      // Fresh registration stamped with active generation 5
      registry.register("incident.sos", { x: 316, y: 421, width: 64, height: 64 }, "/", 5);

      const sosStep = { targetId: "incident.sos" };
      const sosMilestone = getMilestoneConfig("sos");

      expect(registry.getActiveLayout(sosStep)).not.toBeNull();
      expect(registry.getActiveLayout(sosStep).y).toBe(421);
      expect(registry.shouldShowOverlay(sosMilestone, sosStep)).toBe(true);
    });

    it("requires a new measurement on step transition (Test 3: step 1 bounds cannot render step 2 overlay)", () => {
      const registry = createTargetRegistry();
      registry.setRoute("/(app)/trip");
      registry.setPresentationId(10);

      const readinessMilestone = getMilestoneConfig("trip_readiness");
      const step1 = readinessMilestone.steps[0]; // trip.readiness
      const step2 = readinessMilestone.steps[1]; // trip.pretrip_requirement

      // Step 1 registered for generation 10
      registry.register("trip.readiness", { x: 16, y: 120, width: 340, height: 80 }, "/trip", 10);
      expect(registry.getActiveLayout(step1)).not.toBeNull();

      // Step advances to Step 2 -> presentation generation increments to 11
      registry.bumpPresentationId(); // now 11

      // Step 2 has not yet registered with gen 11
      expect(registry.getActiveLayout(step2)).toBeNull();
      expect(registry.shouldShowOverlay(readinessMilestone, step2)).toBe(false);

      // Once step 2 registers with gen 11, it renders
      registry.register("trip.pretrip_requirement", { x: 16, y: 220, width: 340, height: 80 }, "/trip", 11);
      expect(registry.getActiveLayout(step2)).not.toBeNull();
      expect(registry.shouldShowOverlay(readinessMilestone, step2)).toBe(true);
    });

    it("invalidates presentation on route change (Test 4)", () => {
      const registry = createTargetRegistry();
      registry.setRoute("/(app)/(tabs)");
      registry.setPresentationId(1);
      registry.register("incident.sos", { x: 316, y: 421, width: 64, height: 64 }, "/");

      expect(registry.getActiveLayout({ targetId: "incident.sos" })).not.toBeNull();

      // Navigates away to inspection
      registry.setRoute("/(app)/inspection");
      expect(registry.getActiveLayout({ targetId: "incident.sos" })).toBeNull();
    });

    it("invalidates registration when component drops target (Test 5)", () => {
      const registry = createTargetRegistry();
      registry.setRoute("/(app)/incidents");
      registry.setPresentationId(1);
      registry.register("incident.category", { x: 16, y: 200, width: 360, height: 280 }, "/incidents", 1);

      expect(registry.getActiveLayout({ targetId: "incident.category" })).not.toBeNull();

      // Target dropped (blur / unmount)
      registry.unregister("incident.category");
      expect(registry.getActiveLayout({ targetId: "incident.category" })).toBeNull();
    });

    it("updates to settled coordinates on layout revision (Test 6: SOS resting position update)", () => {
      const registry = createTargetRegistry();
      registry.setRoute("/(app)/(tabs)");
      registry.setPresentationId(12);

      // Initial mount (unhydrated or before drag)
      registry.register("incident.sos", { x: 316, y: 357, width: 64, height: 64 }, "/", 12);
      expect(registry.getActiveLayout({ targetId: "incident.sos" }).y).toBe(357);

      // SOS drag settles / spring finishes -> forces remeasurement at settled Y
      registry.register("incident.sos", { x: 316, y: 421, width: 64, height: 64 }, "/", 12);
      expect(registry.getActiveLayout({ targetId: "incident.sos" }).y).toBe(421);
    });
  });

  describe("Spotlight Bounds & 4-Scrim Blocker Architecture", () => {
    it("computes exact spotlight bounds with 8dp breathing room", () => {
      const target = { x: 20, y: 150, width: 320, height: 60, padding: 8 };
      const pad = target.padding;

      const spotX = Math.max(0, target.x - pad);
      const spotY = Math.max(0, target.y - pad);
      const spotW = target.width + pad * 2;
      const spotH = target.height + pad * 2;

      expect(spotX).toBe(12);
      expect(spotY).toBe(142);
      expect(spotW).toBe(336);
      expect(spotH).toBe(76);
    });

    it("calculates 4-scrim blocking regions leaving target hole uncovered", () => {
      const SCREEN_WIDTH = 390;
      const SCREEN_HEIGHT = 844;
      const spotX = 12;
      const spotY = 142;
      const spotW = 336;
      const spotH = 76;

      const topBlocker = { top: 0, left: 0, right: 0, height: spotY };
      const bottomBlocker = { top: spotY + spotH, left: 0, right: 0, bottom: 0 };
      const leftBlocker = { top: spotY, left: 0, width: spotX, height: spotH };
      const rightBlocker = { top: spotY, left: spotX + spotW, right: 0, height: spotH };

      // Top blocker covers from top to spotlight top
      expect(topBlocker.height).toBe(142);
      // Bottom blocker starts after spotlight bottom
      expect(bottomBlocker.top).toBe(218);
      // Left blocker covers left of spotlight
      expect(leftBlocker.width).toBe(12);
      // Right blocker starts after spotlight right
      expect(rightBlocker.left).toBe(348);
    });

    it("positions tooltip below target when sufficient space exists and above otherwise", () => {
      const SCREEN_HEIGHT = 844;
      const safeTop = 44;
      const safeBottom = 34;

      // Case 1: Target near top (y = 100, height = 80)
      const targetTop = { spotY: 100, spotH: 80 };
      const spaceBelowTop = SCREEN_HEIGHT - (targetTop.spotY + targetTop.spotH) - safeBottom;
      const spaceAboveTop = targetTop.spotY - safeTop;
      const isTargetInLowerHalfTop = spaceBelowTop < 190 && spaceAboveTop >= spaceBelowTop;

      expect(isTargetInLowerHalfTop).toBe(false); // Tooltip goes below target

      // Case 2: Target near bottom (y = 700, height = 60)
      const targetBottom = { spotY: 700, spotH: 60 };
      const spaceBelowBottom = SCREEN_HEIGHT - (targetBottom.spotY + targetBottom.spotH) - safeBottom;
      const spaceAboveBottom = targetBottom.spotY - safeTop;
      const isTargetInLowerHalfBottom = spaceBelowBottom < 190 && spaceAboveBottom >= spaceBelowBottom;

      expect(isTargetInLowerHalfBottom).toBe(true); // Tooltip goes above target
    });
  });
});

// The coach-mark subsystem is a React Native component tree, and
// vitest.config.mjs includes only `src/**` and `mobile/lib/**` — nothing under
// mobile/components or mobile/app. So the wiring below cannot be exercised
// through a renderer here. It is asserted as source text instead, following the
// `src/security-boundaries.test.js` pattern.
//
// Be honest about what that buys: these catch a deletion or a revert, not a
// subtle rewrite. They are a tripwire, not a proof. The copy assertions in the
// first block are exact, because copy is data and can be checked exactly.
describe("Spec Alignment & Coach Mark Wiring", () => {
  describe("Copy matches Capstone: Driver In-App Guide", () => {
    it("uses the §2 first-launch introduction copy verbatim", () => {
      const welcome = getMilestoneConfig("welcome");
      const step = welcome.steps[0];

      expect(step.title).toBe("Welcome to FleetOps!");
      expect(step.body).toBe(
        "We'll guide you through important actions as you use the app. Tips will appear only when they're relevant."
      );

      // The milestone-level copy duplicates its single step. Two copies that
      // disagree is how the spec drift started, so hold them together.
      expect(welcome.title).toBe(step.title);
      expect(welcome.body).toBe(step.body);
    });

    it("uses the §3.6 offline copy verbatim", () => {
      const offline = getMilestoneConfig("offline");

      expect(offline.steps[0].title).toBe("Offline Mode");
      expect(offline.steps[0].body).toBe(
        "You can continue viewing saved trip information. Any updates you make will be saved locally and automatically synced when you're back online."
      );
    });
  });

  describe("Driving Safety Lock (§7.1) is fed by real evidence", () => {
    const provider = readFileSync(
      new URL("../components/coachmarks/CoachMarkProvider.jsx", import.meta.url),
      "utf8"
    );
    const tracking = readFileSync(new URL("./tracking.js", import.meta.url), "utf8");

    it("takes motion from the hook, not from a prop nobody passes", () => {
      // The regression: the provider accepted `isDriving = false` and its only
      // call site passed `driverId` alone, so the lock could never engage.
      expect(provider).toContain("export function CoachMarkProvider({ children, driverId })");
      expect(provider).toContain("const isDriving = useIsDriving();");
      expect(provider).not.toMatch(/isDriving\s*=\s*false/);
    });

    it("exposes isDriving on the context so screens can respect the lock", () => {
      expect(provider).toMatch(/^\s*isDriving,$/m);
    });

    it("dismisses open non-Map marks when motion starts, without burning them", () => {
      expect(provider).toContain('if (isDriving && activeKeyRef.current !== "map_intro")');

      // Abandoning must not write completion: a tip the driver never read has
      // to come back once they are stationary.
      const start = provider.indexOf("const abandonActiveMilestone = useCallback");
      const end = provider.indexOf("// Triggering with driver isolation");
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      expect(provider.slice(start, end)).not.toContain("setCoachMarkCompleted");
    });

    it("re-checks the lock after its async storage read", () => {
      // Reading coach-mark storage yields, and motion can begin during that
      // window. A safety gate must not let a pre-await check stand.
      expect(provider).toContain("if (isDrivingRef.current) return false;");
      expect(provider).toContain("isDrivingRef.current = isDriving;");
    });

    it("publishes raw speed evidence from the one GPS poster", () => {
      // coords.speed is metres per second; this is the raw reading, converted
      // exactly once in motion-state.
      expect(tracking).toContain("motionSpeedMs: loc.coords.speed ?? null");
      expect(tracking).toContain("export function useIsDriving()");
      expect(tracking).toContain("export function subscribePosterStatus(");
      // The 30 s publish must not put the whole app tree into state — the coach
      // mark provider wraps it.
      expect(provider).toContain("useIsDriving");
      expect(provider).not.toContain("usePosterStatus()");
    });
  });

  describe("One guide at a time", () => {
    const provider = readFileSync(
      new URL("../components/coachmarks/CoachMarkProvider.jsx", import.meta.url),
      "utf8"
    );

    it("never lets a trigger pre-empt a guide that is on screen", () => {
      expect(provider).toContain("if (overlayVisibleRef.current) return false;");
      expect(provider).toContain("overlayVisibleRef.current = shouldShowOverlay;");
      // Set synchronously, before the state lands, so ownership is not a render
      // behind — that window is exactly where two triggers in one tick collide.
      expect(provider).toContain("activeKeyRef.current = config.key;");
    });

    it("scopes the guard to the screen, so a hidden guide cannot wedge the app", () => {
      // Blocking on "a milestone is active" rather than "a milestone is visible"
      // would strand the driver: a guide left behind by navigation is hidden, so
      // it offers nothing to dismiss, and every later guide would be refused.
      expect(provider).toContain("if (activeKeyRef.current !== claimedBefore) return false;");
    });

    it("keeps triggerMilestone's identity off the active milestone", () => {
      // Its identity is in the deps of most screens' trigger effects. Letting it
      // change on every milestone transition would re-fire them, so the guard
      // lives in a ref and `activeMilestoneKey` stays out of these deps.
      //
      // `releaseActiveIfOffRoute` is the one addition, and it is safe to depend
      // on because it is itself stable: the pathname it compares against is read
      // from `pathnameRef`, not from the `pathname` state, precisely so a
      // navigation does not change this callback's identity either.
      expect(provider).toMatch(
        /\[driverId, isDriving, releaseActiveIfOffRoute\]\s*\);/
      );
    });

    it("parks an off-route guide instead of burning it or restarting it", () => {
      // The Map tour stays active at its start-swipe step for the whole time the
      // driver is inside the inspection screen. Refusing every other trigger
      // while it did was what made the pre-trip tooltips unreachable.
      expect(provider).toContain("const parkedMilestoneRef = useRef(null);");
      expect(provider).toContain("const releaseActiveIfOffRoute = useCallback(");
      expect(provider).toContain(
        "const offRoute = !config || !isRouteMatch(pathnameRef.current, config.route);"
      );

      // A guide still on its own route keeps the screen — one guide per screen.
      expect(provider).toContain("if (!offRoute) return false;");

      // Parking is not abandonment: no `mapIntroAwaitingTap`, which would force
      // a fresh Map-tab tap and restart the tour at step 0, throwing away the
      // practice stages already completed. The helper's own body must not set
      // it — the only writer is `abandonActiveMilestone`.
      const helper = provider.slice(
        provider.indexOf("const releaseActiveIfOffRoute = useCallback("),
        provider.indexOf("// Triggering with driver isolation")
      );
      expect(helper).not.toContain("mapIntroAwaitingTap");

      // Nor completion: a step the driver has not read must not be burned.
      expect(helper).not.toContain("setCoachMarkCompleted");
    });

    it("resumes a parked guide only on its own route", () => {
      // The resume is keyed on the pathname because the driver returns through a
      // button in another screen; there is no call site to hang it off.
      const resume = provider.slice(
        provider.indexOf("// Resume a guide the driver navigated away from"),
        provider.indexOf("// Intentional Map-tab entry point")
      );
      expect(resume).toContain("if (!parked) return;");
      // A slot whose route has not come back keeps its occupant through
      // unrelated navigations, so this returns without clearing it.
      expect(resume).toContain("if (!isRouteMatch(pathname, config.route)) return;");
      // The async Map-tab reservation wins the screen when it is in flight.
      expect(resume).toContain("if (mapIntroPendingRef.current) return;");
      expect(resume).toContain("if (!releaseActiveIfOffRoute(false)) return;");
      // Restores the step it was parked on, not step 0.
      expect(resume).toContain("Math.min(parked.stepIndex");
    });
  });

  describe("First Map tour wiring", () => {
    const provider = readFileSync(
      new URL("../components/coachmarks/CoachMarkProvider.jsx", import.meta.url),
      "utf8"
    );
    const tabBar = readFileSync(
      new URL("../components/CurvedPillTabBar.js", import.meta.url),
      "utf8"
    );
    const mapScreen = readFileSync(
      new URL("../app/(app)/(tabs)/map.js", import.meta.url),
      "utf8"
    );
    const practice = readFileSync(
      new URL("../components/MapIntroPractice.jsx", import.meta.url),
      "utf8"
    );
    const overlay = readFileSync(
      new URL("../components/coachmarks/CoachMarkOverlay.jsx", import.meta.url),
      "utf8"
    );
    const tomTomMap = readFileSync(
      new URL("../components/TomTomMap.js", import.meta.url),
      "utf8"
    );

    it("starts only from the intentional Map-tab handler", () => {
      expect(tabBar).toContain("triggerMapIntroFromTab");
      expect(tabBar).toContain("isMapTabIntent(routeName)");
      expect(mapScreen).not.toContain('triggerMilestone("map_intro")');
    });

    it("reserves the Map tour before tabPress can be prevented", () => {
      const handler = tabBar.slice(tabBar.indexOf("const isFocused = activeRouteName === routeName;"));
      expect(handler.indexOf("triggerMapIntroFromTab")).toBeLessThan(handler.indexOf("navigation.emit"));
    });

    it("keeps the live-trip race guard and swipe gate opt-in", () => {
      expect(provider).toContain("mapIntroPendingRef");
      expect(provider).toContain('activeKeyRef.current === "map_intro"');
      expect(provider).toContain("currentStep?.requiresInteraction");
      expect(provider).toContain("data?.success !== true");
    });

    it("lets a category tap satisfy the gate that requires it", () => {
      // The gate and its satisfier have to live in the same branch. A
      // `requiresInteraction` step refuses to advance until the ref is set, so
      // a category branch that only called `nextStep` would swallow every tap.
      const start = provider.indexOf('targetId === "incident.category" &&');
      const branch = provider.slice(
        start,
        provider.indexOf("Incident Submit (Tour Mode)", start)
      );

      expect(branch).toContain("if (!data) return;");
      expect(branch).toContain("interactionSatisfiedRef.current = currentStep.id;");
      expect(
        branch.indexOf("interactionSatisfiedRef.current = currentStep.id;")
      ).toBeLessThan(branch.indexOf("await nextStep();"));
    });

    it("lets an intentional Map tap take priority over reset's Home welcome", () => {
      expect(provider).toContain('if (activeKeyRef.current === "welcome")');
      expect(provider).toContain("abandonActiveMilestone();");
      expect(provider).toContain('milestoneKey !== "map_intro"');
      expect(overlay).toContain('const isWelcomeCard = milestone?.key === "welcome"');
      expect(overlay).toContain('pointerEvents={isWelcomeCard ? "box-none" : "auto"}');
    });

    it("does not inject a custom fallback car icon", () => {
      expect(tomTomMap).not.toContain("FALLBACK_CAR_IMAGE");
      expect(tomTomMap).not.toContain("const fallbackCarImage");
      expect(tomTomMap).toContain("radial-gradient(circle, #70B991 0 6px, transparent 7px)");
      expect(tomTomMap).toContain("cachedCarImage || carImage");
    });

    it("anchors only the new Map targets and keeps the production targets", () => {
      expect(mapScreen).toContain('targetId="map.standby_status"');
      expect(mapScreen).toContain('targetId="map.controls"');
      expect(mapScreen).toContain('targetId="map.layers"');
      expect(mapScreen).toContain('targetId="map.trip_practice"');
      expect(mapScreen).toContain('targetId="map.current_target"');
      expect(mapScreen).toContain('targetId="map.telemetry"');
      expect(mapScreen).toContain('targetId="map.trip_progression"');
    });

    it("keeps tutorial practice away from production APIs", () => {
      expect(practice).not.toContain("lib/api");
      expect(practice).not.toContain("/api/trips/");
      expect(practice).toContain("Vibration.vibrate(10)");
    });

    it("keeps tutorial rendering off the normal GPS render path", () => {
      expect(practice).toContain("React.memo(MapIntroPractice)");
      expect(mapScreen).toContain("const mapIntroPractice = useMemo");
    });

    it("mounts Map targets while the first visit is waiting for GPS", () => {
      expect(mapScreen).toContain('const shouldRenderMapBeforeGps = activeMilestone === "map_intro" || mapIntroPending');
      expect(mapScreen).toContain("!gpsTimedOut && !shouldRenderMapBeforeGps");
    });

    it("keeps the first Map walkthrough independent from GPS permission and motion", () => {
      expect(mapScreen).toContain("if (permissionDenied && !shouldRenderMapBeforeGps)");
      const mapTrigger = provider.slice(provider.indexOf("const triggerMapIntroFromTab"));
      const mapTriggerEnd = mapTrigger.indexOf("const completeActiveMilestone");
      expect(mapTrigger.slice(0, mapTriggerEnd)).not.toContain("isDrivingRef.current");
      expect(provider).toContain('activeKeyRef.current !== "map_intro"');
    });
  });

  describe("A spotlight can never point at nothing", () => {
    const provider = readFileSync(
      new URL("../components/coachmarks/CoachMarkProvider.jsx", import.meta.url),
      "utf8"
    );
    const target = readFileSync(
      new URL("../components/coachmarks/CoachMarkTarget.jsx", import.meta.url),
      "utf8"
    );
    const overlay = readFileSync(
      new URL("../components/coachmarks/CoachMarkOverlay.jsx", import.meta.url),
      "utf8"
    );

    it("rejects only a target lying entirely outside the window", () => {
      // A whole-box test against the window, not against a margin. The previous
      // `insets.top + 40` / `SCREEN_HEIGHT - insets.bottom - 80` slack refused
      // `map.standby_status` on a device run: it measured y=16, height=49.8 —
      // entirely visible — and a top-anchored target is legitimately at the top
      // of the screen by design. Partial visibility must present (the
      // auto-scroll settles it), so there is no margin to regress back to.
      expect(provider).toContain("if (layout.y + layout.height <= 0) {");
      expect(provider).toContain('rejected("target entirely above the window"');
      expect(provider).toContain("if (layout.y >= SCREEN_HEIGHT) {");
      expect(provider).toContain('rejected("target entirely below the window"');
      expect(provider).not.toContain("minSafeY");
      expect(provider).not.toContain("maxSafeY");
    });

    it("scopes unmount to the registering instance", () => {
      // `inspection.remarks` mounts once per failed item. Before tokens, the
      // unmount of either one deleted the other's live registration.
      expect(target).toContain("unregisterTarget(effectiveId, token)");
      expect(provider).toContain("if (!byToken.delete(token)) return;");
    });

    it("drives the scrim and cutout from the animated bounds", () => {
      // These four values were animated for 240 ms and then never referenced in
      // JSX, so a re-measuring target snapped the spotlight instead of moving it.
      expect(overlay).toContain("left: animX,");
      expect(overlay).toContain("top: animBottom,");
      expect(overlay).toContain("left: animRight,");
      expect(overlay).toContain("width: animW,");
      expect(overlay).toContain("height: animH,");
    });
  });

  describe("One instance, one spotlight", () => {
    // A target id can legitimately be live more than once — `inspection.remarks`
    // mounts once per failed item — so the provider cannot simply refuse a
    // second registration. What it can refuse is a registration from an
    // instance in no position to own the spotlight: one whose screen is not on
    // top, and one whose mount is already gone.
    const target = readFileSync(
      new URL("../components/coachmarks/CoachMarkTarget.jsx", import.meta.url),
      "utf8"
    );
    const provider = readFileSync(
      new URL("../components/coachmarks/CoachMarkProvider.jsx", import.meta.url),
      "utf8"
    );

    it("registers only while the target's screen is focused", () => {
      // Reported live: `incident.category` registered twice with bounds 145.7dp
      // apart, so the spotlight jumped between two boxes on every keyboard or
      // dimension event. A covered stack screen, a background tab and a route
      // expo-router preloaded for `router.prefetch` are all mounted; only one of
      // them is on screen.
      expect(target).toContain("const isFocused = useIsFocused();");
      expect(target).toContain("if (!isFocused) return;");
      expect(target).toContain("isFocusedRef.current = isFocused;");
    });

    it("drops its registration when the screen blurs", () => {
      const start = target.indexOf("// Losing focus gives up the registration");
      const end = target.indexOf("// Cleanup on unmount");
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      expect(target.slice(start, end)).toContain(
        "unregisterTarget(effectiveId, token)"
      );
    });

    it("re-checks focus and mount at every async registration", () => {
      // measureInWindow is a native round trip and the settle timer fires 320ms
      // out, so what was true where the work was scheduled is not necessarily
      // true where it lands.
      expect(target).toContain("const canRegister = useCallback(");
      expect(target).toContain("() => mountedRef.current && isFocusedRef.current,");
      // 6, not 5: the bounded retry for an unusable measurement added one more
      // native round trip, and it re-checks for exactly this reason.
      expect(target.match(/if \(!canRegister\(\)\) return;/g)).toHaveLength(6);
      expect(target).toContain("mountedRef.current = false;");
    });

    it("cancels the scroll-settle timer on unmount", () => {
      // Its callback registers, and the unregister in the same cleanup has
      // already run by the time it fires — leaving an entry nothing removes.
      expect(target).toContain("settleTimerRef.current = setTimeout(");
      expect(target).toContain("clearTimeout(settleTimerRef.current);");
    });

    it("names the mount behind a duplicate registration", () => {
      // The bounds alone cannot say whether the second registration came from a
      // second screen or from a callback that outlived its own.
      expect(target).toContain("(instanceCounter += 1)");
      expect(provider).toContain("instanceId,");
      expect(provider).toContain("Live instances under this id: ${byToken.size}.");
      expect(provider).toContain("new Error().stack");
    });
  });

  describe("Trip Readiness is a pre-start milestone", () => {
    const tripScreen = readFileSync(
      new URL("../app/(app)/trip/[id].js", import.meta.url),
      "utf8"
    );

    it("triggers only in the presentation its targets exist in", () => {
      // Every step targets a control that only exists pre-start. Fired for an
      // underway trip it spotlighted the wrong line and then left steps 2-3 with
      // no target at all — overlay hidden, milestone active and unable to
      // complete, which now also blocks every guide after it.
      expect(tripScreen).toContain("if (loading || !trip || isTerminal || !isPreStart || activeMilestone) return;");
      expect(tripScreen).toContain('triggerMilestone("trip_readiness")');
    });

    it("retires the guide when the driver starts the trip", () => {
      expect(tripScreen).toContain("Promise.resolve(dismiss()).catch(() => {});");
    });

    it("covers step 2 even with no verified start window", () => {
      const matches = tripScreen.match(/targetId="trip\.pretrip_requirement"/g) || [];
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it("re-fires trip_readiness once the blocking guide dismisses", () => {
      expect(tripScreen).toContain("if (loading || !trip || isTerminal || !isPreStart || activeMilestone) return;");
      expect(tripScreen).toContain("[loading, trip, isTerminal, isPreStart, activeMilestone, triggerMilestone]");
    });
  });

  describe("Presentation generation & fresh measurement contract", () => {
    const provider = readFileSync(
      new URL("../components/coachmarks/CoachMarkProvider.jsx", import.meta.url),
      "utf8"
    );
    const target = readFileSync(
      new URL("../components/coachmarks/CoachMarkTarget.jsx", import.meta.url),
      "utf8"
    );
    const driverSos = readFileSync(
      new URL("../components/DriverSos.js", import.meta.url),
      "utf8"
    );

    it("enforces presentationId matching activePresentationId in activeTargetLayout", () => {
      expect(provider).toContain("if (layout.presentationId !== activePresentationId) {");
      expect(provider).toContain('rejected("target registered by a stale presentation"');
      expect(provider).toContain("activePresentationId,");
    });

    it("stamps target registrations with activePresentationId in CoachMarkTarget", () => {
      expect(target).toContain("presentationId: activePresentationId,");
      expect(target).toContain("activePresentationId,");
    });

    it("supports measureRevision for transformed targets in CoachMarkTarget", () => {
      expect(target).toContain("measureRevision,");
      expect(target).toContain("if (measureRevision == null) return;");
    });

    it("hardens DriverSos with positionReady gating and passes measureRevision", () => {
      expect(driverSos).toContain("positionReady");
      expect(driverSos).toContain("measureRevision={layoutRevision}");
      expect(driverSos).toContain("setLayoutRevision((r) => r + 1);");
    });
  });

  // ── Context partition ──────────────────────────────────────────────────────
  //
  // The guide used to publish one value object, built as a fresh literal on
  // every provider render. A context value is compared by identity, so every
  // consumer re-rendered whenever ANYTHING in the provider changed — a route
  // change, a window resize, one target settling — and all ~24 targets plus the
  // always-mounted tab bar, SOS button and connectivity banner re-rendered on
  // every step transition.
  //
  // There is no renderer in this suite, so this cannot count renders. What it
  // can do is pin the structure that produces the counts, and pin the two
  // screens whose re-render cost is the reason the split exists. Both screen
  // assertions are deliberate tripwires: if a change needs the volatile context
  // in one of them, this fails and the perf consequence gets looked at rather
  // than discovered on a device.
  describe("Coach-mark context partition", () => {
    const provider = readFileSync(
      new URL("../components/coachmarks/CoachMarkProvider.jsx", import.meta.url),
      "utf8"
    );
    const barrel = readFileSync(
      new URL("../components/coachmarks/index.js", import.meta.url),
      "utf8"
    );
    const inspectScreen = readFileSync(
      new URL("../app/(app)/inspection.js", import.meta.url),
      "utf8"
    );
    const incidentsScreen = readFileSync(
      new URL("../app/(app)/incidents.js", import.meta.url),
      "utf8"
    );

    it("publishes three contexts, each behind a memoized value", () => {
      expect(provider).toContain("const CoachMarkActionsContext = createContext(");
      expect(provider).toContain("const CoachMarkStatusContext = createContext(");
      expect(provider).toContain("const CoachMarkStateContext = createContext(");
      expect(provider).toContain("const actions = useMemo(");
      expect(provider).toContain("const status = useMemo(");
      expect(provider).toContain("const state = useMemo(");
      expect(provider).toContain("<CoachMarkActionsContext.Provider value={actions}>");
      expect(provider).toContain("<CoachMarkStatusContext.Provider value={status}>");
      expect(provider).toContain("<CoachMarkStateContext.Provider value={state}>");
    });

    it("never hands a Provider an unmemoized object literal again", () => {
      // The regression this guards: `const value = { … }`, re-created on every
      // render, which makes every consumer re-render for every provider render.
      expect(provider).not.toContain("const value = {");
      expect(provider).not.toContain("<CoachMarkContext.Provider");
    });

    it("keeps the step-dependent callbacks off the actions identity", () => {
      expect(provider).toContain("stepCallbacksRef.current?.nextStep?.(...args)");
      expect(provider).toContain("stepCallbacksRef.current?.prevStep?.(...args)");
      expect(provider).toContain(
        "stepCallbacksRef.current?.notifyInteraction?.(...args)"
      );
      // triggerMilestone must stay raw. It closes over `isDriving`, and several
      // screens trigger it from an effect whose only other deps are local state
      // (the `useLocalSearchParams()` object in inspection.js, incidents.js and
      // fuel-report.js). That identity change is what re-runs those effects when
      // the driving lock releases.
      expect(provider).not.toContain("?.triggerMilestone");
    });

    it("keeps the heaviest guide screens on the actions context alone", () => {
      expect(inspectScreen).toContain("useCoachMarkActions()");
      expect(inspectScreen).not.toContain("useCoachMarkState()");
      expect(inspectScreen).not.toContain("useCoachMarks()");
      expect(incidentsScreen).toContain("useCoachMarkActions()");
      expect(incidentsScreen).not.toContain("useCoachMarkState()");
      expect(incidentsScreen).not.toContain("useCoachMarks()");
    });

    it("still exports the merged hook for consumers needing more than one group", () => {
      expect(provider).toContain("export function useCoachMarks()");
      expect(barrel).toContain("useCoachMarkActions,");
      expect(barrel).toContain("useCoachMarkStatus,");
      expect(barrel).toContain("useCoachMarkState,");
    });
  });
});

describe("Inspection completion retry", () => {
  const inspectScreen = readFileSync(
    new URL("../app/(app)/inspection.js", import.meta.url),
    "utf8"
  );

  it("re-fires pretrip_complete once the blocking guide dismisses", () => {
    expect(inspectScreen).toContain('triggerMilestone("pretrip_complete")');
    expect(inspectScreen).toContain("if (allAnswered && !activeMilestone) {");
    expect(inspectScreen).toContain("[allAnswered, activeMilestone, triggerMilestone]");
  });

  it("stays off the volatile state context", () => {
    expect(inspectScreen).toContain("useCoachMarkStatus()");
    expect(inspectScreen).not.toContain("useCoachMarkState()");
    expect(inspectScreen).not.toContain("useCoachMarks()");
  });

  it("ensures Quick Pass All leaves one FAIL for the remarks tip to anchor to", () => {
    // The tutorial's shortcut used to pass every item and notify with a
    // hard-coded `status: "PASS"`, which took the provider's PASS branch: it
    // completed the pass/fail tip and showed no remarks tip at all. Worse, the
    // remarks tip targets `inspection.remarks`, which is mounted only by a FAILED
    // item — so with a clean sheet the step had nothing to point at even if it
    // had fired. The FAIL must go through `setStatus`, which is the only path
    // that emits the pass/fail notification and triggers `pretrip_remarks`.
    expect(inspectScreen).toContain("setStatuses(buildQuickPassStatuses(CHECKLIST));");
    expect(inspectScreen).toContain('setStatus(QUICK_PASS_FAILED_ID, "FAIL");');
    expect(inspectScreen).not.toContain('[item.id]: "PASS" }), {})');
    // The remark is required, not cosmetic: handleSubmit refuses any FAIL without
    // one, so without this the tour would strand on a "Remarks Required" alert
    // that no tip explains.
    expect(inspectScreen).toContain("[QUICK_PASS_FAILED_ID]: QUICK_PASS_FAIL_REMARK,");
  });

  it("keeps the tour completion modal honest about a flagged item", () => {
    // It used to assert "All 7 vehicle safety items passed" and "7 of 7 Passed"
    // unconditionally, which with a FAIL in the checklist is simply untrue.
    expect(inspectScreen).not.toContain("7 of 7 Passed");
    expect(inspectScreen).not.toContain("All 7 vehicle safety items passed.");
    expect(inspectScreen).toContain("Flagged for Dispatch Review");
  });
});

describe("Fuel intro retry", () => {
  const fuelScreen = readFileSync(
    new URL("../app/(app)/fuel-report.js", import.meta.url),
    "utf8"
  ).replace(/\r\n/g, "\n");

  it("re-fires fuel_scan_intro once the blocking guide dismisses", () => {
    expect(fuelScreen).toContain('triggerMilestone("fuel_scan_intro")');
    expect(fuelScreen).toContain("canLogFuel &&\n      !cameraOpen &&\n      !scanning &&\n      !activeMilestone");
    expect(fuelScreen).toContain("[mode, canLogFuel, cameraOpen, scanning, activeMilestone, triggerMilestone]");
  });

  it("sequences intro completion before the scanner opens", () => {
    expect(fuelScreen).toContain('await notifyInteraction?.("fuel.scan_entry", { action: "open_real_scanner" });');
    expect(fuelScreen).toContain('openReceiptCamera("scan");');
    // Anchor the scan-call search at the await: an earlier, unrelated
    // `openReceiptCamera("scan");` (auto-scan effect) precedes the scan card.
    const from = fuelScreen.indexOf('await notifyInteraction?.("fuel.scan_entry"');
    const seq = fuelScreen.slice(
      from,
      fuelScreen.indexOf('openReceiptCamera("scan");', from) + 'openReceiptCamera("scan");'.length
    );
    expect(seq.indexOf("await notifyInteraction")).toBeLessThan(seq.indexOf("openReceiptCamera"));
  });
});

describe("Incident retry", () => {
  const incidentsScreen = readFileSync(
    new URL("../app/(app)/incidents.js", import.meta.url),
    "utf8"
  );

  it("re-fires incident once the blocking guide dismisses", () => {
    expect(incidentsScreen).toContain('triggerMilestone("incident")');
    expect(incidentsScreen).toContain("if (!activeMilestone) {");
  });

  it("stays off the volatile state context", () => {
    expect(incidentsScreen).toContain("useCoachMarkStatus()");
    expect(incidentsScreen).not.toContain("useCoachMarkState()");
    expect(incidentsScreen).not.toContain("useCoachMarks()");
  });
});

describe("Fuel tour hands off to the Live Map tour", () => {
  const fuelScreen = readFileSync(
    new URL("../app/(app)/fuel-report.js", import.meta.url),
    "utf8"
  ).replace(/\r\n/g, "\n");

  it("routes the completed fuel tour into the Map tour, not straight to inspection", () => {
    // Driver In-App Guide §3.7.4: the fuel tour's action navigates to the Live
    // Map tour, and the pre-trip checkpoint is reached only by the START ROUTE
    // swipe inside it. Pushing /inspection from here skipped that swipe — and
    // the safety checkpoint with it (device-reported 2026-09-22).
    expect(fuelScreen).not.toContain('router.push("/(app)/inspection?tour=1")');
    expect(fuelScreen).toContain("Next: Live Map & Trip Navigation Tour →");
    expect(fuelScreen).toContain('triggerMapIntroFromTab({ source: "fuel-tour-complete" })');
    expect(fuelScreen).toContain('router.push("/(app)/(tabs)/map")');
  });

  it("reserves the Map tour before navigating to it", () => {
    // `triggerMapIntroFromTab` sets `mapIntroPendingRef` synchronously, which is
    // what holds the live-trip trigger off while its storage read resolves.
    // Navigating first would let that trigger claim the screen the tour is for.
    const handler = fuelScreen.slice(
      fuelScreen.indexOf("Next: Live Map & Trip Navigation Tour")
    );
    expect(handler.indexOf("triggerMapIntroFromTab")).toBeLessThan(
      handler.indexOf('router.push("/(app)/(tabs)/map")')
    );
  });
});

describe("Fuel tour advances exactly one step per driver action", () => {
  const fuelScreen = readFileSync(
    new URL("../app/(app)/fuel-report.js", import.meta.url),
    "utf8"
  ).replace(/\r\n/g, "\n");

  it("orders the flow gauge → request → approval → receipt → verify → save", () => {
    const flow = getMilestoneConfig("tour_fuel_flow");
    expect(flow.steps.map((s) => s.id)).toEqual([
      "tour.fuel.gauge_entry",
      "tour.fuel.request_button",
      "tour.fuel.approval",
      "tour.fuel.scan_entry",
      "tour.fuel.verify",
      "tour.fuel.submit_button",
    ]);
  });

  it("explains the coordinator approval on its own step, not on the scan step", () => {
    const flow = getMilestoneConfig("tour_fuel_flow");
    const approval = flow.steps.find((s) => s.id === "tour.fuel.approval");
    expect(approval.targetId).toBe("fuel.approval");
    expect(approval.body).toContain("35.50 L");
    // Read-only: the driver's next act is the receipt, so this one must not
    // demand a tap on anything.
    expect(approval.interaction).toBe("observe");
    expect(approval.requiresInteraction).toBeUndefined();

    // The approval figure belongs to the approval step. On the scan step it
    // announced an approval before the driver had seen one.
    const scan = flow.steps.find((s) => s.id === "tour.fuel.scan_entry");
    expect(scan.body).not.toContain("Approved");
  });

  it("tells the driver the extracted values can be corrected", () => {
    const verify = getMilestoneConfig("tour_fuel_flow").steps.find(
      (s) => s.id === "tour.fuel.verify"
    );
    expect(verify.body).toContain("correct it");
  });

  it("does not fire the gauge advance on the press that opens the modal", () => {
    // The gauge tutorial modal fires `fuel.gauge_entry` when it completes. A
    // second notification on the press that opens it advanced the tour a step
    // up front, so "Request fuel" appeared over the modal in the background.
    const press = fuelScreen.slice(
      fuelScreen.indexOf("setTourGaugeModalVisible(true)")
    );
    const handler = press.slice(0, press.indexOf("}}"));
    expect(handler).not.toContain('notifyInteraction?.("fuel.gauge_entry")');
  });

  it("leaves the single advance to the provider's interaction handler", () => {
    // Every fuel step is `passthrough`, so `notifyInteraction` already advances
    // the step. The explicit `nextStep?.()` calls that used to follow it moved
    // TWO steps per action, racing past the receipt and extracted-data tooltips.
    //
    // Comments are stripped first: the code that replaced those calls explains
    // why they are gone, and naming them in prose must not read as a call site.
    const code = fuelScreen
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(code).not.toContain("nextStep");
    // Still destructured from the actions hook would leave it an unused binding.
    expect(code).not.toMatch(
      /const \{[^}]*\bnextStep\b[^}]*\} = useCoachMarkActions\(\)/
    );
  });

  it("keeps the approval box registered as a spotlight target", () => {
    expect(fuelScreen).toContain('<CoachMarkTarget targetId="fuel.approval">');
  });
});

describe("Pre-trip is a real gate with tooltips behind it", () => {
  const practice = readFileSync(
    new URL("../components/MapIntroPractice.jsx", import.meta.url),
    "utf8"
  ).replace(/\r\n/g, "\n");

  it("keeps only the inspection button in the pre-trip prompt", () => {
    expect(practice).not.toContain("Quick Pass (Tutorial Only)");
    expect(practice).toContain("Open Inspection Screen");
    // The style that button used went with it.
    expect(practice).not.toContain("modalSecondaryBtn");
  });

  it("leaves Finish Tour to the tooltip alone", () => {
    // The practice card's own button was the second of two controls the driver
    // saw for one action. `map.practice.complete` carries no
    // `requiresInteraction`, so the tooltip's button advances ungated.
    expect(practice).not.toContain("Finish Tour ✓");
    expect(practice).not.toContain('finished: true');
    expect(practice).toContain("All five practice stages completed!");
    expect(practice).not.toContain("finishBtn");

    const complete = getMilestoneConfig("map_intro").steps.at(-1);
    expect(complete.actionText).toBe("Finish Tour");
    expect(complete.requiresInteraction).toBeUndefined();
  });

  it("completes the start stage on the way back from the inspection", () => {
    // The Map tour is parked while the inspection screen covers the tab, so this
    // card unmounts and remounts — which is why the stage is SEEDED from the
    // route parameter rather than corrected by an effect. The driver would
    // otherwise be asked to swipe the stage the inspection just satisfied.
    expect(practice).toContain(
      "pretripPassedFromRoute ? advanceMapIntroStage(0, true) : 0"
    );
    // The tour still has to be told, once.
    expect(practice).toContain("const pretripReturnReportedRef = useRef(false);");
    expect(practice).toContain("if (pretripReturnReportedRef.current) return;");
    expect(practice).toContain('pretrip: "passed"');
    // No local state is written from that effect: it is a cascading render, and
    // `lint:ci` runs with `--max-warnings 0`.
    const report = practice.slice(
      practice.indexOf("const pretripReturnReportedRef = useRef(false);"),
      practice.indexOf("return (", practice.indexOf("const pretripReturnReportedRef"))
    );
    expect(report).not.toContain("setPretripCompleted");
    expect(report).not.toContain("setTutorialStage");
    expect(report).not.toContain("setShowPretripPrompt");
  });
});

describe("Remaining tooltips keep the live-map wake-up-only discipline", () => {
  const entries = {
    inspection: "../app/(app)/inspection.js",
    trip: "../app/(app)/trip/[id].js",
    fuel: "../app/(app)/fuel-report.js",
    incidents: "../app/(app)/incidents.js",
  };

  for (const [name, rel] of Object.entries(entries)) {
    it(`${name} stays off the volatile step-driven context`, () => {
      const src = readFileSync(new URL(rel, import.meta.url), "utf8");
      expect(src).not.toContain("useCoachMarkState()");
      expect(src).not.toContain("useCoachMarks()");
    });
  }

  it("only the map screen and the target itself read step state", () => {
    const mapScreen = readFileSync(
      new URL("../app/(app)/(tabs)/map.js", import.meta.url),
      "utf8"
    );
    const target = readFileSync(
      new URL("../components/coachmarks/CoachMarkTarget.jsx", import.meta.url),
      "utf8"
    );
    expect(mapScreen).toContain("useCoachMarkState()");
    expect(target).toContain("useCoachMarkState()");
  });
});

describe("Scrim paints the surroundings, never the target", () => {
  const overlay = readFileSync(
    new URL("../components/coachmarks/CoachMarkOverlay.jsx", import.meta.url),
    "utf8"
  );
  // Read alongside the overlay: the presentation lifecycle is split across the
  // two files (the provider decides whether the overlay exists at all, the
  // overlay decides what to draw), so the step-change tests below need both.
  const provider = readFileSync(
    new URL("../components/coachmarks/CoachMarkProvider.jsx", import.meta.url),
    "utf8"
  );

  it("does not paint the dim with a border on a hole-sized view", () => {
    // React Native draws borders inside the view bounds: a ~1200dp border on
    // a hole-sized box fills the target itself dark and leaves the
    // surroundings undimmed — an inverted spotlight (device-confirmed
    // 2026-09-21 on the incident walkthrough).
    expect(overlay).not.toContain("borderWidth: scrimReach");
    expect(overlay).not.toContain("scrimReach");
  });

  it("dims the four surroundings with the scrim color", () => {
    const paints = overlay.match(/backgroundColor: scrimBg/g) || [];
    // Welcome branch (1) + top/bottom/left/right blockers (4).
    expect(paints.length).toBeGreaterThanOrEqual(5);
    expect(overlay).toContain("height: animY,");
    expect(overlay).toContain("top: animBottom,");
    expect(overlay).toContain("width: animX,");
    expect(overlay).toContain("left: animRight,");
  });

  it("keeps the overlay mounted across a step change", () => {
    // Fifth report (2026-09-22): "nag gliglitch yung mga tooltip tas highlight".
    //
    // `shouldShowOverlay` used to also require the active target's layout. The
    // freshness gate rejects any registration not stamped with the CURRENT
    // generation and every step change bumps that generation, so the layout was
    // null for the ~80-480ms until the new target re-measured — and the whole
    // overlay UNMOUNTED for that window: tooltip and dimming both vanished, then
    // it came back with its entrance fade from 0.
    //
    // Worse, a remount resets `containerBox` to zeros, so the origin correction
    // could not be applied and the hole was drawn 39.11dp high until the
    // container re-measured, then corrected itself with a tween. That pair —
    // blink, then a vertical jump — is the glitch. Ownership (milestone + route)
    // is what belongs in this condition; a route change is what should tear the
    // overlay down, and the route check is still there.
    expect(provider).toContain(
      "const shouldShowOverlay = Boolean(activeMilestone && isCurrentRouteValid);"
    );
    expect(provider).not.toContain("!currentStep?.targetId || activeTargetLayout !== null");
  });

  it("holds the previous step's rect across the handoff, so the hole never vanishes", () => {
    // With the overlay kept mounted, the layout must still be non-null on the
    // frames before the new target has measured — otherwise the gate would wait
    // and the ring would disappear between steps instead of sliding.
    //
    // Scoped deliberately: the previous step comes from the ACTIVE milestone's
    // own step array, so the hold cannot leak across guides, and it is
    // route-checked like any other registration. The freshness invariant still
    // governs fresh measurements; this only covers the frame between two steps of
    // the guide already running.
    expect(provider).toContain("const heldTargetLayout = useMemo(() => {");
    expect(provider).toContain("activeMilestone?.steps?.[currentStepIndex - 1]?.targetId");
    expect(provider).toContain("if (previousStepTargetId === currentStep.targetId) return null;");
    expect(provider).toContain("const activeTargetLayout = spotlight.layout ?? heldTargetLayout;");
    // Derived from state, not a ref: reading a ref during render is forbidden by
    // `react-hooks/refs`, and state would need a setState inside an effect.
    expect(provider).toContain("heldLayout={Boolean(heldTargetLayout)}");
    expect(overlay).toContain("heldLayout = false,");
    // A held frame is reported under its own wording rather than suppressed. The
    // hold is only meant to last until the new target measures, so a held frame
    // whose reason is "target never registered" is a real defect — silencing the
    // report would hide exactly the silent failure this diagnostic exists to
    // expose. Deduped, so a per-step hold does not flood the log.
    expect(provider).toContain(
      "`[coachmarks] spotlight holding the previous step — ${spotlight.reason}`"
    );
    expect(provider).toContain('`[coachmarks] spotlight not presenting — ${spotlight.reason}`');
    expect(provider).toContain('`${holding ? "holding" : "blocked"}|${spotlight.reason}|${');
  });

  it("snaps on a milestone's first presentation and only tweens after that", () => {
    // The anim values are created on the overlay's first render, which for a
    // fresh milestone precedes the first container measurement — so their initial
    // value came from a box the origin correction could not be applied to, and
    // tweening from it drew the ring a status bar off for a frame before sliding
    // it home. Snapping makes the hole's first painted position already correct.
    // Held in refs, not state: both are read and written only inside the effect,
    // and state would mean a setState in an effect body, which cascades a render
    // (`react-hooks/set-state-in-effect`) for a value nothing renders from.
    expect(overlay).toContain("if (presentedMilestoneRef.current !== milestoneKey) {");
    expect(overlay).toContain("presentedMilestoneRef.current = milestoneKey;");
    expect(overlay).toContain("presentedSpotRef.current = spotSignature;");
    // And a re-measure that lands on the same box must not run the
    // fade-out/tween/fade-in sequence, which reads as a flicker.
    expect(overlay).toContain("if (presentedSpotRef.current === spotSignature) return;");
  });

  it("converts the measured box into the container's local space, with no origin gate", () => {
    // Two roles were tried for the container box here. One was RIGHT and got
    // removed anyway; the other was wrong and must stay gone.
    //
    // 1. Origin conversion — reinstated 2026-09-22, having been the missing piece
    //    through five rounds of "lagpas / masyadong mataas". A `measureInWindow`
    //    box is in the measured space, but the hole is drawn as a
    //    `position: absolute` child of THIS container, so it is laid out in the
    //    container's LOCAL space. Those differ by the container's origin —
    //    `{x: 0, y: -39.11}` on the device — i.e. a full status bar.
    //    It was deleted because the container measures 853dp tall against a
    //    853.33dp window and that was read as "the two ARE one space". Equal
    //    heights say nothing about the origin: 853 against 853.33 is this
    //    device's two insets coinciding, while the origins differ by 39.11dp.
    // 2. Origin gate — wrong, and forbidden. Gating on `origin.y === 0` read the
    //    first device log's `rawOrigin: {0,0}` as the steady state, but those
    //    were frames where the container had not been measured yet — zeros are
    //    the initial state, not a settled one. Measured, the origin is
    //    {x: 0, y: -39.11, width: 384, height: 853}, so it is never 0 and the
    //    gate rejected every real frame.
    expect(overlay).not.toContain("containerSettled");
    expect(overlay).not.toContain("layoutRejected");
    // The conversion goes through the tested module rather than inline.
    expect(overlay).toContain("toContainerSpace({");
    expect(overlay).toContain("box: targetLayout,");
    expect(overlay).toContain("container: containerBox,");
    // Placement bounds must follow the hole into container space, or the same
    // 39.11dp offset walks straight back into the tooltip clamps.
    expect(overlay).toContain(
      "const VIEW_H = containerMeasured ? containerBox.height : SCREEN_HEIGHT;"
    );
    expect(overlay).toContain(
      "const spaceBelow = VIEW_H - (spotY + spotH) - safeBottom;"
    );
    expect(overlay).toContain("height: Math.round(height)");
    expect(overlay).toContain("normalizeInsetsToMeasuredSpace({");
    // An unmeasured container must not read as "fully offset", or every inset is
    // zeroed on exactly the frames the hole is first built from.
    expect(overlay).toContain(
      "containerBox.height > 0 ? containerBox.height : SCREEN_HEIGHT"
    );
    expect(overlay).toContain("resolveSpotlightRect({");
    expect(overlay).toContain("setTimeout(measure, 350)");
    // 3. First-render gate, 2026-09-22 (third report). The correction is unknown
    //    until the container is measured, so the hole used to draw uncorrected
    //    39.11dp high and then slide into place. Gating the cutout on BOTH
    //    measurements makes its first appearance already aligned.
    //
    //    Fourth report (2026-09-22): the gate is now the WAIT, not the
    //    presentation. The overlay used to render a centred card while the gate
    //    was shut, and because a step change invalidated the layout (see the
    //    provider's handoff fallback), that was every step — a centred card that
    //    hopped to the target. Waiting draws the scrim alone, so the card's first
    //    painted frame is already aligned, and the deadline keeps a
    //    never-measurable target from being an undismissable dim.
    expect(overlay).toContain(
      "const hasHoleGeometry = Boolean(targetLayout) && isMeasuredBox(containerBox);"
    );
    expect(overlay).toContain("if (!hasHoleGeometry) {");
    expect(overlay).toContain("GEOMETRY_HOLD_MS");
    // The wait must be per-step, so a step that timed out cannot lend its
    // fallback to a later step that has not waited.
    expect(overlay).toContain("geometryTimeoutFor === step.id");
    // And the gate must be able to OPEN. `containerRef` has to be attached in
    // every branch that can render while the container is unmeasured: with the
    // single attachment it once had, the measurement that opens the gate could
    // never run, so the gate would deadlock the overlay forever. Three branches
    // now (centred, waiting, targeted). Pinned by count so a refactor that drops
    // one is caught here rather than on a device.
    expect((overlay.match(/ref=\{containerRef\}/g) || []).length).toBe(3);
    // The container's origin is a property of the window, not of the step, so
    // re-measuring it per step only re-adopted a mid-transition origin and
    // stacked another 350ms timer — jitter in the number that stabilizes the
    // hole. Mount-only, with the delayed recheck kept for a mount mid-slide.
    expect(overlay).not.toContain("[step?.targetId]");
    expect(overlay).toContain("// Mount once, not per step.");
  });
});

describe("SOS Compact Floating Bubble & Spotlight Contour", () => {
  const overlay = readFileSync(
    new URL("../components/coachmarks/CoachMarkOverlay.jsx", import.meta.url),
    "utf8"
  );
  const tooltip = readFileSync(
    new URL("../components/coachmarks/CoachMarkTooltip.jsx", import.meta.url),
    "utf8"
  );

  it("configures SOS and TOUR_SOS with floating_bubble presentation", () => {
    expect(COACH_MARK_MILESTONES.SOS.steps[0].presentation).toBe("floating_bubble");
    expect(COACH_MARK_MILESTONES.TOUR_SOS.steps[0].presentation).toBe("floating_bubble");
  });

  it("docks the compact floating bubble beside the floating target with tailored horizontal arrows", () => {
    expect(overlay).toContain("const isFloatingBubble =");
    expect(overlay).toContain('tooltipArrowPos = "right";');
    expect(overlay).toContain('tooltipArrowPos = "left";');
    expect(overlay).toContain("compact={isFloatingBubble}");
    expect(overlay).toContain('badge={isFloatingBubble ? "emergency" : null}');
  });

  it("supports compact bubble mode, emergency badge, and lateral arrows in CoachMarkTooltip", () => {
    expect(tooltip).toContain('arrowPosition === "right"');
    expect(tooltip).toContain('arrowPosition === "left"');
    expect(tooltip).toContain('badge === "emergency"');
    expect(tooltip).toContain("compact && styles.compactWrapper");
    expect(tooltip).toContain("compact && styles.compactCard");
  });

  it("frames the spotlight cutout with a luminous accent ring matching the target shape", () => {
    expect(overlay).toContain("borderRadius: holeRadius,");
    expect(overlay).toContain("borderWidth: 2,");
    expect(overlay).toContain("opacity: pulseAnim,");
  });
});
