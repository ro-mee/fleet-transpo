import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.stubGlobal("React", React);
const { VehicleHistory } = await import("./vehicle-history");
const { WorkOrderDetail } = await import("./work-order-detail");
const { leanRow } = await import("./test-fixtures");

beforeEach(() => {
  vi.stubGlobal("React", React);
});
afterEach(() => vi.unstubAllGlobals());

function history(overrides = {}) {
  return {
    maintenance: [
      {
        maintenance_id: 7,
        maintenance_type: "Brake Service",
        maintenance_date: "2026-10-01",
        completed_date: "2026-10-02",
        status: "Completed",
        priority: "High",
        diagnosis: "worn pads, rotor scored",
        parts_replaced: [{ name: "Brake pad set", qty: 1 }],
      },
    ],
    incidents: [
      {
        incident_id: 3,
        incident_type: "Brake Failure",
        incident_date: "2026-09-20T08:00:00.000Z",
        severity: "Major",
        status: "Resolved",
      },
    ],
    inspections: [
      {
        inspection_id: 31,
        inspection_type: "Post-Shift",
        inspection_date: "2026-09-25",
        status: "Reported",
        severity: "Minor",
        findings_excerpt: "grinding noise downhill",
      },
    ],
    lastPms: { maintenance_id: 5, maintenance_date: "2026-08-01", completed_date: "2026-08-02", source: "routine-record" },
    ...overrides,
  };
}

describe("vehicle-history read-only sections (P1b)", () => {
  it("renders all three sections plus the last-PMS line from the payload", () => {
    const html = renderToStaticMarkup(React.createElement(VehicleHistory, { history: history() }));
    expect(html).toContain("Previous maintenance");
    expect(html).toContain("Recent incidents");
    expect(html).toContain("Recent inspections");
    expect(html).toContain("Last PMS");
    expect(html).toContain("Brake Service");
    expect(html).toContain("Brake Failure");
    expect(html).toContain("Post-Shift");
    expect(html).toContain("worn pads, rotor scored");
    expect(html).toContain("grinding noise downhill");
  });

  it("carries no cost display and no edit controls", () => {
    const html = renderToStaticMarkup(React.createElement(VehicleHistory, { history: history() }));
    expect(html).not.toMatch(/cost/i);
    expect(html).not.toContain("₱");
    expect(html).not.toMatch(/<input|<textarea|<button|<select/);
  });

  it("states empty sections honestly instead of hiding them", () => {
    const html = renderToStaticMarkup(
      React.createElement(VehicleHistory, { history: history({ maintenance: [], incidents: [], inspections: [], lastPms: null }) })
    );
    expect(html).toContain("No previous maintenance on record.");
    expect(html).toContain("No incidents on record.");
    expect(html).toContain("No inspections on record.");
    expect(html).toContain("No completed routine service on record.");
  });

  it("labels a vehicle-record PMS fallback so it cannot be mistaken for a work order", () => {
    const html = renderToStaticMarkup(
      React.createElement(VehicleHistory, {
        history: history({ lastPms: { maintenance_id: null, maintenance_date: "2026-07-15", completed_date: null, source: "vehicle.last_service_date" } }),
      })
    );
    expect(html).toContain("vehicle record");
  });

  it("degrades to an unavailable note on load failure without throwing", () => {
    const failed = renderToStaticMarkup(React.createElement(VehicleHistory, { history: null, loadError: "Forbidden" }));
    expect(failed).toContain("Vehicle history unavailable.");
    const loading = renderToStaticMarkup(React.createElement(VehicleHistory, { history: null, isLoading: true }));
    expect(loading).toContain("Loading history");
  });

  it("appears inside the work-order detail when history is provided", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkOrderDetail, { workOrder: leanRow(), desktop: true, history: history() })
    );
    expect(html).toContain("Vehicle history");
    expect(html).toContain("Previous maintenance");
  });
});
