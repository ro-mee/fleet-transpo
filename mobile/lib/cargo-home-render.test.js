import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transform } from "esbuild";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import * as loadPresentation from "./load-presentation";
import { homeTripAction } from "./home-trips";
import { resolveDriverWorkspace } from "./driver-workspace";

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
const { DriverTripCard, DriverWorkspaceCard, DriverHeroCard } = scope.exports;
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
