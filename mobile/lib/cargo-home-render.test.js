import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transform } from "esbuild";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import * as loadPresentation from "./load-presentation";
import { homeTripAction, selectHomeTrips, homeVehicleImage } from "./home-trips";
import { resolveDriverWorkspace } from "./driver-workspace";
import { CACHE_KEYS } from "./offline-cache";
import { DUTY_EMPTY_STATES, resolveDutyEmptyState } from "./duty-empty-states";
import { shouldAutoRetry, LIST_AUTO_RETRY_MS } from "./connectivity-state";

// Render the real Home card JSX with lightweight native primitives. Native
// maps and device APIs are external boundaries, not the copy under test.
const native = tag => function NativePrimitive({ children, disabled }) { return React.createElement(tag, { disabled }, children); };
const { code } = await transform(readFileSync(new URL("../components/home/DriverHomeCards.jsx", import.meta.url), "utf8"), { loader: "jsx", format: "cjs" });
const scope = { exports: {} };
const dependencies = {
  react: React,
  "../clay": { ClayCard: native("div") },
  "react-native": { View: native("div"), Text: native("span"), Pressable: native("button"), Image: () => null, ActivityIndicator: () => null,
    StyleSheet: { create: value => value, absoluteFill: {} }, Platform: { OS: "android" }, useWindowDimensions: () => ({ width: 390, fontScale: 1 }) },
  "expo-linear-gradient": { LinearGradient: native("div") },
  "@expo/vector-icons": { Ionicons: () => null, MaterialCommunityIcons: () => null },
  "../../lib/theme-context": { useTheme: () => ({ scheme: "light", type: {}, colors: new Proxy({}, { get: () => "#123456" }) }) },
  "../../lib/settings-context": { useSettings: () => ({ settings: {} }) },
  "../../lib/home-trips": { homeTripAction },
  "../../lib/theme": { fonts: {}, statusColorForTone: () => ({ fg: "#123456", bg: "#ffffff" }), tripStatusTone: () => "info" },
  "../../lib/scaling": { moderateScale: value => value },
  "../../lib/quick-action-press.js": { QUICK_ACTION_PRESS: {} },
  "../../lib/load-presentation.js": loadPresentation,
  "./materials": { homeMaterials: () => ({}) },
  "../TripMapPreview": { default: () => null, __esModule: true },
  "../RadarPulse": { default: () => null, __esModule: true },
  "../coachmarks": { CoachMarkTarget: native("div"), useCoachMarkActions: () => ({}), useCoachMarkStatus: () => ({}) },
};
runInNewContext(code, { module: scope, exports: scope.exports, React, require: name => {
  if (name.endsWith(".png")) return 1;
  if (!dependencies[name]) throw new Error(`Unexpected Home dependency ${name}`);
  return dependencies[name];
} });
const { DriverTripCard, DriverWorkspaceCard, DriverHeroCard, HomeQuickActions, AssignmentsHeading } = scope.exports;
describe("rendered cargo Home card", () => {
  it.each([["Passenger Onboard", "Cargo Loaded"], ["Drop-off", "At Delivery"]])("renders %s as %s without guest/zero-passenger text", (trip_status, label) => {
    const trip = { trip_id: 701, trip_status, load_type: "Cargo", cargo_description: "Restaurant vegetables", cargo_weight_kg: 650,
      passenger_count: 0, passenger_name: "Ghost Guest", origin: "Supplier", destination: "Hotel" };
    const html = renderToStaticMarkup(React.createElement(DriverTripCard, { trip, current: true, nowMs: Date.now(), canManage: true }));
    for (const text of [label, "Restaurant vegetables", "650 kg declared"]) expect(html).toContain(text);
    expect(html).not.toContain("Ghost Guest"); expect(html).not.toContain("0 passengers");
  });
});

const cargoTrip = { trip_id: 701, vehicle_id: 12, vehicle_plate: "ABC-123", operational_use: "Cargo", load_type: "Cargo", trip_status: "Passenger Onboard", cargo_description: "Fresh vegetables", cargo_weight_kg: 650, passenger_name: "Ghost Guest", passenger_count: 0 };
const renderWorkspace = (trip, assignedVehicle, driverType = "Cargo") => renderToStaticMarkup(React.createElement(DriverWorkspaceCard, { workspace: resolveDriverWorkspace({ driverType, trip, assignedVehicle }), trip, assignedVehicle }));
describe("rendered driver workspace", () => {
  it.each([["RESTAURANT_SUPPLY_PICKUP", "Restaurant cargo"], ["HOTEL_CARGO", "Hotel cargo"]])("labels cargo from %s service metadata", (service_code, label) => {
    const html = renderWorkspace({ ...cargoTrip, service_code });
    for (const text of ["Cargo workspace", "ABC-123", "Fresh vegetables", "650 kg declared", "Cargo Loaded", label]) expect(html).toContain(text);
    expect(html).not.toContain("Ghost Guest"); expect(html).not.toContain("0 passengers");
  });
  it("does not infer a source from cargo description or driver group", () => {
    const html = renderWorkspace({ ...cargoTrip, cargo_description: "Restaurant hotel supplies", driver_group: "Restaurant" });
    expect(html).toContain("Cargo assignment");
    expect(html).not.toContain("Restaurant cargo"); expect(html).not.toContain("Hotel cargo");
  });
  it("shows passenger transfer details and VIP cue", () => {
    const html = renderWorkspace({ ...cargoTrip, operational_use: "Passenger", load_type: "Passenger", guest_name: "Jane Santos", passenger_count: 2, is_vip: true }, undefined, "Passenger");
    for (const text of ["Passenger workspace", "Hotel transportation", "Jane Santos", "2 passengers", "VIP"]) expect(html).toContain(text);
    expect(html).not.toContain("Fresh vegetables");
  });
  it("uses the standing plate when no active trip exists", () => {
    const html = renderWorkspace(null, { vehicleId: 12, operationalUse: "Cargo", plate: "STAND-12" });
    expect(html).toContain("Cargo workspace"); expect(html).toContain("STAND-12"); expect(html).toContain("No active cargo trip");
  });
  it.each([null, { vehicleId: 12 }])("explains absent assignment/use without enabled actions", assignedVehicle => {
    const html = renderWorkspace(null, assignedVehicle);
    expect(html).toContain("Cargo workspace"); expect(html).toContain("Fleet or Dispatch"); expect(html).not.toContain("<button");
  });
  it("keeps cargo vehicle mode visible and locks mismatched trip actions", () => {
    const trip = { ...cargoTrip, load_type: "Passenger" };
    const workspace = resolveDriverWorkspace({ driverType: "Cargo", trip });
    const html = renderWorkspace(trip);
    expect(html).toContain("Cargo workspace"); expect(html).toContain("saved trip type does not match your driver type"); expect(html).not.toContain("Ghost Guest");
    const card = renderToStaticMarkup(React.createElement(DriverTripCard, { trip, current: true, nowMs: Date.now(), canManage: true, workspace }));
    expect(card).toContain('disabled=""'); expect(card).toContain("Trip action unavailable"); expect(workspace.tripReady).toBe(false);
  });
});

it("gives Cargo Home a work-focused hero without guest transport copy", () => {
  const html = renderToStaticMarkup(React.createElement(DriverHeroCard, { workspaceMode: "cargo", confirmed: true, profileConfirmed: true, vehicle: { plate: "ABC-123" } }));
  expect(html).toContain("Cargo work. Clear deliveries."); expect(html).not.toContain("Happy guests");
});

it.each([
  [{ ...cargoTrip, vehicle_id: null }, "No vehicle is assigned"],
  [{ ...cargoTrip, operational_use: null }, "work type is missing"],
  [{ ...cargoTrip, load_type: null }, "saved trip type is missing"],
])("blocks incomplete active-trip assignments", (trip, copy) => {
  const html = renderWorkspace(trip, { vehicleId: 99, operationalUse: "Passenger", plate: "OTHER-99" });
  expect(html).toContain(copy); expect(html).not.toContain("OTHER-99"); expect(html).not.toContain("<button");
});
it("labels cargo route stops as pickup and delivery", () => {
  const html = renderToStaticMarkup(React.createElement(DriverTripCard, { trip: cargoTrip, current: true, nowMs: Date.now(), canManage: true }));
  expect(html).toContain("Delivery"); expect(html).not.toContain("Drop-off");
});

it.each([
  [{ ...cargoTrip, load_type: "Passenger" }, "Cargo workspace", "saved trip type does not match your driver type"],
  [{ ...cargoTrip, vehicle_id: null }, "Cargo workspace", "No vehicle is assigned"],
  [{ ...cargoTrip, operational_use: null }, "Cargo workspace", "work type is missing"],
  [{ ...cargoTrip, load_type: null }, "Cargo workspace", "saved trip type is missing"],
])("explains each blocked upcoming assignment beside its disabled action", (trip, mode, reason) => {
  const assignedVehicle = { vehicleId: 99, operationalUse: "Passenger", plate: "STAND-99" };
  const workspace = resolveDriverWorkspace({ driverType: "Cargo", trip, assignedVehicle });
  const html = renderToStaticMarkup(React.createElement(DriverTripCard, { trip, variant: "next", nowMs: Date.now(), canManage: true, workspace }));
  expect(html).toContain(mode); expect(html).toContain(reason); expect(html).toContain("Fleet or Dispatch");
  expect(html).toContain('disabled=""'); expect(html).toContain("Trip action unavailable");
  expect(html).not.toContain("Ghost Guest"); expect(html).not.toContain("STAND-99");
});

it.each(["Cargo", "Passenger"])("keeps %s workspace with absent or mismatched vehicle", driverType => {
  for (const vehicle of [null, { vehicleId: 12, operationalUse: driverType === "Cargo" ? "Passenger" : "Cargo" }]) {
    const html = renderWorkspace(null, vehicle, driverType);
    expect(html).toContain(`${driverType} workspace`);
    expect(html).toContain("Fleet or Dispatch");
    expect(html).not.toContain("<button");
  }
});
it.each([null, "Other"])("shows type setup instead of Passenger for %s", driverType => {
  const html = renderWorkspace(null, null, driverType);
  expect(html).toContain("Driver type needs setup");
  expect(html).not.toContain("Passenger workspace");
});

it("keeps the profile loading presentation neutral", () => {
  const html = renderToStaticMarkup(React.createElement(DriverWorkspaceCard, { workspace: resolveDriverWorkspace(), loading: true }));
  expect(html).toContain("Checking driver type");
  expect(html).not.toContain("Passenger workspace");
  expect(html).not.toContain("Driver type needs setup");
});

// ─── Home screen: the offline read-only gate ───
// index.js line 233: canManageTrip = canAction(user, ACTIONS.MANAGE_TRIP) && !offline && liveConfirmed
// A cached known driverType + offline must still render the workspace, but
// trip actions stay disabled (doAction/handleTripAction no-op). Removing the
// !offline && liveConfirmed conjunct flips the current card's CTA from
// "Trip Details" to the live action label and fails both tests below.
const { code: homeCode } = await transform(readFileSync(new URL("../app/(app)/(tabs)/index.js", import.meta.url), "utf8"), { loader: "jsx", format: "cjs" });

const cachedCargoTrip = { trip_id: 701, vehicle_id: 12, vehicle_plate: 'ABC-123', operational_use: 'Cargo', load_type: 'Cargo', trip_status: 'Passenger Onboard', cargo_description: 'Fresh vegetables', cargo_weight_kg: 650, passenger_name: 'Ghost Guest', passenger_count: 0, origin: 'Supplier', destination: 'Hotel' };

function homeHarness({ cards } = {}) {
  const actorId = 'employee-1';
  const slots = [];
  let cursor = 0;
  const effects = [];
  const apiGet = vi.fn();
  const apiPut = vi.fn();
  const cached = vi.fn();
  const writes = vi.fn();
  const push = vi.fn();
  const prefetch = vi.fn();
  const alerts = [];
  const milestone = vi.fn();
  const deadLetters = vi.fn(async () => []);
  const activeStatuses = vi.fn(async () => ['Passenger Onboard']);
  const nextStatus = vi.fn(async () => null);
  const incidentSession = { actorId, generation: 1 };
  const scope = { exports: {} };
  const dependencies = {
    react: {
      ...React,
      useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = value; }]; },
      useRef: value => ({ current: value }),
      useCallback: fn => fn,
      useEffect: fn => { effects.push(fn); },
      useMemo: fn => fn(),
      memo: component => component,
    },
    'react-native': { ScrollView: native('div'), StyleSheet: { create: value => value, absoluteFill: {} }, Text: native('span'), View: native('div'), Pressable: native('button'), RefreshControl: native('div'), Modal: native('div'), TextInput: native('input'), ActivityIndicator: () => null, InteractionManager: { runAfterInteractions: cb => { cb(); return { cancel: () => {} }; } } },
    'expo-router': { useFocusEffect: fn => { effects.push(fn); }, useRouter: () => ({ push, prefetch }), useLocalSearchParams: () => ({}) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
    '@expo/vector-icons': { Ionicons: () => null },
    '../../../lib/scaling': { moderateScale: value => value },
    '../../../lib/api': { api: { get: apiGet, put: apiPut }, wasQueued: () => false, isTransportFailure: () => true },
    '../../../lib/connectivity-state': { shouldAutoRetry, LIST_AUTO_RETRY_MS },
    '../../../lib/offline-cache': { CACHE_KEYS, getCached: cached, setCached: writes, resolveDriverId: user => user.driverId },
    '../../../lib/connectivity-context': { useConnectivity: () => ({ status: 'offline' }) },
    '../../../components/OfflineStates': { SyncNote: native('div') },
    '../../../lib/auth': { useAuth: () => ({ user: { employeeId: actorId, driverId: 'driver-9', firstName: 'Test', name: 'Test Driver', driver_status: 'Active', status: 'Active', avatarUrl: null } }) },
    '../../../lib/rbac': { ACTIONS: { MANAGE_TRIP: 'manage_trip', REPORT_LOCATION: 'report_location', REPORT_FUEL: 'report_fuel' }, canAction: () => true },
    '../../../lib/tracking': { usePosterStatus: () => ({ weatherTripId: null, lastSentAt: null, error: null }) },
    '../../../lib/ambient-weather': { useAmbientWeather: () => ({ chip: null }) },
    '../../../components/home/DriverHomeHeader': { default: native('div'), __esModule: true },
    '../../../lib/tripRef': { getActiveStatuses: activeStatuses, getNextStatus: nextStatus },
    '../../../components/AppAlert': { AppAlert: { alert: (title, message) => alerts.push({ title, message }) } },
    '../../../lib/theme-context': { useTheme: () => ({ scheme: 'light', type: {}, colors: new Proxy({}, { get: () => '#123456' }) }) },
    '../../../context/notification-feed': { useNotificationFeed: () => ({ unreadCount: 0 }) },
    '../../../lib/theme': { TOUCH_TARGET: {} },
    '../../../components/ui': { ErrorNotice: native('div') },
    '../../../lib/home-trips': { selectHomeTrips, homeVehicleImage, HOME_UPCOMING_LIMIT: 3 },
    '../../../lib/driver-workspace': { resolveDriverWorkspace },
    '../../../lib/driver-context': { resolveVehicleContext: () => null },
    '../../../components/home/DriverHomeCards': cards || { DriverHeroCard, DriverWorkspaceCard, HomeQuickActions, DriverTripCard, AssignmentsHeading },
    '../../../components/coachmarks/CoachMarkProvider': { useCoachMarkActions: () => ({ triggerMilestone: milestone, notifyInteraction: () => {}, setTutorialTransition: () => {} }), useCoachMarkStatus: () => ({ activeMilestone: null, walkthroughActive: false, tutorialTransitioning: false, pendingTourDestination: null }) },
    '../../../components/coachmarks/CoachMarkTarget': { CoachMarkTarget: native('div') },
    '../../../lib/use-pre-shift': { usePreShift: () => ({ loaded: true, passed: true, failed: false }) },
    '../../../lib/use-duty': { useDuty: () => ({ loaded: true, checkedIn: true, busy: false, today: { blocked: false }, due: false, unreported: null }) },
    '../../../lib/duty-empty-states': { DUTY_EMPTY_STATES, resolveDutyEmptyState },
    '../../../lib/missed-report': { missedReportCopy: () => null, lateReportHref: () => null },
    '../../../components/clay': { ClayCard: native('div'), ClayButton: native('button') },
    '../../../components/home/DriverHomeSkeletons': { useSharedSkeletonPulse: () => false, DriverHeroCardSkeleton: native('div'), DriverTripCardSkeleton: native('div') },
    '../../../lib/sync': { getIncidentDeadLetters: deadLetters, retryIncidentDeadLetters: vi.fn(async () => {}) },
    '../../../lib/prefetch-routes': { QUICK_ACTION_ROUTES: [] },
    '../../../lib/cargo-sync': { captureCargoSession: id => (id === actorId ? incidentSession : null), isCurrentCargoSession: session => session === incidentSession },
    '../../../lib/home-revalidate': { shouldRevalidateHome: () => false },
  };
  runInNewContext(homeCode, { module: scope, exports: scope.exports, React, require: name => {
    if (name.endsWith('.png')) return 1;
    if (!dependencies[name]) throw new Error(`Unexpected Home dependency ${name}`);
    return dependencies[name];
  }, setTimeout: fn => { fn(); return 1; }, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {}, Date, Map });
  const renderHome = () => { cursor = 0; const tree = scope.exports.default(); while (effects.length) effects.shift()(); return tree; };
  return { renderHome, apiGet, apiPut, cached, writes, push, alerts, milestone };
}

function apiGetRejects(h) {
  h.apiGet.mockRejectedValue(Object.assign(new Error('Network request failed'), { status: 0 }));
}

function seedOfflineCache(h) {
  h.cached.mockImplementation(async (driverId, key) => {
    if (key === CACHE_KEYS.HOME_TRIPS) return { data: [cachedCargoTrip], syncedAt: Date.now() - 60000 };
    if (key === CACHE_KEYS.DRIVER_ME) return { data: { driverType: 'Cargo', driverStatus: 'Active' }, syncedAt: Date.now() - 60000 };
    return null;
  });
  apiGetRejects(h);
}

async function renderOfflineHome(h) {
  h.renderHome(); // mount: the focus effect kicks off load()
  await vi.waitFor(() => { expect(renderToStaticMarkup(h.renderHome())).toContain('Cargo workspace'); });
  return renderToStaticMarkup(h.renderHome());
}

describe('Home offline read-only gate (index.js canManageTrip)', () => {
  it('renders the cached workspace visibly but keeps trip actions disabled while offline', async () => {
    const h = homeHarness();
    seedOfflineCache(h);
    const html = await renderOfflineHome(h);
    // The cached driver type still paints the workspace…
    expect(html).toContain('Cargo workspace');
    expect(html).toContain('Cargo work. Clear deliveries.');
    expect(html).toContain('Fresh vegetables');
    // …but the current trip's CTA is Trip Details, never the live action.
    expect(html).toContain('Trip Details');
    expect(html).not.toContain('Continue Trip');
    expect(h.apiPut).not.toHaveBeenCalled();
  });

  it('no-ops handleTripAction while offline even when invoked directly', async () => {
    const captured = [];
    const h = homeHarness({ cards: {
      DriverHeroCard: native('div'), DriverWorkspaceCard: native('div'), HomeQuickActions: native('div'), AssignmentsHeading: native('div'),
      DriverTripCard: function RecordingTripCard(props) { captured.push(props); return React.createElement('div', null, 'trip-card'); },
    } });
    seedOfflineCache(h);
    h.renderHome();
    // The recording card executes only when React renders the tree, so the
    // wait renders each post-load tree until the cached trip card is present.
    await vi.waitFor(() => { renderToStaticMarkup(h.renderHome()); expect(captured.some(p => p.trip?.trip_id === cachedCargoTrip.trip_id)).toBe(true); });
    const card = captured.find(p => p.trip?.trip_id === cachedCargoTrip.trip_id);
    expect(card).toBeDefined();
    expect(card.canManage).toBe(false);
    await card.onAction(card.trip); // handleTripAction — the offline gate makes this a no-op
    expect(h.apiPut).not.toHaveBeenCalled();
    expect(h.alerts).toEqual([]);
  });
});
