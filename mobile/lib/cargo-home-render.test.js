import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transform } from "esbuild";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import * as loadPresentation from "./load-presentation";
import { homeTripAction } from "./home-trips";

// Render the real Home card JSX with lightweight native primitives. Native
// maps and device APIs are external boundaries, not the copy under test.
const native = tag => function NativePrimitive({ children }) { return React.createElement(tag, null, children); };
const { code } = await transform(readFileSync(new URL("../components/home/DriverHomeCards.jsx", import.meta.url), "utf8"), { loader: "jsx", format: "cjs" });
const scope = { exports: {} };
const dependencies = {
  react: React,
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
const { DriverTripCard } = scope.exports;
describe("rendered cargo Home card", () => {
  it.each([["Passenger Onboard", "Cargo Loaded"], ["Drop-off", "At Delivery"]])("renders %s as %s without guest/zero-passenger text", (trip_status, label) => {
    const trip = { trip_id: 701, trip_status, load_type: "Cargo", cargo_description: "Restaurant vegetables", cargo_weight_kg: 650,
      passenger_count: 0, passenger_name: "Ghost Guest", origin: "Supplier", destination: "Hotel" };
    const html = renderToStaticMarkup(React.createElement(DriverTripCard, { trip, current: true, nowMs: Date.now(), canManage: true }));
    for (const text of [label, "Restaurant vegetables", "650 kg declared"]) expect(html).toContain(text);
    expect(html).not.toContain("Ghost Guest"); expect(html).not.toContain("0 passengers");
  });
});
