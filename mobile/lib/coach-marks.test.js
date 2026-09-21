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

      // Complete Inspection
      const completeConfig = getMilestoneConfig("pretrip_complete");
      expect(completeConfig.steps[0].targetId).toBe("inspection.complete");
      expect(completeConfig.steps[0].interaction).toBe("blocked");
      expect(completeConfig.steps[0].actionText).toBe("Got it");

      // Trip Progression Swipe
      const liveTripConfig = getMilestoneConfig("live_trip");
      const progressionStep = liveTripConfig.steps[2];
      expect(progressionStep.targetId).toBe("map.trip_progression");
      expect(progressionStep.interaction).toBe("blocked");
      expect(progressionStep.actionText).toBe("Got it");
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
      expect(provider).toMatch(/\[driverId, isDriving\]\s*\);/);
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
      expect(tripScreen).toContain("if (loading || !trip || isTerminal || !isPreStart) return;");
      expect(tripScreen).toContain('triggerMilestone("trip_readiness")');
    });

    it("retires the guide when the driver starts the trip", () => {
      expect(tripScreen).toContain("Promise.resolve(dismiss()).catch(() => {});");
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
      // (inspection.js:61, incidents.js:71, fuel-report.js:183). That identity
      // change is what re-runs those effects when the driving lock releases.
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
