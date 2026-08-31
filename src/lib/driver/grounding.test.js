import { describe, it, expect } from "vitest";
import {
  shouldGroundVehicle,
  requiresVehicleMaintenance,
  BREAKDOWN_RE,
  SEVERE_SEVERITIES,
} from "@/lib/driver/grounding";

describe("shouldGroundVehicle", () => {
  it("grounds a breakdown-type incident", () => {
    expect(shouldGroundVehicle({ incidentType: "Engine breakdown", severity: "Minor", vehicleId: 1 })).toBe(true);
  });

  it("grounds Major and Critical severity regardless of type", () => {
    expect(shouldGroundVehicle({ incidentType: "Collision", severity: "Major", vehicleId: 2 })).toBe(true);
    expect(shouldGroundVehicle({ incidentType: "Collision", severity: "Critical", vehicleId: 2 })).toBe(true);
  });

  it("does not ground Minor/Moderate non-breakdown incidents", () => {
    expect(shouldGroundVehicle({ incidentType: "Minor fender bump", severity: "Minor", vehicleId: 3 })).toBe(false);
    expect(shouldGroundVehicle({ incidentType: "Late report", severity: "Moderate", vehicleId: 3 })).toBe(false);
  });

  it("does not ground when incident type is missing and severity is not severe", () => {
    expect(shouldGroundVehicle({ severity: "Minor", vehicleId: 5 })).toBe(false);
    expect(shouldGroundVehicle({ incidentType: null, vehicleId: 5 })).toBe(false);
  });

  it("never grounds without a vehicle", () => {
    expect(shouldGroundVehicle({ incidentType: "Engine breakdown", severity: "Critical", vehicleId: null })).toBe(false);
    expect(shouldGroundVehicle({ incidentType: "Engine breakdown", severity: "Critical", vehicleId: 0 })).toBe(false);
  });

  it("is case-insensitive on incident type", () => {
    expect(shouldGroundVehicle({ incidentType: "ENGINE FAILURE", severity: "Minor", vehicleId: 4 })).toBe(true);
  });
});

describe("grounding constants", () => {
  it("treats Major and Critical as severe", () => {
    expect(SEVERE_SEVERITIES.has("Major")).toBe(true);
    expect(SEVERE_SEVERITIES.has("Critical")).toBe(true);
    expect(SEVERE_SEVERITIES.has("Moderate")).toBe(false);
    expect(SEVERE_SEVERITIES.has("Minor")).toBe(false);
  });
  it("BREAKDOWN_RE matches mechanical keywords", () => {
    expect(BREAKDOWN_RE.test("flat tire")).toBe(true);
    expect(BREAKDOWN_RE.test("electrical fault")).toBe(true);
    expect(BREAKDOWN_RE.test("small dent")).toBe(false);
  });
});

describe("requiresVehicleMaintenance", () => {
  it("classifies mechanical failures and vehicle damage", () => {
    expect(requiresVehicleMaintenance({ incidentType: "breakdown", vehicleId: 1 })).toBe(true);
    expect(requiresVehicleMaintenance({ incidentType: "Brake failure", vehicleId: 1 })).toBe(true);
    expect(requiresVehicleMaintenance({ incidentType: "accident", description: "rear bumper damaged", vehicleId: 1 })).toBe(true);
  });

  it("does not turn non-vehicle incidents into work orders", () => {
    for (const incidentType of ["Passenger complaint", "Route issue", "Traffic delay", "Medical incident"]) {
      expect(requiresVehicleMaintenance({ incidentType, severity: "Critical", vehicleId: 1 })).toBe(false);
    }
  });

  it("does not create a work order without a vehicle", () => {
    expect(requiresVehicleMaintenance({ incidentType: "breakdown", vehicleId: null })).toBe(false);
  });
});
