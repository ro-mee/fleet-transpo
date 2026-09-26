import { describe, it, expect } from "vitest";
import {
  shouldGroundVehicle,
  requiresVehicleMaintenance,
  shouldGroundReportedDefect,
  BREAKDOWN_RE,
  PROSE_GROUNDING_RE,
  TAGLISH_GROUNDING_RE,
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

describe("shouldGroundReportedDefect", () => {
  it("grounds the same faults as the incident path, in English", () => {
    for (const text of [
      "may problema sa brake", "flat tire sa harap", "loose steering",
      "engine is noisy", "transmission slips", "damaged bumper",
      "cracked windshield", "may overheat kahapon",
    ]) expect(shouldGroundReportedDefect(text), text).toBe(true);
  });

  it("grounds them in Filipino too — parity, not translation", () => {
    for (const text of [
      "sira ang preno", "flat ang gulong", "maluwag ang manibela",
      "maingay ang makina", "mahina ang baterya", "may usok",
      "may tagas sa ilalim", "basag ang salamin",
    ]) expect(shouldGroundReportedDefect(text), text).toBe(true);
  });

  it("does not ground prose that merely contains a keyword as a substring", () => {
    // The regression this anchoring exists for: BREAKDOWN_RE matches "tired"
    // and "entire", VEHICLE_DAMAGE_RE matches "accident" (via `dent`). Against
    // incident types that was harmless; against free text it would take a
    // serviceable vehicle out of dispatch because the driver said they were
    // tired.
    for (const text of [
      "I am tired", "the entire vehicle is fine", "entirely normal",
      "no accident today", "wala namang aksidente", "all good, pagod lang ako",
    ]) expect(shouldGroundReportedDefect(text), text).toBe(false);
  });

  it("does not ground a clean report or unrelated complaints", () => {
    for (const text of [
      "Nothing unusual", "wala akong napansin", "maayos naman",
      "the aircon is a bit weak", "matagal ang byahe", "",
    ]) expect(shouldGroundReportedDefect(text), text).toBe(false);
  });

  it("is safe on missing input", () => {
    expect(shouldGroundReportedDefect()).toBe(false);
    expect(shouldGroundReportedDefect(null)).toBe(false);
  });

  it("keeps the anchored vocabulary in step with the shared regexes", () => {
    // The parity guard. Every term the incident path treats as grounding must
    // also ground in prose; a term added above and not here fails this test
    // instead of silently going unenforced on the End Duty path.
    const CANONICAL = [
      "breakdown", "mechanical failure", "engine trouble", "brake failure",
      "flat tire", "tire", "tyre", "battery dead", "electrical fault",
      "overheat", "transmission issue", "steering problem",
      "damage", "damaged", "dent", "bumper", "bodywork", "mirror",
      "windshield", "impact",
    ];
    for (const term of CANONICAL) {
      const phrase = `noticed a ${term} on the vehicle`;
      expect(PROSE_GROUNDING_RE.test(phrase), `${term} should ground in prose`).toBe(true);
    }
    expect(TAGLISH_GROUNDING_RE.test("sira ang preno")).toBe(true);
  });
});
