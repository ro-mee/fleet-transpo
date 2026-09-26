import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { query } from "@/lib/db";
import {
  listVehicleProblems,
  countProblemCounts,
  driverReport,
  severityLabel,
  bucketFor,
} from "./problem-queue";

// Refuse-by-default, matching the fake in maintenance.test.js: a stub that
// answered anything unmatched would let every test here pass without ever
// exercising the statement under test.
function stubQuery(handlers) {
  query.mockImplementation(async (sql, params) => {
    for (const [match, reply] of handlers) {
      if (String(sql).includes(match)) return typeof reply === "function" ? reply(sql, params) : reply;
    }
    throw new Error(`unexpected SQL: ${String(sql).replace(/\s+/g, " ").slice(0, 80)}`);
  });
}

const row = (over = {}) => ({
  inspection_id: 42,
  vehicle_id: 7,
  inspection_type: "Post-Shift",
  inspection_date: "2026-09-23",
  status: "Reported",
  severity: null,
  checklist: null,
  findings: "sira ang preno",
  driver_id: 3,
  plate_number: "ABC 1234",
  vehicle_name: "HiAce",
  first_name: "Juan",
  last_name: "Dela Cruz",
  maintenance_id: null,
  work_order_status: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("severityLabel", () => {
  it("names an ungraded report instead of leaving it blank", () => {
    expect(severityLabel(null)).toBe("Not assessed");
    expect(severityLabel("")).toBe("Not assessed");
    expect(severityLabel("   ")).toBe("Not assessed");
  });

  it("passes a real grade through, including the driver's own 'None'", () => {
    expect(severityLabel("High")).toBe("High");
    // 'None' is the driver asserting they found nothing — NOT the same value as
    // NULL, and collapsing the two is the bug this function exists to prevent.
    expect(severityLabel("None")).toBe("None");
  });
});

describe("driverReport", () => {
  it("returns the failing items from checklist, with the driver's own remarks", () => {
    const report = driverReport(row({
      inspection_type: "Pre-Shift",
      status: "Failed",
      checklist: [
        { item_id: "cabin", label: "Cabin", status: "PASS", remarks: "" },
        { item_id: "brakes", label: "Brakes", status: "FAIL", remarks: "malambot ang preno" },
        { item_id: "tires", label: "Tires", status: "FAIL", remarks: "  kupas ang gulong  " },
      ],
    }));
    expect(report.kind).toBe("checklist");
    expect(report.items).toEqual([
      { label: "Brakes", remarks: "malambot ang preno" },
      { label: "Tires", remarks: "kupas ang gulong" },
    ]);
  });

  it("falls back to item_id when a stored item carries no label", () => {
    const report = driverReport(row({
      inspection_type: "Pre-Trip",
      status: "Failed",
      checklist: [{ item_id: "dashboard", status: "FAIL", remarks: "warning light" }],
    }));
    expect(report.items).toEqual([{ label: "dashboard", remarks: "warning light" }]);
  });

  it("does not fall over on a checklist that is null or not an array", () => {
    expect(driverReport(row({ inspection_type: "Pre-Shift", checklist: null })).items).toEqual([]);
    expect(driverReport(row({ inspection_type: "Pre-Shift", checklist: "oops" })).items).toEqual([]);
  });

  it("returns free text for Post-Shift, whose checklist is always NULL", () => {
    const report = driverReport(row({ findings: "  maingay ang aircon  " }));
    expect(report).toEqual({ kind: "free_text", text: "maingay ang aircon" });
  });
});

describe("bucketFor", () => {
  it("calls a reported defect with no work order reported_untracked", () => {
    expect(bucketFor(row({ status: "Reported", maintenance_id: null }))).toBe("reported_untracked");
  });

  it("calls a reported defect with a work order tracked", () => {
    expect(bucketFor(row({ status: "Reported", maintenance_id: 99 }))).toBe("tracked");
  });

  it("calls a failed checklist inspection failed_untracked — closable, but raised by hand", () => {
    expect(bucketFor(row({ inspection_type: "Pre-Shift", status: "Failed", maintenance_id: null }))).toBe("failed_untracked");
  });

  it("calls a failed checklist inspection with a work order tracked too", () => {
    expect(bucketFor(row({ inspection_type: "Pre-Trip", status: "Failed", maintenance_id: 99 }))).toBe("tracked");
  });
});

describe("listVehicleProblems", () => {
  it("maps a row into the shape the page renders", async () => {
    stubQuery([["FROM vehicleinspection i", { rows: [row()] }]]);
    const { items } = await listVehicleProblems();
    expect(items).toEqual([
      {
        inspectionId: 42,
        vehicleId: 7,
        plateNumber: "ABC 1234",
        vehicleName: "HiAce",
        driverName: "Juan Dela Cruz",
        inspectionType: "Post-Shift",
        inspectionDate: "2026-09-23",
        status: "Reported",
        severity: null,
        severityLabel: "Not assessed",
        report: { kind: "free_text", text: "sira ang preno" },
        workOrderId: null,
        workOrderStatus: null,
        bucket: "reported_untracked",
      },
    ]);
  });

  it("survives an inspection with no driver — driver_id is nullable", async () => {
    stubQuery([["FROM vehicleinspection i", {
      rows: [row({ driver_id: null, first_name: null, last_name: null })],
    }]]);
    const { items } = await listVehicleProblems();
    expect(items[0].driverName).toBeNull();
  });

  it("tallies each bucket over the page it returned", async () => {
    stubQuery([["FROM vehicleinspection i", {
      rows: [
        row({ inspection_id: 1, status: "Reported", maintenance_id: null }),
        row({ inspection_id: 2, status: "Reported", maintenance_id: 99, work_order_status: "In Progress" }),
        row({ inspection_id: 3, inspection_type: "Pre-Trip", status: "Failed", checklist: [] }),
      ],
    }]]);
    const { counts } = await listVehicleProblems();
    expect(counts).toEqual({ reportedUntracked: 1, failedUntracked: 1, tracked: 1 });
  });

  it("passes the page window through as bound parameters", async () => {
    stubQuery([["FROM vehicleinspection i", { rows: [] }]]);
    await listVehicleProblems({ limit: 25, offset: 50 });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("LIMIT $1 OFFSET $2"), [25, 50]);
  });

  // An archived work order (vehiclemaintenance.deleted_at) must NOT count as
  // tracked. archiveVehicleMaintenance soft-deletes by PUT, every read in
  // vehicle-maintenance/[id] filters deleted_at IS NULL, and the sibling
  // check on incidents (incidents/route.js:92) joins with the same predicate.
  // A queue that counted an archived ticket would show a driver-reported fault
  // as resolved when nothing is tracking it — the exact inversion this page
  // exists to prevent. The DB is mocked here, so the predicate IS the
  // behaviour under test: it is the only thing that can be asserted.
  it("ignores an archived work order, so the defect stays untracked", async () => {
    stubQuery([["FROM vehicleinspection i", { rows: [row()] }]]);
    await listVehicleProblems();
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(
      /LEFT JOIN vehiclemaintenance wo\s+ON wo\.source_inspection_id = i\.inspection_id\s+AND wo\.deleted_at IS NULL/
    );
  });
});

describe("countProblemCounts", () => {
  it("returns the aggregate row, not a page-scoped tally", async () => {
    stubQuery([["COUNT(*)", { rows: [{ reported_untracked: 4, failed_untracked: 9, tracked: 11 }] }]]);
    await expect(countProblemCounts()).resolves.toEqual({ reportedUntracked: 4, failedUntracked: 9, tracked: 11 });
  });

  it("reads as all-zero rather than undefined when the aggregate returns nothing", async () => {
    stubQuery([["COUNT(*)", { rows: [] }]]);
    await expect(countProblemCounts()).resolves.toEqual({ reportedUntracked: 0, failedUntracked: 0, tracked: 0 });
  });

  // The strip's count is the number a manager acts on, so it has to agree with
  // the list above it: the same archived-work-order rule, in COUNT_SQL.
  it("applies the same archived-work-order rule as the list", async () => {
    stubQuery([["COUNT(*)", { rows: [{ reported_untracked: 0, failed_untracked: 0, tracked: 0 }] }]]);
    await countProblemCounts();
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(
      /LEFT JOIN vehiclemaintenance wo\s+ON wo\.source_inspection_id = i\.inspection_id\s+AND wo\.deleted_at IS NULL/
    );
  });
});
