import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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
    expect(map).toContain("tripStatusLabel(activeTrip.trip_status, profile?.driverType)");
    expect(screen("app/(app)/trip/[id].js").includes("tripStatusLabel(trip.trip_status, isTerminal ? trip.load_type : profile?.driverType)")).toBe(true);
    expect(map).not.toContain('isState2 ? "PICKED UP GUEST"');
  });
  it("does not offer a passenger call action on a cargo consignment", () => {
    const map = screen("app/(app)/(tabs)/map.js");
    expect(map).toContain('{(profile?.driverType === "Passenger") && serverConfirmed && tripConfirmed && connectivity === "online" && workspace.tripReady === true && <Pressable');
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
