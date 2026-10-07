import { describe, expect, it } from "vitest";
import {
  isCargoLoad,
  loadTitle,
  loadSubtitle,
  tripStatusLabel,
} from "@/lib/trips/load-presentation";
import * as mobileMirror from "../../../mobile/lib/load-presentation.js";

const cargo = {
  load_type: "Cargo",
  passenger_count: null,
  cargo_weight_kg: 650,
  cargo_description: "Restaurant vegetables",
  guest_name: "Ghost Guest",
  passenger_name: "Ghost Guest",
};

const passenger = {
  load_type: "Passenger",
  passenger_count: 3,
  guest_name: "Maria Santos",
  passenger_name: "Maria Santos",
};

const legacy = { passenger_count: 2, passenger_name: "Juan Dela Cruz" };

describe("load presentation", () => {
  it("detects cargo loads only on the explicit Cargo type", () => {
    expect(isCargoLoad(cargo)).toBe(true);
    expect(isCargoLoad(passenger)).toBe(false);
    expect(isCargoLoad(legacy)).toBe(false);
    expect(isCargoLoad(null)).toBe(false);
  });

  it("titles cargo with the consignment, never a guest name", () => {
    expect(loadTitle(cargo)).toBe("Restaurant vegetables");
    expect(loadTitle({ ...cargo, cargo_description: "  " })).toBe("Cargo consignment");
    expect(loadTitle(passenger)).toBe("Maria Santos");
    expect(loadTitle(legacy)).toBe("Juan Dela Cruz");
  });

  it("subtitles cargo in kilograms and never as Passengers: 0", () => {
    expect(loadSubtitle(cargo)).toBe("650 kg declared");
    expect(loadSubtitle({ ...cargo, cargo_weight_kg: null })).toBeNull();
    expect(loadSubtitle(passenger)).toBe("3 passengers");
    expect(loadSubtitle({ ...passenger, passenger_count: 1 })).toBe("1 passenger");
    expect(loadSubtitle(legacy)).toBe("2 passengers");
  });

  it("maps internal lifecycle states to cargo wording without renaming DB state", () => {
    expect(tripStatusLabel("Passenger Onboard", "Cargo")).toBe("Cargo Loaded");
    expect(tripStatusLabel("Drop-off", "Cargo")).toBe("At Delivery");
    expect(tripStatusLabel("En Route", "Cargo")).toBe("En Route");
    expect(tripStatusLabel("Passenger Onboard", "Passenger")).toBe("Passenger Onboard");
    expect(tripStatusLabel("Passenger Onboard", null)).toBe("Passenger Onboard");
    expect(tripStatusLabel("Drop-off", undefined)).toBe("Drop-off");
  });

  it("mobile mirror renders byte-identical copy for every fixture", () => {
    const fixtures = [
      cargo,
      { ...cargo, cargo_weight_kg: null, cargo_description: "" },
      passenger,
      { ...passenger, passenger_count: 1 },
      legacy,
      {},
      null,
    ];
    for (const f of fixtures) {
      expect(mobileMirror.isCargoLoad(f)).toBe(isCargoLoad(f));
      expect(mobileMirror.loadTitle(f)).toBe(loadTitle(f));
      expect(mobileMirror.loadSubtitle(f)).toBe(loadSubtitle(f));
    }
    for (const status of ["Passenger Onboard", "Drop-off", "En Route", "At Pickup"]) {
      for (const load of ["Cargo", "Passenger", null, undefined]) {
        expect(mobileMirror.tripStatusLabel(status, load)).toBe(tripStatusLabel(status, load));
      }
    }
  });
});
