import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transform } from "esbuild";
import { readFileSync, existsSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { parse } from "espree";
import { createRequire } from "node:module";
import { resolveCargoMapGate } from "./cargo-view-model";
import { isCargoLoad } from "./load-presentation";
import { resolve, dirname } from "node:path";
import { describe, expect, it } from "vitest";
const cache = new Map();
const primitive = tag => function NativePrimitive({ children, accessibilityLabel, accessibilityState, value, editable, placeholder }) { return React.createElement(tag, { "aria-label": accessibilityLabel, disabled: accessibilityState?.disabled || editable === false, value, placeholder }, children); };
const theme = { colors: { background: "#F5F2EC", onSurface: "#1F2925", onSurfaceVariant: "#53615A", primary: "#285448", onPrimary: "#FFFFFF", error: "#A84340", surfaceContainerLow: "#FBF8F3" }, type: {}, scheme: "light" };
async function load(path) {
  if (cache.has(path)) return cache.get(path);
  const code = (await transform(readFileSync(path, "utf8"), { loader: "jsx", format: "cjs" })).code;
  const deps = { react: React, "react-native": { View: primitive("div"), Text: primitive("span"), Pressable: primitive("button"), TextInput: primitive("input"), Image: primitive("img"), StyleSheet: { create: v => v }, Platform: { OS: "android" } } };
  for (const match of code.matchAll(/require\("([^" ]+)"\)/g)) {
    const name = match[1]; if (deps[name]) continue;
    if (name.endsWith("theme-context")) deps[name] = { useTheme: () => theme };
    else if (name.endsWith("/clay")) deps[name] = { ClayCard: primitive("section"), ClayButton: ({ label, disabled }) => React.createElement("button", { disabled }, label), ClayInput: ({ label, value, error, editable, inputStyle, placeholderTextColor }) => React.createElement("label", null, label, React.createElement("input", { value, readOnly: true, disabled: editable === false, style: inputStyle, "data-placeholder-color": placeholderTextColor }), error) };
    else { let target = resolve(dirname(path), name); for (const suffix of ["", ".jsx", ".js"]) if (existsSync(target + suffix)) { target += suffix; break; } deps[name] = await load(target); }
  }
  const scope = { exports: {} }; runInNewContext(code, { module: scope, exports: scope.exports, React, require: name => deps[name] }); cache.set(path, scope.exports); return scope.exports;
}
const base = new URL("../components/cargo/", import.meta.url);
const manifest = { manifest_ref: { revision: 1 }, lines: [{ line_id: "boxes", name: "Fresh produce", expected_quantity: "10", unit: "boxes", quantity_basis: "TRANSPORT_PACKAGE", reference_image_ref: null, handling: ["SECURE_LOAD"] }] };
describe("rendered native cargo components", () => {
  it("renders separate expected and initially blank actual counts with image absence", async () => {
    const { CargoManifestList } = await load(new URL("CargoManifestList.jsx", base).pathname.replace(/^\/C:/, "C:"));
    const html = renderToStaticMarkup(React.createElement(CargoManifestList, { manifest, counts: { boxes: "" }, stage: "PICKUP", onChange: () => {} }));
    expect(html).toContain("Fresh produce"); expect(html).toContain("10"); expect(html).toContain("Actual pickup count"); expect(html).toContain('value=""'); expect(html).toContain("Reference image unavailable"); expect(html).toContain("min-width:0"); expect(html).toContain('data-placeholder-color="#53615A"'); expect(html).not.toMatch(/passenger|Call guest/i);
  });
  it("keeps expected, picked-up and delivered values distinct", async () => {
    const { CargoReceiptSummary } = await load(new URL("CargoReceiptSummary.jsx", base).pathname.replace(/^\/C:/, "C:"));
    const html = renderToStaticMarkup(React.createElement(CargoReceiptSummary, { manifest, lines: [{ line_id: "boxes", expected_quantity: "10", pickup_quantity: "9", delivery_quantity: "9", order_shortage: "1", delivery_shortage: "0" }] }));
    for (const label of ["Expected", "Picked up", "Delivered", "Order shortage", "Delivery shortage", "1 boxes", "0 boxes"]) expect(html).toContain(label);
  });
  it("partner received text does not authorize departure", async () => {
    const { CargoDecisionStatus } = await load(new URL("CargoDecisionStatus.jsx", base).pathname.replace(/^\/C:/, "C:"));
    const html = renderToStaticMarkup(React.createElement(CargoDecisionStatus, { view: { stage: "AWAITING_DECISION", blockers: [{ code: "CARGO_SOURCE_DECISION_REQUIRED", message: "Wait for source review." }], summary: { syncLabel: "Saved to Fleet", feedbackLabel: "Partner acknowledged receipt", sourceDecisionLabel: "Awaiting source decision", clearanceLabel: "Fleet clearance required", securementLabel: "Post-load securement required" } } }));
    expect(html).toContain("Awaiting source decision"); expect(html).toContain("Fleet clearance required"); expect(html).toContain("Post-load securement required"); expect(html).not.toContain("Ready to depart");
  });
});

describe("cargo workflow screen actions", () => {
  it.each(["RESTAURANT_SUPPLY_PICKUP", "RESTAURANT_FOOD_DELIVERY", "HOTEL_SUPPLY_TRANSFER"])("renders the same driver controls for %s", async service_code => {
    const { CargoWorkflowContent } = await load(new URL("CargoWorkflowContent.jsx", base).pathname.replace(/^\/C:/, "C:"));
    const html = renderToStaticMarkup(React.createElement(CargoWorkflowContent, { mode: "pickup", execution: { manifest: { ...manifest, service_code }, capabilities: { observe: true } }, trip: { trip_status: "At Pickup" }, view: { stage: "PICKUP", summary: {}, blockers: [] }, form: { counts: { boxes: "" }, issues: {} }, onIssue: () => {} }));
    expect(html).toContain("Review counts"); expect(html).toContain("Report issue: Fresh produce"); expect(html).not.toMatch(/passenger|Call guest/i);
  });
  it("blocks clean pickup confirmation on a shortage and exposes the separate report action", async () => {
    const { CargoWorkflowContent } = await load(new URL("CargoWorkflowContent.jsx", base).pathname.replace(/^\/C:/, "C:"));
    const html = renderToStaticMarkup(React.createElement(CargoWorkflowContent, { mode: "pickup", execution: { manifest, capabilities: { observe: true } }, trip: { trip_status: "At Pickup" }, view: { stage: "PICKUP", summary: {}, blockers: [] }, review: true, form: { counts: { boxes: "9" }, issues: { boxes: { remarks: "One box missing" } } } }));
    expect(html).toContain('<button disabled="">Confirm pickup'); expect(html).toContain('<button>Report pickup issue');
  });
  it("keeps delivery observation separate from unavailable receiver confirmation", async () => {
    const { CargoWorkflowContent } = await load(new URL("CargoWorkflowContent.jsx", base).pathname.replace(/^\/C:/, "C:"));
    const html = renderToStaticMarkup(React.createElement(CargoWorkflowContent, { mode: "delivery", execution: { manifest, capabilities: { observe: true } }, trip: { trip_status: "Drop-off" }, view: { stage: "DELIVERY", canConfirmDelivery: false, summary: { receiverLabel: "Receiver authority unavailable" }, blockers: [] }, review: true, form: { counts: { boxes: "9" }, issues: {} } }));
    expect(html).toContain("Record delivery observation"); expect(html).toContain('<button disabled="">Confirm delivery'); expect(html).toContain("pending review");
  });
});

const mapSource = readFileSync(new URL("../app/(app)/(tabs)/map.js", import.meta.url), "utf8");
const mapTree = parse(mapSource, { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true }, range: true });
let swipeHandler;
function visit(node) {
  if (!node || typeof node !== "object") return;
  if (node.type === "JSXAttribute" && node.name.name === "onSwipeSuccess") swipeHandler = mapSource.slice(...node.value.expression.range);
  for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
}
visit(mapTree);
async function runMapAction({ cargo = true, status = "At Pickup", clearance = null } = {}) {
  const writes = [], navigations = [];
  const trip = { trip_id: 701, load_type: cargo ? "Cargo" : "Passenger", trip_status: status };
  const action = runInNewContext(`(${swipeHandler})`, { inFlight: false, setInFlight: () => {}, activeTrip: trip, isCargoLoad, user: { employeeId: 12 }, connectivity: "online", captureCargoSession: () => ({}), isCurrentCargoSession: () => true, resolveCargoMapGate, cargoApi: { getExecution: async () => { if (!clearance) throw new Error("Disabled"); return clearance; } }, getCargoSyncState: async () => ({ state: "NONE" }), AppAlert: { alert: () => {} }, router: { push: path => navigations.push(path) }, isPending: false, isDriverAccepted: false, isState1: status === "Trip Started", isState2: status === "At Pickup", isState3: status === "En Route", isState4: status === "Drop-off", api: { get: async () => ({ state: "inside" }), put: async path => { writes.push(path); return {}; } }, wasQueued: () => false, loadTrip: () => {} });
  await action(); return { writes, navigations };
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
