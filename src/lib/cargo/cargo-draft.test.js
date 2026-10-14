import { describe, expect, it } from "vitest";
import { normalizeInboundEnvelope } from "@/lib/integration/source-contract";
import { blankCargoDraftLine, buildPassengerSimulationEnvelope, candidateCapacityLabel, cargoWeightLabel, validateCargoDraft } from "./cargo-draft";

const line = (overrides = {}) => ({ ...blankCargoDraftLine("oil"), name: "Cooking oil", expected_quantity: "100", unit: "bottle", transport_package_count: "10", gross_weight_kg_per_package: "6.525", length_m: "0.5001", width_m: "0.5", height_m: "0.2", package_can_rotate: false, temperature_mode: "NONE", ...overrides });

describe("cargo draft validation", () => {
  it("calculates gross kg from transport packages, preserving ordered units", () => {
    const result = validateCargoDraft({ description: "Kitchen supplies", declaredWeight: "65.250", lines: [line()] });
    expect(result).toEqual({ errors: {}, calculatedKg: "65.25", valid: true });
  });
  it("reconciles exact mass instead of silently replacing the declaration", () => {
    const result = validateCargoDraft({ description: "Oil", declaredWeight: "65.249", lines: [line()] });
    expect(result.errors.declaredWeight).toContain("65.25 kg");
    expect(result.valid).toBe(false);
  });
  it("rejects incomplete temperature, invalid dimensions and package expectation mismatch", () => {
    const result = validateCargoDraft({ description: "Oil", declaredWeight: "65.25", lines: [line({ quantity_basis: "TRANSPORT_PACKAGE", length_m: "0", temperature_mode: "UNKNOWN" })] });
    expect(result.errors).toHaveProperty("line.0.expected_quantity");
    expect(result.errors).toHaveProperty("line.0.length_m");
    expect(result.errors).toHaveProperty("line.0.temperature_mode");
  });
  it.each(["NaN", "Infinity", "-1", "0", "6.5251"])("rejects invalid package mass %s", weight => {
    expect(validateCargoDraft({ description: "Oil", declaredWeight: "65.25", lines: [line({ gross_weight_kg_per_package: weight })] }).calculatedKg).toBeNull();
  });
});

describe("staff simulation boundary", () => {
  const form = { external_booking_id: "demo-1", service_code: "GUEST_TRANSPORT", pickup_location: "Hotel", dropoff_location: "Airport", pickup_datetime: "2026-10-13T10:00:00+08:00", priority: "Normal", passenger_count: 2, source_system: "SCM", cargo_description: "Hidden cargo", cargo_weight_kg: 9000, cargo_lines: [line()] };
  it("submits the canonical passenger request with PMS authority and no hidden cargo", () => {
    const envelope = buildPassengerSimulationEnvelope(form);
    expect(envelope.request).toMatchObject({ source_system: "PMS", load_type: "Passenger", passenger_count: 2 });
    expect(envelope.request).not.toHaveProperty("cargo_description");
    expect(envelope.request).not.toHaveProperty("cargo_weight_kg");
    expect(envelope.request).not.toHaveProperty("cargo_lines");
    expect(normalizeInboundEnvelope(envelope, "PMS").request.service_code).toBe("GUEST_TRANSPORT");
  });
  it("refuses to turn a Cargo draft into a weight-only request", () => {
    expect(() => buildPassengerSimulationEnvelope({ ...form, service_code: "HOTEL_SUPPLY_TRANSFER" })).toThrow(/no request was sent/);
  });
});

it("labels cargo quantities without fabricated seats or zero weight", () => {
  expect(cargoWeightLabel(null)).toBe("Cargo weight not recorded");
  expect(candidateCapacityLabel({ vehicle: { operational_use: "Cargo", seating_capacity: 7, cargo_capacity_kg: 1000 } })).toBe("1000 kg recorded payload");
  expect(candidateCapacityLabel({ vehicle: { seating_capacity: 7 }, cargoPhysical: { usable_payload_kg: "800" } })).toBe("800 kg usable payload");
  expect(candidateCapacityLabel({ vehicle: { seating_capacity: 7 } })).toBe("7 seats");
});
