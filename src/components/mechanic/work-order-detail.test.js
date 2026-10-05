import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { leanRow } from "./test-fixtures";

vi.mock("next/link", () => ({ default: ({ children }) => children }));

vi.stubGlobal("React", React);
const { WorkOrderDetail } = await import("./work-order-detail");
const {
  MECHANIC_WRITABLE_FIELDS,
  buildMechanicUpdateBody,
  serializeParts,
  validateDiagnosis,
  DIAGNOSIS_MAX_LENGTH,
  DESKTOP_ONLY_TITLE,
} = await import("./mechanic-actions");

beforeEach(() => {
  vi.stubGlobal("React", React);
});
afterEach(() => vi.unstubAllGlobals());

function render(props) {
  return renderToStaticMarkup(React.createElement(WorkOrderDetail, props));
}

describe("work-order-detail evidence contract", () => {
  it("submit body keys are a subset of the mechanic whitelist", () => {
    const body = buildMechanicUpdateBody({
      status: "Pending Inspection",
      diagnosis: "Pads replaced.",
      parts: [{ name: "Brake pad set", qty: 1 }],
      laborHours: 2,
      // Forbidden smugglers — must be stripped, never sent.
      cost: 4500,
      vehicle_id: 12,
      priority: "High",
      next_schedule_date: "2026-11-01",
      next_schedule_mileage: 90000,
      deleted_at: "2026-10-06T00:00:00Z",
      assigned_mechanic_id: 77,
      assigned_at: "2026-10-05T00:00:00Z",
    });
    expect(Object.keys(body).length).toBeGreaterThan(0);
    for (const key of Object.keys(body)) {
      expect(MECHANIC_WRITABLE_FIELDS).toContain(key);
    }
    expect(body.status).toBe("Pending Inspection");
    expect(Array.isArray(body.parts_replaced)).toBe(true);
  });

  it("parts editor serializes rows of {name, qty} to a JSON array", () => {
    expect(
      serializeParts([
        { name: "Brake pad set", qty: 1 },
        { name: "  ", qty: 2 },
        { name: "Rotor", qty: 0 },
      ])
    ).toEqual([{ name: "Brake pad set", qty: 1 }]);
  });

  it("diagnosis over 2000 chars shows an inline error and blocks submit", () => {
    expect(DIAGNOSIS_MAX_LENGTH).toBe(2000);
    const long = "x".repeat(2001);
    expect(validateDiagnosis(long)).toMatch(/2000/);
    expect(validateDiagnosis("ok")).toBeNull();
    const html = render({ workOrder: leanRow(), desktop: true, initialDiagnosis: long });
    expect(html).toMatch(/2000/);
    // The evidence save is blocked: disabled submit present.
    expect(html).toContain("disabled");
  });

  it("cost and assignment inputs are absent from the DOM", () => {
    const html = render({ workOrder: leanRow(), desktop: true });
    expect(html).not.toMatch(/name="cost"/);
    expect(html).not.toMatch(/name="assigned_mechanic_id"/);
    expect(html).not.toMatch(/name="vehicle_id"/);
    expect(html).not.toMatch(/name="priority"/);
    expect(html).not.toContain("Approve");
  });

  it("renders the Assigned → Started → Submitted timeline", () => {
    const html = render({ workOrder: leanRow(), desktop: true });
    expect(html).toContain("Assigned");
    expect(html).toContain("Started");
    expect(html).toContain("Submitted");
  });

  it("small-screen action bar is disabled with the desktop reason", () => {
    const html = render({ workOrder: leanRow(), desktop: false });
    expect(html).toContain("disabled");
    expect(html).toContain(DESKTOP_ONLY_TITLE);
  });
});
