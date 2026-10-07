import { describe, expect, it } from "vitest";
import { isCargoLoad, loadTitle, loadSubtitle, tripStatusLabel } from "./load-presentation.js";

const cargo = {
  load_type: "Cargo",
  passenger_count: null,
  cargo_weight_kg: 650,
  cargo_description: "Restaurant vegetables",
  passenger_name: "Ghost Guest",
};

describe("mobile load presentation", () => {
  it("never renders a guest name or zero-passenger copy for cargo", () => {
    expect(isCargoLoad(cargo)).toBe(true);
    expect(loadTitle(cargo)).toBe("Restaurant vegetables");
    expect(loadTitle(cargo)).not.toContain("Ghost Guest");
    expect(loadSubtitle(cargo)).toBe("650 kg declared");
    expect(loadSubtitle(cargo)).not.toMatch(/passenger/i);
    expect(loadSubtitle({ ...cargo, cargo_weight_kg: null })).toBeNull();
  });

  it("keeps passenger rendering unchanged", () => {
    const row = { load_type: "Passenger", passenger_count: 3, passenger_name: "Maria Santos" };
    expect(loadTitle(row)).toBe("Maria Santos");
    expect(loadSubtitle(row)).toBe("3 passengers");
  });

  it("maps cargo lifecycle states without renaming DB state", () => {
    expect(tripStatusLabel("Passenger Onboard", "Cargo")).toBe("Cargo Loaded");
    expect(tripStatusLabel("Drop-off", "Cargo")).toBe("At Delivery");
    expect(tripStatusLabel("En Route", "Cargo")).toBe("En Route");
    expect(tripStatusLabel("Passenger Onboard", "Passenger")).toBe("Passenger Onboard");
  });
});
