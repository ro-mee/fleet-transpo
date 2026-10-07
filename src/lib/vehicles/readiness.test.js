import { describe, it, expect } from "vitest";
import { evaluateRoadReadiness } from "@/lib/vehicles/readiness";

// Fixed Manila-morning instant so the expiry-day boundary is deterministic.
const NOW = new Date("2026-10-07T08:00:00+08:00");

function vehicle(overrides = {}) {
  return {
    plate_number: "ABC 1234",
    commissioning_status: "Ready",
    maintenance_clear: true,
    safety_clear: true,
    ...overrides,
  };
}

function doc(overrides = {}) {
  return {
    document_type: "OR_CR",
    verification_status: "Verified",
    verified_by: 1,
    verified_at: "2026-10-01T09:00:00+08:00",
    expiry_date: "2027-10-01",
    deleted_at: null,
    ...overrides,
  };
}

function readyDocs() {
  return [doc(), doc({ document_type: "Insurance" })];
}

describe("evaluateRoadReadiness", () => {
  it("reports ready when plate, commissioning, maintenance, safety and both verified documents are complete", () => {
    const r = evaluateRoadReadiness(vehicle(), readyDocs(), NOW);
    expect(r.ready).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it("blocks a missing or blank plate without synthesizing one", () => {
    for (const plate_number of [null, undefined, "", "   "]) {
      const r = evaluateRoadReadiness(vehicle({ plate_number }), readyDocs(), NOW);
      expect(r.ready).toBe(false);
      expect(r.blockers).toContain("PLATE_MISSING");
    }
  });

  it("blocks commissioning that is not Ready", () => {
    for (const commissioning_status of [null, undefined, "Pending", "Ready ", "READY"]) {
      const r = evaluateRoadReadiness(vehicle({ commissioning_status }), readyDocs(), NOW);
      expect(r.ready).toBe(false);
      expect(r.blockers).toContain("COMMISSIONING_NOT_READY");
    }
  });

  it("requires explicit true maintenance and safety clearance", () => {
    for (const maintenance_clear of [null, undefined, false, "yes", 1]) {
      const r = evaluateRoadReadiness(vehicle({ maintenance_clear }), readyDocs(), NOW);
      expect(r.blockers).toContain("MAINTENANCE_NOT_CLEARED");
    }
    for (const safety_clear of [null, undefined, false, "yes", 1]) {
      const r = evaluateRoadReadiness(vehicle({ safety_clear }), readyDocs(), NOW);
      expect(r.blockers).toContain("SAFETY_NOT_CLEARED");
    }
  });

  it("blocks when no verified document exists for a required type", () => {
    const r = evaluateRoadReadiness(vehicle(), [], NOW);
    expect(r.ready).toBe(false);
    expect(r.blockers).toContain("OR_CR_NOT_VERIFIED");
    expect(r.blockers).toContain("INSURANCE_NOT_VERIFIED");
  });

  it("does not let pending or rejected rows count as verified evidence", () => {
    const docs = [
      doc({ verification_status: "Pending" }),
      doc({ document_type: "Insurance" }),
    ];
    const r = evaluateRoadReadiness(vehicle(), docs, NOW);
    expect(r.blockers).toContain("OR_CR_NOT_VERIFIED");
    expect(r.blockers).not.toContain("INSURANCE_NOT_VERIFIED");
  });

  it("blocks verified evidence without a verifier audit trail", () => {
    for (const patch of [
      { verified_by: null },
      { verified_by: "  " },
      { verified_at: null },
      { verified_at: "not-a-date" },
      { verified_at: "2026-10-08T09:00:00+08:00" },
    ]) {
      const r = evaluateRoadReadiness(vehicle(), [doc(patch), doc({ document_type: "Insurance" })], NOW);
      expect(r.ready).toBe(false);
      expect(r.blockers).toContain("OR_CR_VERIFICATION_AUDIT_MISSING");
    }
  });

  it("treats duplicate verified records as ambiguous instead of picking one", () => {
    const docs = [
      doc(),
      doc({ expiry_date: "2020-01-01" }),
      doc({ document_type: "Insurance" }),
    ];
    const r = evaluateRoadReadiness(vehicle(), docs, NOW);
    expect(r.blockers).toContain("OR_CR_EVIDENCE_AMBIGUOUS");
    expect(r.blockers).not.toContain("REGISTRATION_EXPIRED");
  });

  it("ignores deleted duplicates and pending rows when one verified record stands", () => {
    const docs = [
      doc(),
      doc({ deleted_at: "2026-09-01T00:00:00+08:00" }),
      doc({ document_type: "Insurance", verification_status: "Pending" }),
      doc({ document_type: "Insurance" }),
    ];
    const r = evaluateRoadReadiness(vehicle(), docs, NOW);
    expect(r.ready).toBe(true);
  });

  it("distinguishes missing from malformed registration expiry", () => {
    const missing = evaluateRoadReadiness(
      vehicle(),
      [doc({ expiry_date: null }), doc({ document_type: "Insurance" })],
      NOW
    );
    expect(missing.blockers).toContain("REGISTRATION_EXPIRY_MISSING");
    expect(missing.blockers).not.toContain("REGISTRATION_EXPIRY_INVALID");

    for (const expiry_date of ["10/01/2027", "2026-02-30", "2026-13-01", "not-a-date", 20271001]) {
      const r = evaluateRoadReadiness(
        vehicle(),
        [doc({ expiry_date }), doc({ document_type: "Insurance" })],
        NOW
      );
      expect(r.blockers).toContain("REGISTRATION_EXPIRY_INVALID");
    }
  });

  it("expires the day after the expiry date in Manila, not on it", () => {
    // NOW is 2026-10-07 in Manila: that day is still valid, yesterday is not.
    const today = evaluateRoadReadiness(
      vehicle(),
      [doc({ expiry_date: "2026-10-07" }), doc({ document_type: "Insurance" })],
      NOW
    );
    expect(today.blockers).not.toContain("REGISTRATION_EXPIRED");

    const yesterday = evaluateRoadReadiness(
      vehicle(),
      [doc({ expiry_date: "2026-10-06" }), doc({ document_type: "Insurance" })],
      NOW
    );
    expect(yesterday.blockers).toContain("REGISTRATION_EXPIRED");
  });

  it("mirrors expiry semantics for insurance documents", () => {
    const expired = evaluateRoadReadiness(
      vehicle(),
      [doc(), doc({ document_type: "Insurance", expiry_date: "2026-10-06" })],
      NOW
    );
    expect(expired.blockers).toContain("INSURANCE_EXPIRED");

    const missing = evaluateRoadReadiness(
      vehicle(),
      [doc(), doc({ document_type: "Insurance", expiry_date: "" })],
      NOW
    );
    expect(missing.blockers).toContain("INSURANCE_EXPIRY_MISSING");
  });

  it("ignores legacy status flags and vehicle-level expiry columns", () => {
    // Only verified document records supply expiry evidence.
    const r = evaluateRoadReadiness(
      vehicle({ registration_expiry: "2020-01-01", insurance_expiry: "2020-01-01", vehicle_status: "Available" }),
      [doc({ status: "Inactive" }), doc({ document_type: "Insurance", status: "Expired" })],
      NOW
    );
    expect(r.ready).toBe(true);
  });

  it("rejects an invalid reference instant fail-closed", () => {
    for (const now of ["garbage", null, undefined, new Date("not-a-date")]) {
      const r = evaluateRoadReadiness(vehicle(), readyDocs(), now);
      expect(r.ready).toBe(false);
      expect(r.blockers).toEqual(["REFERENCE_TIME_INVALID"]);
    }
  });

  it("emits blocker codes in a deterministic order", () => {
    const r = evaluateRoadReadiness(
      vehicle({ plate_number: " ", commissioning_status: "Pending", maintenance_clear: false, safety_clear: false }),
      [],
      NOW
    );
    expect(r.blockers).toEqual([
      "PLATE_MISSING",
      "COMMISSIONING_NOT_READY",
      "MAINTENANCE_NOT_CLEARED",
      "SAFETY_NOT_CLEARED",
      "OR_CR_NOT_VERIFIED",
      "INSURANCE_NOT_VERIFIED",
    ]);
  });
});
