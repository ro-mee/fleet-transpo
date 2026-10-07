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
    expect(map.includes("tripActionLabel(activeTrip.trip_status, activeTrip.load_type)")).toBe(true);
    expect(map).toContain("tripStatusLabel(activeTrip.trip_status, activeTrip.load_type)");
    expect(screen("app/(app)/trip/[id].js").includes("tripStatusLabel(trip.trip_status, trip.load_type)")).toBe(true);
    expect(map).not.toContain('isState2 ? "PICKED UP GUEST"');
  });
  it("does not offer a passenger call action on a cargo consignment", () => {
    const map = screen("app/(app)/(tabs)/map.js");
    expect(map).toContain('{!isCargoLoad(activeTrip) && <Pressable');
    expect(screen("app/(app)/(tabs)/history.js").includes("tripStatusLabel(trip.trip_status, trip.load_type)")).toBe(true);
  });
});
