import { describe, it, expect } from "vitest";
import {
  INCIDENT_STATUSES,
  normalizeIncidentStatus,
  normalizeIncidentType,
  incidentTypeLabel,
  canTransition,
  resolutionActionsError,
  shouldKeepVehicleGrounded,
  buildEmergencyMaintenancePayload,
  buildIncidentMaintenancePayload,
} from "@/lib/incidents/resolution";

describe("normalizeIncidentStatus", () => {
  it("maps canonical values through unchanged", () => {
    expect(normalizeIncidentStatus("Open")).toBe("Open");
    expect(normalizeIncidentStatus("Resolved")).toBe("Resolved");
  });

  it("is case-insensitive and trims", () => {
    expect(normalizeIncidentStatus(" open ")).toBe("Open");
    expect(normalizeIncidentStatus("RESOLVED")).toBe("Resolved");
  });

  it("maps the legacy Pending spelling onto Open", () => {
    expect(normalizeIncidentStatus("Pending")).toBe("Open");
  });

  it("returns null for anything outside the vocabulary", () => {
    expect(normalizeIncidentStatus("Closed")).toBeNull();
    expect(normalizeIncidentStatus("")).toBeNull();
    expect(normalizeIncidentStatus(undefined)).toBeNull();
    expect(normalizeIncidentStatus(42)).toBeNull();
  });
});

describe("incident type normalization", () => {
  it("groups mechanical wording without rewriting unknown legacy types", () => {
    expect(normalizeIncidentType("engine failure")).toBe("breakdown");
    expect(normalizeIncidentType("near-miss")).toBe("near_miss");
    expect(normalizeIncidentType("Passenger delay")).toBe("Passenger delay");
    expect(incidentTypeLabel("accident")).toBe("Traffic Accident");
  });
});

describe("canTransition", () => {
  it("allows resolving an open incident", () => {
    expect(canTransition("Open", "Resolved").ok).toBe(true);
  });

  it("rejects reopening a resolved incident without a dedicated action", () => {
    expect(canTransition("Resolved", "Open")).toMatchObject({ ok: false, reason: "conflict" });
  });

  it("allows an idempotent no-op on an open incident", () => {
    expect(canTransition("Open", "Open").ok).toBe(true);
  });

  it("rejects re-resolving an already-resolved incident", () => {
    const result = canTransition("Resolved", "Resolved");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("conflict");
  });

  it("covers the whole vocabulary pairwise without throwing", () => {
    for (const from of INCIDENT_STATUSES) {
      for (const to of INCIDENT_STATUSES) {
        expect(typeof canTransition(from, to).ok).toBe("boolean");
      }
    }
  });
});

describe("resolutionActionsError", () => {
  it("requires a non-empty narrative", () => {
    expect(resolutionActionsError(undefined)).toMatch(/required/i);
    expect(resolutionActionsError("   ")).toMatch(/required/i);
    expect(resolutionActionsError(null)).toMatch(/required/i);
  });

  it("accepts real documentation", () => {
    expect(resolutionActionsError("Tow truck dispatched; driver safe.")).toBeNull();
  });
});

describe("shouldKeepVehicleGrounded", () => {
  it("holds a maintenance-required vehicle until its work order completes", () => {
    expect(shouldKeepVehicleGrounded({ status: "Resolved", requiresVehicleMaintenance: true, maintenanceStatus: "In Progress" })).toBe(true);
    expect(shouldKeepVehicleGrounded({ status: "Resolved", requiresVehicleMaintenance: true, maintenanceStatus: null })).toBe(true);
    expect(shouldKeepVehicleGrounded({ status: "Resolved", requiresVehicleMaintenance: true, maintenanceStatus: "Completed" })).toBe(false);
    expect(shouldKeepVehicleGrounded({ status: "Resolved", requiresVehicleMaintenance: false, maintenanceStatus: "In Progress" })).toBe(false);
  });
});

describe("buildEmergencyMaintenancePayload", () => {
  it("builds an in-progress emergency repair tagged with the incident", () => {
    const payload = buildEmergencyMaintenancePayload({
      incident_id: 7,
      description: "Engine overheated",
      expense_amount: "1500",
      incident_type: "breakdown",
    });
    expect(payload.maintenance_type).toBe("Emergency Repair");
    expect(payload.status).toBe("In Progress");
    expect(payload.priority).toBe("High");
    expect(payload.description).toContain("Incident #7");
    expect(payload.remarks).toContain("breakdown");
    expect(payload.maintenance_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("books cost at zero and carries the driver claim in remarks for review", () => {
    const payload = buildEmergencyMaintenancePayload({
      incident_id: 1,
      expense_amount: "1500",
    });
    // The claim must never silently become booked cost.
    expect(payload.cost).toBe(0);
    expect(payload.remarks).toContain("expense claim: ₱1,500");
    expect(payload.remarks).toContain("unverified");
  });

  it("omits the claim note when there is no valid expense", () => {
    const empty = buildEmergencyMaintenancePayload({ incident_id: 2 });
    const junk = buildEmergencyMaintenancePayload({ incident_id: 3, expense_amount: "abc" });
    expect(empty.cost).toBe(0);
    expect(empty.remarks).not.toContain("claim");
    expect(junk.cost).toBe(0);
    expect(junk.remarks).not.toContain("claim");
  });

});

describe("buildIncidentMaintenancePayload", () => {
  it("uses an inspection work order for an accident", () => {
    const payload = buildIncidentMaintenancePayload({
      incident_id: 9,
      incident_type: "accident",
      description: "Bumper damaged after impact",
    });
    expect(payload.maintenance_type).toBe("Vehicle Inspection");
    expect(payload.description).toContain("Safety inspection");
    expect(payload.status).toBe("In Progress");
  });

  it("keeps breakdowns as emergency repairs", () => {
    expect(buildIncidentMaintenancePayload({ incident_id: 10, incident_type: "breakdown" }).maintenance_type)
      .toBe("Emergency Repair");
  });
});
