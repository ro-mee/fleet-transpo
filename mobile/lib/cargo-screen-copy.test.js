import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from 'node:vm';
import { parse } from 'espree';
import * as copy from "./load-presentation";
const screen = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
describe("cargo screen copy", () => {
  it("maps actual load/unload actions while keeping passenger copy", () => {
    expect(copy.tripActionLabel("At Pickup", "Cargo")).toBe("CARGO LOADED");
    expect(copy.tripActionLabel("Drop-off", "Cargo")).toBe("CARGO DELIVERED");
    expect(copy.tripActionLabel("At Pickup", "Passenger")).toBe("PICKED UP GUEST");
    expect(copy.tripActionLabel("Drop-off", null)).toBe("DROPPED OFF GUEST");
  });
  it("wires map actions and both status badges to load-aware presentation", () => {
    const map = screen("app/(app)/(tabs)/map.js");
    expect(map.includes("tripActionLabel(activeTrip.trip_status, profile?.driverType)")).toBe(true);
    // Blocked mismatches present the STORED trip type on the status badge; the
    // driver-mode label is reserved for the workspace heading.
    expect(map).toContain("tripStatusLabel(activeTrip.trip_status, activeBlocked ? activeTrip.load_type : profile?.driverType)");
    expect(screen("app/(app)/trip/[id].js").includes("tripStatusLabel(trip.trip_status, isTerminal || workspace.tripReady === false ? trip.load_type : profile?.driverType)")).toBe(true);
    expect(map).not.toContain('isState2 ? "PICKED UP GUEST"');
  });
  it("does not offer a passenger call action on a cargo consignment", () => {
    const map = screen("app/(app)/(tabs)/map.js");
    let gate;
    function visit(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'LogicalExpression' && node.right.type === 'JSXElement' && node.right.openingElement.attributes.some(attr => attr.name?.name === 'accessibilityLabel' && attr.value?.value === 'Call passenger')) gate = map.slice(...node.left.range);
      for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);
    }
    visit(parse(map, { ecmaVersion: 'latest', sourceType: 'module', range: true, ecmaFeatures: { jsx: true } }));
    for (const [driverType, passenger_phone, expected] of [['Cargo', '09170000000', false], ['Passenger', null, false], ['Passenger', '09170000000', true]]) {
      expect(Boolean(runInNewContext(gate, { profile: { driverType }, activeTrip: { passenger_phone }, serverConfirmed: true, tripConfirmed: true, connectivity: 'online', workspace: { tripReady: true } }))).toBe(expected);
    }
    expect(screen("app/(app)/(tabs)/history.js").includes("tripStatusLabel(trip.trip_status, trip.load_type)")).toBe(true);
  });
});

it("routes each trip surface through its exact vehicle and gates operational controls", () => {
  const map = screen("app/(app)/(tabs)/map.js"), detail = screen("app/(app)/trip/[id].js"), trips = screen("app/(app)/(tabs)/trips.js");
  for (const source of [map, detail, trips]) { expect(source).toContain("resolveDriverWorkspace({ driverType"); expect(source).toContain("workspaceModeLabel(workspace)"); expect(source).toContain("workspaceBlockReason(workspace)"); }
  expect(detail).toContain('const ctaDisabled = accepting || !ctaActive || !canOperate');
  expect(detail).toContain('{isCargo && canOperate && !isTerminal && <ClayButton');
  expect(map).toContain('disabled={!serverConfirmed || !tripConfirmed || connectivity !== "online" || workspace.tripReady !== true ||');
});
