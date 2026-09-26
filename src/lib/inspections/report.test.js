import { describe, it, expect } from "vitest";
import { toCalendarDay } from "@/lib/dates";
import { buildInspectionMaintenancePayload, buildChecklistMaintenancePayload } from "./report";

const base = {
  inspectionId: 42,
  vehicleId: 7,
  plateNumber: "ABC 1234",
  findings: "may kalansing sa preno",
  grounded: true,
};

describe("buildInspectionMaintenancePayload", () => {
  it("grounds the vehicle when the report matched a severe keyword", () => {
    const p = buildInspectionMaintenancePayload(base);
    // "In Progress" is what removes the vehicle from /api/vehicles/available.
    expect(p.status).toBe("In Progress");
    expect(p.priority).toBe("High");
    expect(p.remarks).toMatch(/Grounded automatically/);
  });

  it("files a scheduled order when it did not, leaving the vehicle dispatchable", () => {
    const p = buildInspectionMaintenancePayload({ ...base, grounded: false });
    expect(p.status).toBe("Scheduled");
    expect(p.priority).toBe("Normal");
    expect(p.remarks).toMatch(/Filed for triage/);
  });

  it("records the driver's words unedited, and trims only the edges", () => {
    const p = buildInspectionMaintenancePayload({ ...base, findings: "  may usok sa makina  " });
    // The text is the evidence; it is not paraphrased into a diagnosis.
    expect(p.description).toContain("may usok sa makina");
    expect(p.description).not.toContain("  may usok");
  });

  it("identifies the source inspection and the vehicle, with a plate when known", () => {
    expect(buildInspectionMaintenancePayload(base).description)
      .toContain("inspection #42, vehicle #7 / ABC 1234");
    expect(buildInspectionMaintenancePayload({ ...base, plateNumber: null }).description)
      .toContain("inspection #42, vehicle #7)");
  });

  it("dates the order today, by local calendar day", () => {
    // toCalendarDay, not toISOString: a local midnight read back in UTC shifts
    // the day backward at UTC+8 (see lib/dates.js).
    expect(buildInspectionMaintenancePayload(base).maintenance_date)
      .toBe(toCalendarDay(new Date()));
  });

  it("never invents a cost — the register records it after the work", () => {
    expect(buildInspectionMaintenancePayload(base).cost).toBe(0);
  });

  it("is a repair, not an emergency", () => {
    expect(buildInspectionMaintenancePayload(base).maintenance_type).toBe("Repair");
  });
});

describe("buildChecklistMaintenancePayload", () => {
  const failedItems = [
    { label: "Brakes", remarks: "malambot ang preno" },
    { label: "Tires", remarks: "kupas ang gulong" },
  ];
  const base = {
    inspectionId: 42,
    vehicleId: 7,
    plateNumber: "ABC 1234",
    inspectionType: "Pre-Shift",
    severity: "High",
    failedItems,
  };

  it("never grounds — Scheduled/Normal even at High severity", () => {
    const payload = buildChecklistMaintenancePayload(base);
    expect(payload.status).toBe("Scheduled");
    expect(payload.priority).toBe("Normal");
  });

  it("names the inspection type and every failed item with the driver's remark", () => {
    const payload = buildChecklistMaintenancePayload(base);
    expect(payload.description).toContain("Pre-Shift");
    expect(payload.description).toContain("Brakes: malambot ang preno");
    expect(payload.description).toContain("Tires: kupas ang gulong");
  });

  it("does not claim an End Duty report — nobody ended a shift", () => {
    const payload = buildChecklistMaintenancePayload(base);
    expect(payload.description).not.toContain("end of shift");
    expect(payload.remarks).not.toContain("End Duty");
  });

  it("states the severity and that no automatic grounding applied", () => {
    const payload = buildChecklistMaintenancePayload(base);
    expect(payload.remarks).toContain("High");
    expect(payload.remarks).toMatch(/raised by the office/i);
  });

  it("names an ungraded severity rather than leaving it blank", () => {
    // The same NULL-vs-'None' distinction the queue renders: a checklist
    // failure always carries a computed severity, so NULL here means the row
    // was written outside the inspections route.
    const payload = buildChecklistMaintenancePayload({ ...base, severity: null });
    expect(payload.remarks).toContain("Not assessed");
  });

  it("still describes the work when a failed item has no remark", () => {
    const payload = buildChecklistMaintenancePayload({
      ...base,
      failedItems: [{ label: "Brakes", remarks: "" }],
    });
    expect(payload.description).toContain("Brakes");
  });

  it("files at zero cost, dated tomorrow so a Scheduled row does not ground the vehicle", () => {
    const payload = buildChecklistMaintenancePayload(base);
    expect(payload.cost).toBe(0);

    const now = new Date();
    const tomorrow = toCalendarDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    expect(payload.maintenance_date).toBe(tomorrow);

    // The load-bearing half of the assertion. /api/vehicles/available excludes
    // `Scheduled AND maintenance_date <= CURRENT_DATE`, so dating this today
    // would hide the vehicle while the payload's own remark claims it stays
    // dispatchable. Strictly-after-today is what makes that remark true.
    const today = toCalendarDay(new Date());
    expect(payload.maintenance_date > today).toBe(true);
  });
});
