import { describe, it, expect } from "vitest";
import {
  INCIDENT_STATUSES,
  normalizeIncidentStatus,
  canTransition,
  resolutionActionsError,
  buildEmergencyMaintenancePayload,
  MAINTENANCE_ACTIONS_TAKEN,
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

describe("canTransition", () => {
  it("allows resolving an open incident", () => {
    expect(canTransition("Open", "Resolved").ok).toBe(true);
  });

  it("allows reopening a resolved incident", () => {
    expect(canTransition("Resolved", "Open").ok).toBe(true);
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
    expect(payload.cost).toBe(1500);
    expect(payload.maintenance_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("defaults missing or invalid expense to zero cost", () => {
    expect(buildEmergencyMaintenancePayload({ incident_id: 1 }).cost).toBe(0);
    expect(
      buildEmergencyMaintenancePayload({ incident_id: 1, expense_amount: "-5" }).cost
    ).toBe(0);
    expect(
      buildEmergencyMaintenancePayload({ incident_id: 1, expense_amount: "abc" }).cost
    ).toBe(0);
  });

  it("exposes the fixed audit text used by the endpoint", () => {
    expect(MAINTENANCE_ACTIONS_TAKEN).toContain("vehicle maintenance");
  });
});
