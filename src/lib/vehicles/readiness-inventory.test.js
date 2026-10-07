import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { summarizeFleetInventory } from "@/lib/vehicles/readiness-inventory";

const NOW = new Date("2026-10-07T08:00:00+08:00");

function verifiedDoc(type, expiry) {
  return {
    document_type: type,
    verification_status: "Verified",
    verified_by: 3,
    verified_at: "2026-10-01T09:00:00+08:00",
    expiry_date: expiry,
    deleted_at: null,
  };
}

function vehicle(overrides = {}) {
  return {
    vehicle_id: 1,
    plate_number: "ABC 1234",
    fleet_asset_code: "FLT-001",
    operational_use: "Passenger",
    seating_capacity: 7,
    cargo_capacity_kg: null,
    commissioning_status: "Ready",
    required_license_class: "B",
    category_id: 1,
    ...overrides,
  };
}

function row(overrides = {}, docs = [verifiedDoc("OR_CR", "2027-10-01"), verifiedDoc("Insurance", "2027-06-01")]) {
  return { vehicle: vehicle(overrides), documents: docs };
}

describe("summarizeFleetInventory", () => {
  it("places a fully-evidenced passenger vehicle in the passenger cohort", () => {
    const report = summarizeFleetInventory({ rows: [row()], assignments: [{ vehicle_id: 1, driver_id: 7, assigned_until: null }], now: NOW });
    expect(report.totals.vehicles).toBe(1);
    expect(report.passengerCohort).toEqual([1]);
    expect(report.cargoCohort).toEqual([]);
    expect(report.missing.plate).toEqual([]);
  });

  it("places a fully-evidenced cargo vehicle in the cargo cohort", () => {
    const report = summarizeFleetInventory({
      rows: [row({ vehicle_id: 2, operational_use: "Cargo", seating_capacity: null, cargo_capacity_kg: 1000, fleet_asset_code: "FLT-002" })],
      assignments: [{ vehicle_id: 2, driver_id: 8, assigned_until: null }],
      now: NOW,
    });
    expect(report.cargoCohort).toEqual([2]);
    expect(report.passengerCohort).toEqual([]);
  });

  it("enumerates every missing-evidence class by vehicle id", () => {
    const report = summarizeFleetInventory({
      rows: [
        row({ vehicle_id: 1 }, []),
        row({ vehicle_id: 2, plate_number: "  ", fleet_asset_code: null, operational_use: null, commissioning_status: "Pending", required_license_class: null, category_id: null }),
        row({ vehicle_id: 3, operational_use: "Cargo", seating_capacity: null, cargo_capacity_kg: null, fleet_asset_code: "FLT-003" }),
      ],
      assignments: [],
      now: NOW,
    });
    expect(report.missing.plate).toContain(2);
    expect(report.missing.assetCode).toContain(2);
    expect(report.missing.operationalUse).toContain(2);
    expect(report.missing.commissioning).toContain(2);
    expect(report.missing.licenseClass).toContain(2);
    expect(report.missing.category).toContain(2);
    expect(report.missing.orCr).toContain(1);
    expect(report.missing.insurance).toContain(1);
    expect(report.missing.payload).toContain(3);
    // No active pairing rows at all: every vehicle lacks pair coverage.
    expect(report.missing.pairing).toEqual([1, 2, 3]);
    expect(report.passengerCohort).toEqual([]);
    expect(report.cargoCohort).toEqual([]);
  });

  it("counts blocked reasons and defers live maintenance/safety gates transparently", () => {
    const report = summarizeFleetInventory({
      rows: [row({ vehicle_id: 1 }, []), row({ vehicle_id: 2, plate_number: null })],
      assignments: [],
      now: NOW,
    });
    expect(report.blockedReasons.OR_CR_NOT_VERIFIED).toBe(1);
    expect(report.blockedReasons.PLATE_MISSING).toBe(1);
    expect(report.liveGatesDeferred).toEqual(["MAINTENANCE_NOT_CLEARED", "SAFETY_NOT_CLEARED"]);
    // Static inventory never claims a live gate is clear.
    expect(Object.keys(report.blockedReasons)).not.toContain("MAINTENANCE_NOT_CLEARED");
  });

  it("never mutates its inputs and leaves completed history alone", () => {
    const rows = [row({ vehicle_id: 1 }), row({ vehicle_id: 9 })];
    const frozen = structuredClone(rows);
    Object.freeze(rows);
    rows.forEach((r) => { Object.freeze(r); Object.freeze(r.vehicle); Object.freeze(r.documents); });
    const report = summarizeFleetInventory({ rows, assignments: [], now: NOW });
    expect(report.legacyCompletedUntouched).toBe(true);
    expect(rows).toEqual(frozen);
  });

  it("a retired assignment is not pair coverage", () => {
    const report = summarizeFleetInventory({
      rows: [row()],
      assignments: [{ vehicle_id: 1, driver_id: 7, assigned_until: "2026-01-01T00:00:00Z" }],
      now: NOW,
    });
    expect(report.missing.pairing).toEqual([1]);
  });

  it.each([['fleet_asset_code', 'ASSET_CODE_MISSING'], ['required_license_class', 'LICENSE_CLASS_MISSING'], ['category_id', 'CATEGORY_MISSING']])('excludes a vehicle with missing %s even when documents and pairing pass', (field, code) => {
    const report = summarizeFleetInventory({ rows: [row({ [field]: null })], assignments: [{ vehicle_id: 1, driver_id: 7 }], now: NOW });
    expect(report.passengerCohort).toEqual([]);
    expect(report.blockedReasons[code]).toBe(1);
  });

  it('does not enroll an unsupported license class or non-finite capacity',()=>{
    const report=summarizeFleetInventory({rows:[row({required_license_class:'C'}),row({vehicle_id:2,operational_use:'Cargo',cargo_capacity_kg:Infinity})],assignments:[{vehicle_id:1,driver_id:7},{vehicle_id:2,driver_id:8}],now:NOW});
    expect(report.passengerCohort).toEqual([]);
    expect(report.cargoCohort).toEqual([]);
    expect(report.blockedReasons.LICENSE_CLASS_UNSUPPORTED).toBe(1);
    expect(report.blockedReasons.CAPACITY_MISSING).toBe(1);
  });

  it("audit script stays read-only: no write statement may ever appear in it", () => {
    const scriptPath = fileURLToPath(new URL("../../../scripts/audit-fleet-readiness.mjs", import.meta.url));
    expect(existsSync(scriptPath)).toBe(true);
    const source = readFileSync(scriptPath, "utf8");
    for (const verb of ["INSERT INTO", "UPDATE ", "DELETE FROM", "TRUNCATE", "ALTER TABLE", "DROP TABLE", "CREATE TABLE", "CREATE INDEX", "CREATE UNIQUE INDEX"]) {
      expect(source.toUpperCase()).not.toContain(verb);
    }
    // Version-tolerant reads: SELECT * so the audit runs before and after 153.
    expect(source).toMatch(/SELECT \* FROM vehicles/);
    expect(source).toMatch(/SELECT \* FROM vehicledocuments/);
  });
});
