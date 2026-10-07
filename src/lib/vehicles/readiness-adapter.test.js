import { describe, expect, it } from "vitest";
import { assessVehicleReadiness, buildReadinessInput } from "@/lib/vehicles/readiness-adapter";

const NOW = new Date("2026-10-07T08:00:00+08:00");

function vehicleRow(overrides = {}) {
  return {
    vehicle_id: 7,
    plate_number: "ABC 1234",
    fleet_asset_code: "FLT-007",
    operational_use: "Cargo",
    cargo_capacity_kg: "1000.000",
    commissioning_status: "Ready",
    ...overrides,
  };
}

function documentRows() {
  return [
    {
      document_id: 1,
      document_type: "OR_CR",
      verification_status: "Verified",
      verified_by: 3,
      verified_at: "2026-10-01T09:00:00+08:00",
      expiry_date: "2027-10-01",
      deleted_at: null,
    },
    {
      document_id: 2,
      document_type: "Insurance",
      verification_status: "Verified",
      verified_by: 3,
      verified_at: "2026-10-01T09:00:00+08:00",
      expiry_date: "2027-06-01",
      deleted_at: null,
    },
  ];
}

describe("readiness adapter", () => {
  it("reports ready for a commissioned vehicle with verified documents and clear signals", () => {
    const r = assessVehicleReadiness({
      vehicleRow: vehicleRow(),
      documentRows: documentRows(),
      maintenanceClear: true,
      safetyClear: true,
      now: NOW,
    });
    expect(r.ready).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it("fails closed on pre-migration rows that lack capability columns", () => {
    // A live row read before migration 153 applies has none of the new
    // columns: the adapter must block, never invent Ready or verified data.
    const r = assessVehicleReadiness({
      vehicleRow: { vehicle_id: 7, plate_number: "ABC 1234" },
      documentRows: [{ document_type: "OR_CR", expiry_date: "2027-10-01", deleted_at: null }],
      maintenanceClear: true,
      safetyClear: true,
      now: NOW,
    });
    expect(r.ready).toBe(false);
    expect(r.blockers).toContain("COMMISSIONING_NOT_READY");
    expect(r.blockers).toContain("OR_CR_NOT_VERIFIED");
    expect(r.blockers).toContain("INSURANCE_NOT_VERIFIED");
  });

  it("blocks when server maintenance or safety evidence is not clear", () => {
    for (const patch of [{ maintenanceClear: false }, { safetyClear: false }, {}]) {
      const r = assessVehicleReadiness({
        vehicleRow: vehicleRow(),
        documentRows: documentRows(),
        ...patch,
        now: NOW,
      });
      expect(r.ready).toBe(false);
    }
    const r = assessVehicleReadiness({
      vehicleRow: vehicleRow(),
      documentRows: documentRows(),
      maintenanceClear: true,
      safetyClear: true,
      now: NOW,
    });
    expect(r.ready).toBe(true);
  });

  it("never trusts client-supplied clearance flags on the row", () => {
    // Even if a row somehow carries truthy clearance lookalikes, only the
    // explicit server booleans passed by the caller clear the gate.
    const r = assessVehicleReadiness({
      vehicleRow: vehicleRow({ maintenance_clear: true, safety_clear: true }),
      documentRows: documentRows(),
      maintenanceClear: false,
      safetyClear: false,
      now: NOW,
    });
    expect(r.blockers).toContain("MAINTENANCE_NOT_CLEARED");
    expect(r.blockers).toContain("SAFETY_NOT_CLEARED");
  });

  it("builds a DTO that carries no surplus row fields into the contract", () => {
    const { vehicle, documents } = buildReadinessInput({
      vehicleRow: vehicleRow({ vehicle_status: "Available", mileage: 50000 }),
      documentRows: documentRows(),
      maintenanceClear: true,
      safetyClear: true,
    });
    expect(vehicle).toEqual({
      plate_number: "ABC 1234",
      commissioning_status: "Ready",
      maintenance_clear: true,
      safety_clear: true,
    });
    expect(documents).toHaveLength(2);
    expect(documents[0]).toEqual({
      document_type: "OR_CR",
      verification_status: "Verified",
      verified_by: 3,
      verified_at: "2026-10-01T09:00:00+08:00",
      expiry_date: "2027-10-01",
      deleted_at: null,
    });
  });
});
