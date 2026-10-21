import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transform } from "esbuild";
import { readFileSync, existsSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { parse } from "espree";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolveCargoMapGate, buildCargoViewModel, workspaceBlockReason, workspaceModeLabel } from "./cargo-view-model";
import { normalizeRadarMarkers } from "./map-webview-data";
import { resolveDriverWorkspace } from "./driver-workspace";
import { isCargoLoad, loadTitle, loadSubtitle } from "./load-presentation";
import { resolve, dirname } from "node:path";
import { describe, expect, it, vi } from "vitest";
const cache = new Map();
const primitive = tag => function NativePrimitive({ children, accessibilityLabel, accessibilityState, value, editable, placeholder }) { return React.createElement(tag, { "aria-label": accessibilityLabel, disabled: accessibilityState?.disabled || editable === false, value, placeholder }, children); };
const theme = { colors: { background: "#F5F2EC", onSurface: "#1F2925", onSurfaceVariant: "#53615A", primary: "#285448", onPrimary: "#FFFFFF", error: "#A84340", surfaceContainerLow: "#FBF8F3" }, type: {}, scheme: "light" };
async function load(path) {
  if (cache.has(path)) return cache.get(path);
  const code = (await transform(readFileSync(path, "utf8"), { loader: "jsx", format: "cjs" })).code;
  const deps = { react: React, "react-native": { View: primitive("div"), Text: primitive("span"), Pressable: primitive("button"), TextInput: primitive("input"), Image: primitive("img"), StyleSheet: { create: v => v }, Platform: { OS: "android" } } };
  for (const match of code.matchAll(/require\("([^" ]+)"\)/g)) {
    const name = match[1]; if (deps[name]) continue;
    if (name.endsWith('/coachmarks')) deps[name] = { CoachMarkTarget: primitive('div') };
    else if (name.endsWith('.webp')) deps[name] = 1;
    else if (name.endsWith("theme-context")) deps[name] = { useTheme: () => theme };
    else if (name.endsWith("/clay")) deps[name] = { ClayCard: primitive("section"), ClayButton: ({ label, disabled }) => React.createElement("button", { disabled }, label), ClayInput: ({ label, value, error, editable, inputStyle, placeholderTextColor }) => React.createElement("label", null, label, React.createElement("input", { value, readOnly: true, disabled: editable === false, style: inputStyle, "data-placeholder-color": placeholderTextColor }), error) };
    else { let target = resolve(dirname(path), name); for (const suffix of ["", ".jsx", ".js"]) if (existsSync(target + suffix)) { target += suffix; break; } deps[name] = await load(target); }
  }
  const scope = { exports: {} }; runInNewContext(code, { module: scope, exports: scope.exports, React, require: name => deps[name] }); cache.set(path, scope.exports); return scope.exports;
}
const base = new URL("../components/cargo/", import.meta.url);
const manifest = { manifest_ref: { revision: 1 }, lines: [{ line_id: "boxes", name: "Fresh produce", expected_quantity: "10", unit: "boxes", quantity_basis: "TRANSPORT_PACKAGE", reference_image_ref: null, handling: ["SECURE_LOAD"] }] };

it("explains signing after review while keeping receiver authority separate", async () => {
  const { CargoWorkflowContent } = await load(fileURLToPath(new URL("CargoWorkflowContent.jsx", base)));
  const html = renderToStaticMarkup(React.createElement(CargoWorkflowContent, { mode: "delivery", review: true, execution: { manifest, capabilities: { observe: true } }, trip: { trip_status: "Drop-off" }, view: { canSubmit: true, stage: "DELIVERY", summary: {}, blockers: [] }, form: { counts: { boxes: "10" }, issues: {} } }));
  expect(html).toContain("Next, the receiving staff"); expect(html).toContain("Receiving authority must still be confirmed separately");
});
it("locks the issue editor of a saved immutable pending receipt", async () => {
  const { CargoWorkflowContent } = await load(fileURLToPath(new URL("CargoWorkflowContent.jsx", base)));
  const html = renderToStaticMarkup(React.createElement(CargoWorkflowContent, { mode: "pickup", pending: true, issueLine: "boxes", execution: { manifest, capabilities: { observe: true } }, trip: { trip_status: "At Pickup" }, view: { canSubmit: true, stage: "PICKUP", summary: {}, blockers: [] }, form: { counts: { boxes: "9" }, issues: { boxes: { remarks: "One missing" } } } }));
  expect(html).toMatch(/<input[^>]*disabled=""/); expect(html).toContain('<button disabled="">Add observation photo');
});
describe("rendered native cargo components", () => {
  it("shows source physical facts beside blank actual counts without granting observation authority", async () => {
    const { CargoItemReceiptRow } = await load(fileURLToPath(new URL("CargoItemReceiptRow.jsx", base)));
    const line = { ...manifest.lines[0], physical: {
      transport_package_count: 10, package_description: "sealed crate", gross_weight_kg_per_package: "12",
      dimensions_m: { length: "0.5", width: "0.4", height: "0.3" }, package_can_rotate: false, temperature_c: { min_c: 2, max_c: 8 },
    } };
    const html = renderToStaticMarkup(React.createElement(CargoItemReceiptRow, { line, value: "", editable: false }));
    for (const text of ["10", "sealed crate", "12", "kg/package", "0.5 × 0.4 × 0.3 m", "not permitted", "2 to 8 °C"]) expect(html).toContain(text);
    expect(html).toContain('value=""');
    expect(html).toMatch(/<input[^>]*disabled=""/);
  });
  it("keeps the overview physical projection read-only and historical manifests unchanged", async () => {
    const { CargoPhysicalManifest } = await load(fileURLToPath(new URL("CargoItemReceiptRow.jsx", base)));
    const physical = { transport_package_count: 10, package_description: null, gross_weight_kg_per_package: "12", dimensions_m: { length: "0.5", width: "0.4", height: "0.3" }, package_can_rotate: true, temperature_c: null };
    const html = renderToStaticMarkup(React.createElement(CargoPhysicalManifest, { manifest: { ...manifest, lines: [{ ...manifest.lines[0], physical }] } }));
    expect(html).toContain("Transport requirements");
    expect(html).toContain("Fresh produce");
    expect(html).toContain("no requirement declared");
    expect(html).toContain("do not confirm capacity");
    expect(html).not.toMatch(/<button|<input/);
    expect(renderToStaticMarkup(React.createElement(CargoPhysicalManifest, { manifest }))).toBe("");
  });
  it("renders separate expected and initially blank actual counts with image absence", async () => {
    const { CargoManifestList } = await load(fileURLToPath(new URL("CargoManifestList.jsx", base)));
    const html = renderToStaticMarkup(React.createElement(CargoManifestList, { manifest, counts: { boxes: "" }, stage: "PICKUP", onChange: () => {} }));
    expect(html).toContain("Fresh produce"); expect(html).toContain("10"); expect(html).toContain("Actual pickup count"); expect(html).toContain('value=""'); expect(html).toContain("Source photo unavailable"); expect(html).toContain("min-width:0"); expect(html).toContain('data-placeholder-color="#53615A"'); expect(html).not.toMatch(/passenger|Call guest/i);
  });
  it("keeps expected, picked-up and delivered values distinct", async () => {
    const { CargoReceiptSummary } = await load(fileURLToPath(new URL("CargoReceiptSummary.jsx", base)));
    const html = renderToStaticMarkup(React.createElement(CargoReceiptSummary, { manifest, lines: [{ line_id: "boxes", expected_quantity: "10", pickup_quantity: "9", delivery_quantity: "9", order_shortage: "1", delivery_shortage: "0" }] }));
    for (const label of ["Expected", "Picked up", "Delivered", "Order shortage", "Delivery shortage", "1 boxes", "0 boxes"]) expect(html).toContain(label);
  });
  it("partner received text does not authorize departure", async () => {
    const { CargoDecisionStatus } = await load(fileURLToPath(new URL("CargoDecisionStatus.jsx", base)));
    const html = renderToStaticMarkup(React.createElement(CargoDecisionStatus, { view: { stage: "AWAITING_DECISION", blockers: [{ code: "CARGO_SOURCE_DECISION_REQUIRED", message: "Wait for source review." }], summary: { syncLabel: "Saved to Fleet", feedbackLabel: "Partner acknowledged receipt", sourceDecisionLabel: "Awaiting source decision", clearanceLabel: "Fleet clearance required", securementLabel: "Post-load securement required" } } }));
    expect(html).toContain("Awaiting source decision"); expect(html).toContain("Fleet clearance required"); expect(html).toContain("Post-load securement required"); expect(html).not.toContain("Ready to depart");
  });
});

describe("cargo workflow screen actions", () => {
  it.each(["RESTAURANT_SUPPLY_PICKUP", "RESTAURANT_FOOD_DELIVERY", "HOTEL_SUPPLY_TRANSFER"])("renders the same driver controls for %s", async service_code => {
    const { CargoWorkflowContent } = await load(fileURLToPath(new URL("CargoWorkflowContent.jsx", base)));
    const html = renderToStaticMarkup(React.createElement(CargoWorkflowContent, { mode: "pickup", execution: { manifest: { ...manifest, service_code }, capabilities: { observe: true } }, trip: { trip_status: "At Pickup" }, view: { canSubmit: true, stage: "PICKUP", summary: {}, blockers: [] }, form: { counts: { boxes: "" }, issues: {} }, onIssue: () => {} }));
    expect(html).toContain("Review counts"); expect(html).toContain("Report issue: Fresh produce"); expect(html).not.toMatch(/passenger|Call guest/i);
  });
  it("blocks clean pickup confirmation on a shortage and exposes the separate report action", async () => {
    const { CargoWorkflowContent } = await load(fileURLToPath(new URL("CargoWorkflowContent.jsx", base)));
    const html = renderToStaticMarkup(React.createElement(CargoWorkflowContent, { mode: "pickup", execution: { manifest, capabilities: { observe: true } }, trip: { trip_status: "At Pickup" }, view: { canSubmit: true, stage: "PICKUP", summary: {}, blockers: [] }, review: true, form: { counts: { boxes: "9" }, issues: { boxes: { remarks: "One box missing" } } } }));
    expect(html).toContain('<button disabled="">Confirm pickup'); expect(html).toContain('<button>Report pickup issue');
  });
  it("keeps delivery observation separate from unavailable receiver confirmation", async () => {
    const { CargoWorkflowContent } = await load(fileURLToPath(new URL("CargoWorkflowContent.jsx", base)));
    const html = renderToStaticMarkup(React.createElement(CargoWorkflowContent, { mode: "delivery", execution: { manifest, capabilities: { observe: true } }, trip: { trip_status: "Drop-off" }, view: { canSubmit: true, stage: "DELIVERY", canConfirmDelivery: false, summary: { receiverLabel: "Receiver authority unavailable" }, blockers: [] }, review: true, form: { counts: { boxes: "9" }, issues: {} } }));
    expect(html).toContain("Record delivery observation"); expect(html).toContain('<button disabled="">Confirm delivery'); expect(html).toContain("pending review");
  });
});

const mapSource = readFileSync(new URL("../app/(app)/(tabs)/map.js", import.meta.url), "utf8");
const mapTree = parse(mapSource, { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true }, range: true });
let swipeHandler, operationAssertion;
function visit(node) {
  if (!node || typeof node !== "object") return;
  if (node.type === "VariableDeclarator" && node.id.name === "assertCurrentOperation") operationAssertion = mapSource.slice(...node.init.range);
  if (node.type === "JSXAttribute" && node.name.name === "onSwipeSuccess") swipeHandler = mapSource.slice(...node.value.expression.range);
  for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
}
visit(mapTree);
async function runMapAction({ cargo = true, status = "At Pickup", clearance = null, captureAlerts = false, operationalUse = cargo ? "Cargo" : "Passenger", driverType = cargo ? "Cargo" : "Passenger", serverConfirmed = true, tripConfirmed = true, connectivity = "online", afterRead } = {}) {
  const writes = [], navigations = [], alerts = [];
  const trip = { trip_id: 701, vehicle_id: 3, operational_use: operationalUse, load_type: cargo ? "Cargo" : "Passenger", trip_status: status };
  const operationRef = { current: { profile: { driverType }, serverConfirmed, tripConfirmed, connectivity, trips: [trip], session: {} } };
  const assertCurrentOperation = runInNewContext(`(${operationAssertion})`, { operationRef, isCurrentCargoSession: () => true, resolveDriverWorkspace });
  const action = runInNewContext(`(${swipeHandler})`, { assertCurrentOperation, resolveDriverWorkspace, workspaceBlockReason, profile: { driverType }, serverConfirmed, tripConfirmed, inFlight: false, setInFlight: () => {}, activeTrip: trip, isCargoLoad, user: { employeeId: 12 }, connectivity, tripSession: {}, captureCargoSession: () => ({}), isCurrentCargoSession: () => true, resolveCargoMapGate, cargoApi: { getExecution: async () => { if (!clearance) throw new Error("Disabled"); return clearance; } }, getCargoSyncState: async () => ({ state: "NONE" }), AppAlert: { alert: (title, message) => alerts.push(message) }, router: { push: path => navigations.push(path) }, isPending: false, isDriverAccepted: false, isState1: status === "Trip Started", isState2: status === "At Pickup", isState3: status === "En Route", isState4: status === "Drop-off", api: { get: async () => { afterRead?.(operationRef.current); return { state: "inside" }; }, put: async path => { writes.push(path); return {}; } }, wasQueued: () => false, loadTrip: () => {} });
  await action(); return { writes, navigations, ...(captureAlerts ? { alerts } : {}) };
}
describe("real map event integration", () => {
  it("blocks disabled cargo departure and opens pickup without operational writes", async () => { expect(await runMapAction()).toEqual({ writes: [], navigations: ["/trip/701/cargo-pickup"] }); });
  it("allows the existing passenger pickup transition", async () => { expect((await runMapAction({ cargo: false })).writes).toEqual(["/api/trips/701/onboard", "/api/trips/701/enroute"]); });
  it("allows the existing cargo transition only after fresh server clearance", async () => {
    const clearance = { manifest: { ...manifest, service_code: "RESTAURANT_SUPPLY_PICKUP", manifest_ref: { hash: "a".repeat(64) } }, pickup_state: "READY", can_depart: true, securement_confirmed: true };
    expect((await runMapAction({ clearance })).writes).toEqual(["/api/trips/701/onboard", "/api/trips/701/enroute"]);
  });
  it("keeps travel-to-pickup and destination arrival independent of cargo receipts", async () => {
    expect((await runMapAction({ status: "Trip Started" })).writes).toEqual(["/api/trips/701/at-pickup"]);
    expect((await runMapAction({ status: "En Route" })).writes).toEqual(["/api/trips/701/dropoff"]);
  });
  it("routes an unconfirmed delivery to verification rather than completing", async () => { expect(await runMapAction({ status: "Drop-off" })).toEqual({ writes: [], navigations: ["/trip/701/cargo-delivery"] }); });
  it.skipIf(!existsSync(new URL("../node_modules/expo-router/build/getRoutes.js", import.meta.url)))("registers Trip Details alongside all installed Expo cargo routes", () => {
    const require = createRequire(import.meta.url);
    const { getRoutes } = require("../node_modules/expo-router/build/getRoutes");
    const context = () => ({ default: () => null });
    context.keys = () => ["./_layout.js", "./(app)/_layout.js", "./(app)/trip/[id].js", "./(app)/trip/[id]/cargo.js", "./(app)/trip/[id]/cargo-pickup.js", "./(app)/trip/[id]/cargo-delivery.js"];
    const names = node => [node.route, ...(node.children || []).flatMap(names)];
    expect(names(getRoutes(context, { platform: "android", ignoreEntryPoints: true }))).toEqual(expect.arrayContaining(["trip/[id]", "trip/[id]/cargo", "trip/[id]/cargo-pickup", "trip/[id]/cargo-delivery"]));
  });
});

describe("reviewed cargo rendered actions", () => {
  it("keeps equal-count notes on clean pickup and disables report issue", async () => {
    const { CargoWorkflowContent } = await load(fileURLToPath(new URL("CargoWorkflowContent.jsx", base)));
    const html = renderToStaticMarkup(React.createElement(CargoWorkflowContent, { mode: "pickup", execution: { manifest, capabilities: { observe: true } }, trip: { trip_status: "At Pickup" }, view: { canSubmit: true, stage: "PICKUP", summary: {}, blockers: [] }, review: true, form: { counts: { boxes: "10" }, issues: { boxes: { reported: true, remarks: "Packaging checked" } } } }));
    expect(html).toContain('<button>Confirm pickup'); expect(html).toContain('<button disabled="">Report pickup issue');
  });
  it.each([true, false])("shows a legacy hold in the overview with manifest %s", async available => {
    const { CargoWorkflowContent } = await load(fileURLToPath(new URL("CargoWorkflowContent.jsx", base)));
    const execution = available ? { manifest: { ...manifest, manifest_ref: { hash: "a".repeat(64) }, service_code: "RESTAURANT_SUPPLY_PICKUP" }, capabilities: { observe: true } } : null;
    const trip = { vehicle_id: 3, operational_use: "Cargo", load_type: "Cargo", trip_status: "In Progress" };
    const html = renderToStaticMarkup(React.createElement(CargoWorkflowContent, { mode: "overview", execution, trip, view: buildCargoViewModel(execution, { driverType: "Cargo", trip }), form: { counts: {}, issues: {} } }));
    expect(html).toMatch(/In Progress/); expect(html).toMatch(/Drop-off.*Arrived/); expect(html).toMatch(/Fleet/); expect(html).not.toContain('>Verify delivery<');
  });
  it("blocks the real map legacy action with an actionable hold and no writes", async () => {
    const result = await runMapAction({ status: "In Progress", captureAlerts: true });
    expect(result.writes).toEqual([]); expect(result.navigations).toEqual(["/trip/701/cargo"]); expect(result.alerts[0]).toMatch(/In Progress.*Fleet/);
  });
});

it.each([[true, "Passenger"], [false, "Cargo"]])("real map refuses mismatched cargo=%s", async (cargo, operationalUse) => {
  const result = await runMapAction({ cargo, operationalUse, captureAlerts: true });
  expect(result.writes).toEqual([]); expect(result.navigations).toEqual([]); expect(result.alerts[0]).toMatch(/vehicle.*saved driver type/i);
});

describe("direct cargo screen rendered assignment gate", () => {
  it.each(["overview", "pickup", "delivery"])("renders a mismatch explanation without cargo controls in %s", async mode => {
    const source = readFileSync(new URL("../components/cargo/CargoWorkflowScreen.jsx", import.meta.url), "utf8");
    const tree = parse(source, { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true }, range: true });
    let branch;
    function find(node) {
      if (!node || typeof node !== "object") return;
      if (node.type === "ConditionalExpression" && source.slice(...node.test.range) === "active && !screen.loading && !cargoAllowed") branch = source.slice(...node.range);
      for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(find); else if (value && typeof value === "object") find(value);
    }
    find(tree); expect(branch).toBeTruthy();
    const { code } = await transform(`module.exports = (${branch});`, { loader: "jsx", format: "cjs" });
    for (const [operational_use, load_type] of [["Cargo", "Passenger"], ["Passenger", "Cargo"]]) {
      const workspace = resolveDriverWorkspace({ driverType: operational_use, trip: { vehicle_id: 3, operational_use, load_type } });
      const scope = { exports: null };
      runInNewContext(code, { module: scope, React, mode, active: true, screen: { loading: false }, cargoAllowed: false, workspace, workspaceBlockReason, type: theme.type, colors: theme.colors, View: primitive("div"), Text: primitive("span"), ClayButton: ({ label }) => React.createElement("button", null, label), load: () => {}, refresh: () => {}, router: {}, id: 701 });
      const html = renderToStaticMarkup(scope.exports);
      expect(html).toMatch(/saved trip type.*vehicle/i); expect(html).toContain("Refresh assignment"); expect(html).not.toMatch(/Confirm pickup|Record delivery|Review counts|Verify pickup/);
    }
  });
});

describe("normalized radar assignment selection", () => {
  it.each([["Cargo", "Cargo", true], ["Passenger", "Passenger", true], ["Cargo", "Passenger", false], ["Passenger", "Cargo", false]])("tap selects %s vehicle / %s trip safely", async (operational_use, load_type, allowed) => {
    const trip = { trip_id: 701, vehicle_id: 3, operational_use, load_type };
    const [selectedMarker] = normalizeRadarMarkers([{ id: "trip_701", type: "assignment", lat: 14.6, lng: 121, tripId: "701", rawData: trip }]);
    expect(selectedMarker).not.toHaveProperty("rawData");
    let workspaceExpression, acceptExpression;
    function find(node) {
      if (!node || typeof node !== "object") return;
      if (node.type === "VariableDeclarator" && node.id.name === "markerWorkspace") workspaceExpression = mapSource.slice(...node.init.range);
      if (node.type === "VariableDeclarator" && node.id.name === "handleAcceptAssignment") acceptExpression = mapSource.slice(...node.init.range);
      for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(find); else if (value && typeof value === "object") find(value);
    }
    find(mapTree);
    const nearbyTrips = [trip], writes = [], alerts = [];
    const workspace = runInNewContext(workspaceExpression, { resolveDriverWorkspace, profile: { driverType: operational_use }, selectedMarker, nearbyTrips });
    expect(workspace.mode).toBe(operational_use.toLowerCase()); expect(workspace.tripReady).toBe(allowed);
    const accept = runInNewContext(`(${acceptExpression})`, { assertCurrentOperation: () => {}, nearbyTrips, profile: { driverType: operational_use }, serverConfirmed: true, tripConfirmed: true, connectivity: "online", resolveDriverWorkspace, workspaceBlockReason, setAcceptingTripId: () => {}, setSelectedMarker: () => {}, loadTrip: async () => {}, wasQueued: () => false, AppAlert: { alert: (title, message) => alerts.push(message) }, user: { employeeId: 12 }, tripSession: {}, api: { put: async path => { writes.push(path); return {}; } } });
    await accept(selectedMarker.tripId);
    expect(writes).toEqual(allowed ? ["/api/mobile/driver/trips/701/accept"] : []);
    if (!allowed) expect(alerts[0]).toMatch(/saved trip type.*vehicle/i);
  });
});

it.each([ { driverType: "Cargo", cargo: false }, { driverType: "Passenger", cargo: true }, { driverType: null }, { serverConfirmed: false }, { tripConfirmed: false }, { connectivity: "offline" }, { connectivity: "unstable" } ])("real map blocks incompatible or unconfirmed profile/trip %j", async options => {
  const result = await runMapAction({ ...options, captureAlerts: true });
  expect(result.writes).toEqual([]); expect(result.navigations).toEqual([]); expect(result.alerts.length).toBe(1);
});

it("renders compatible cached cargo as read only until profile and trip are confirmed online", async () => {
  const { CargoWorkflowContent } = await load(fileURLToPath(new URL("CargoWorkflowContent.jsx", base)));
  const html = renderToStaticMarkup(React.createElement(CargoWorkflowContent, { mode: "pickup", execution: { manifest, capabilities: { observe: true } }, trip: { trip_status: "At Pickup" }, view: { canSubmit: false, stage: "PICKUP", summary: {}, blockers: [] }, review: true, form: { counts: { boxes: "10" }, issues: {} } }));
  expect(html).toContain('<button disabled="">Confirm pickup');
  expect(html).toContain('<button disabled="">Report pickup issue');
});

it.each(["offline", "driver-type", "removed-trip"])("real map rechecks %s after an awaited geofence read before writing", async change => {
  const result = await runMapAction({ cargo: false, status: "Trip Started", afterRead: context => {
    if (change === "offline") context.connectivity = "offline";
    if (change === "driver-type") context.profile.driverType = "Cargo";
    if (change === "removed-trip") context.trips = [];
  } });
  expect(result.writes).toEqual([]);
});

function screenVariable(path, name) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const tree = parse(source, { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true }, range: true });
  let expression;
  function find(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "VariableDeclarator" && node.id.name === name) expression = source.slice(...node.init.range);
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(find); else if (value && typeof value === "object") find(value);
  }
  find(tree);
  if (!expression) throw new Error(`Missing screen expression ${name}`);
  return expression;
}

describe("trip details action guard", () => {
  const path = "../app/(app)/trip/[id].js";
  it.each([["Cargo", "Passenger"], ["Passenger", "Cargo"], [null, "Passenger"]])("blocks saved driver %s against exact %s trip", async (driverType, vehicleType) => {
    const trip = { trip_id: 701, vehicle_id: 3, operational_use: vehicleType, load_type: vehicleType, trip_status: "Assigned" };
    const workspace = runInNewContext(screenVariable(path, "workspace"), { resolveDriverWorkspace, profile: { driverType }, trip });
    const canOperate = runInNewContext(screenVariable(path, "canOperate"), { workspace, trip, id: 701, serverConfirmed: true, tripConfirmed: true, status: "online" });
    expect(workspace.mode).toBe(driverType ? driverType.toLowerCase() : "unclassified");
    expect(workspaceBlockReason(workspace)).toMatch(/Dispatch/); expect(canOperate).toBe(false);
    expect(runInNewContext(screenVariable(path, "ctaDisabled"), { accepting: false, ctaActive: true, canOperate })).toBe(true);
    const start = runInNewContext(`(${screenVariable(path, "handleAcceptStart")})`, { canOperate });
    await start(); // Reaching any write would raise an undefined-reference error.
  });
  it.each([{ serverConfirmed: false }, { tripConfirmed: false }, { status: "offline" }, { status: "unstable" }])("blocks otherwise compatible unconfirmed detail %j", values => {
    const trip = { trip_id: 701, vehicle_id: 3, operational_use: "Passenger", load_type: "Passenger" };
    const workspace = resolveDriverWorkspace({ driverType: "Passenger", trip });
    const canOperate = runInNewContext(screenVariable(path, "canOperate"), { workspace, trip, id: 701, serverConfirmed: true, tripConfirmed: true, status: "online", ...values });
    expect(canOperate).toBe(false);
  });
});

describe("Trips renders the saved driver workspace", () => {
  it.each([["Cargo", "Passenger"], ["Passenger", "Cargo"], ["Cargo", "Cargo"], ["Passenger", "Passenger"], [null, "Cargo"]])("renders driver %s against trip %s", async (driverType, vehicleType) => {
    const expression = screenVariable("../app/(app)/(tabs)/trips.js", "TripCard");
    const { code } = await transform(`module.exports = ${expression};`, { loader: "jsx", format: "cjs" });
    const scope = { exports: null };
    runInNewContext(code, { module: scope, React, memo: component => component, useMemo: callback => callback(), resolveDriverWorkspace, workspaceModeLabel, workspaceBlockReason, formatWhen: () => null, bucketTone: () => "primary", PRE_START: ["Assigned"], preTripChipLabel: () => "Pre-trip check", isCargoLoad, loadTitle, loadSubtitle, styles: {}, View: primitive("div"), Text: primitive("span"), ClayCard: primitive("section"), ClayBadge: ({ label }) => React.createElement("span", null, label), ClayButton: ({ label }) => React.createElement("button", null, label), RouteTimeline: () => null, Ionicons: () => null });
    const trip = { trip_id: 701, vehicle_id: 3, operational_use: vehicleType, load_type: vehicleType, trip_status: "Assigned", passenger_name: "VIP guest", cargo_description: "Hotel supplies" };
    const html = renderToStaticMarkup(React.createElement(scope.exports, { driverType, trip, display: "Assigned", router: {}, ...theme }));
    expect(html).toContain(driverType ? `${driverType} driver` : "Driver type needs setup");
    if (driverType !== vehicleType) expect(html).toContain("Dispatch");
    // A blocked mismatch presents the STORED trip type (the driver can tell
    // Dispatch what the trip actually is); the driver-mode label is reserved
    // for the workspace heading above. Matching pairs keep the mode content.
    if (driverType !== vehicleType ? vehicleType === "Cargo" : driverType === "Cargo") { expect(html).toContain("Hotel supplies"); expect(html).not.toContain("VIP guest"); }
    if (driverType !== vehicleType ? vehicleType === "Passenger" : driverType === "Passenger") expect(html).toContain("VIP guest");
    expect(html).not.toMatch(/ACCEPT|START ROUTE|Confirm pickup/);
  });
});

it.each(["submit", "photo", "recount", "edit"])("direct Cargo route blocks %s when current login profile/trip is unconfirmed", async name => {
  const expression = screenVariable("../components/cargo/CargoWorkflowScreen.jsx", name);
  const action = runInNewContext(`(${expression})`, { inFlight: { current: false }, active: true, canOperate: false });
  await action({});
});

it("detail rechecks driver type after accept before start", async () => {
  const path = "../app/(app)/trip/[id].js", writes = [];
  const helper = { exports: {} };
  const { code } = await transform(readFileSync(new URL('./trip-odometer.js', import.meta.url), 'utf8'), { format: 'cjs' });
  runInNewContext(code, { module: helper, exports: helper.exports, require: () => ({}) });
  const { odometerStartRoute } = helper.exports;
  const trip = { trip_id: 701, vehicle_id: 3, operational_use: "Passenger", load_type: "Passenger", trip_status: "Assigned" };
  const operationRef = { current: { profile: { driverType: "Passenger" }, trip, canOperate: true, session: {} } };
  const action = runInNewContext(`(${screenVariable(path, "handleAcceptStart")})`, { canOperate: true, resolveDriverWorkspace, odometerStartRoute, profile: { driverType: "Passenger" }, trip, operationRef, dismiss: async () => {}, setAccepting: () => {}, isAccepted: false, id: 701, user: { employeeId: 12 }, tripSession: {}, isCurrentCargoSession: () => true, status: "online", api: { put: async path => { writes.push(path); operationRef.current.profile.driverType = "Cargo"; return {}; } }, wasQueued: () => false, router: { replace: () => {} }, AppAlert: { alert: () => {} } });
  await action();
  expect(writes).toEqual(["/api/trips/701/accept"]);
});

it("detail never authorizes a previous route's trip for a new deep link", () => {
  const trip = { trip_id: 701, vehicle_id: 3, operational_use: "Cargo", load_type: "Cargo" };
  const workspace = resolveDriverWorkspace({ driverType: "Cargo", trip });
  expect(runInNewContext(screenVariable("../app/(app)/trip/[id].js", "canOperate"), { workspace, trip, id: 702, serverConfirmed: true, tripConfirmed: true, status: "online" })).toBe(false);
});

it.each([true, false])("a stale cargo count can restart only with current online assignment authority %s", async canOperate => {
  const { CargoWorkflowContent } = await load(fileURLToPath(new URL("CargoWorkflowContent.jsx", base)));
  const html = renderToStaticMarkup(React.createElement(CargoWorkflowContent, { mode: "pickup", canOperate, stale: true, pending: true, execution: { manifest, capabilities: { observe: true } }, trip: { trip_status: "At Pickup" }, view: { canSubmit: false, stage: "STALE_REVIEW", summary: {}, blockers: [] }, form: { counts: { boxes: "10" }, issues: {} } }));
  expect(html).toContain(canOperate ? '<button>Begin a new count' : '<button disabled="">Begin a new count');
});

it.each(["driver-type", "removed-trip", "route", "offline"].flatMap(change => ["permission", "camera", "directory", "copy"].map(wait => [change, wait])))("camera stops %s during %s before any later operation", async (change, wait) => {
  const authority = { type: "Cargo", assigned: true, route: "701", online: true };
  const isAuthorized = () => authority.type === "Cargo" && authority.assigned && authority.route === "701" && authority.online;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const effects = [];
  const ImagePicker = {
    requestCameraPermissionsAsync: async () => { effects.push("permission"); if (wait === "permission") await gate; return { granted: true }; },
    launchCameraAsync: async () => { effects.push("camera"); if (wait === "camera") await gate; return { canceled: false, assets: [{ uri: "file://temporary.jpg" }] }; },
  };
  const FileSystem = { documentDirectory: "file://app/", makeDirectoryAsync: async () => { effects.push("directory"); if (wait === "directory") await gate; }, copyAsync: async () => { effects.push("copy"); if (wait === "copy") await gate; } };
  const action = runInNewContext(`(${screenVariable("../components/cargo/CargoWorkflowScreen.jsx", "photo")})`, { inFlight: { current: false }, canOperate: true, issueLine: "boxes", actorId: 12, id: "701", captureCargoSession: () => ({}), isCurrentCargoSession: () => true, isAuthorized, setBusy: () => {}, setMessage: () => {}, ImagePicker, FileSystem, formRef: { current: { counts: { boxes: "10" }, issues: {} } }, persist: async () => { effects.push("persist"); } });
  const work = action();
  await vi.waitFor(() => expect(effects).toContain(wait));
  if (change === "driver-type") authority.type = "Passenger";
  if (change === "removed-trip") authority.assigned = false;
  if (change === "route") authority.route = "702";
  if (change === "offline") authority.online = false;
  release(); await work;
  if (["permission", "camera"].includes(wait)) expect(effects).not.toContain("directory");
  if (wait !== "copy") expect(effects).not.toContain("copy");
  expect(effects).not.toContain("persist");
  if (wait === "permission") expect(effects).not.toContain("camera");
});

it("Cargo screen authority uses the latest compatible trip, profile, connection and route", () => {
  const path = "../components/cargo/CargoWorkflowScreen.jsx";
  const identity = "12:701:PICKUP:pickup", trip = { trip_id: 701, vehicle_id: 3, operational_use: "Cargo", load_type: "Cargo" };
  const requestNumber = { current: 1 }, operationRef = { current: { identity, trip, session: {}, request: 1, canOperate: true } };
  const isAuthorized = runInNewContext(`(${screenVariable(path, "isAuthorized")})`, { operationRef, identity, id: "701", requestNumber, isCurrentCargoSession: () => true });
  expect(isAuthorized("701")).toBe(true); expect(isAuthorized("702")).toBe(false);
  for (const values of [{ driverType: "Passenger", trip, status: "online" }, { driverType: "Cargo", trip: null, status: "online" }, { driverType: "Cargo", trip, status: "offline" }]) {
    const workspace = resolveDriverWorkspace({ driverType: values.driverType, trip: values.trip });
    operationRef.current.canOperate = runInNewContext(screenVariable(path, "canOperate"), { cargoAllowed: workspace.mode === "cargo" && workspace.tripReady === true, active: true, screen: { fresh: true, session: {} }, serverConfirmed: true, status: values.status, isCurrentCargoSession: () => true });
    expect(isAuthorized("701")).toBe(false);
  }
  operationRef.current.canOperate = true;
  operationRef.current.identity = "12:701:PICKUP:overview"; expect(isAuthorized("701")).toBe(false);
  operationRef.current.identity = identity; requestNumber.current = 2; expect(isAuthorized("701")).toBe(false);
  operationRef.current = null; expect(isAuthorized("701")).toBe(false);
});
