import { describe, expect, it } from "vitest";
import {
  countApprovedLeaveForDay,
  countOverdueScheduledMaintenance,
  getDashboardDispatchRows,
} from "@/lib/fleet-manager-dashboard";
import { manilaDateKey } from "@/lib/dates";

describe("Fleet Manager dashboard date and schedule summaries", () => {
  it("uses the Manila calendar day for dashboard date scopes", () => {
    expect(manilaDateKey(new Date("2026-10-01T16:00:00.000Z"))).toBe("2026-10-02");
  });

  it("counts approved leave that covers today and ignores historical or pending leave", () => {
    const rows = [
      { leave_request_id: 1, driver_id: 11, status: "Approved", start_date: "2026-10-02", end_date: "2026-10-04" },
      { leave_request_id: 2, driver_id: 12, status: "Approved", start_date: "2026-08-01", end_date: "2026-08-03" },
      { leave_request_id: 5, driver_id: 14, status: "Approved", start_date: "2026-10-03", end_date: "2026-10-04" },
      { leave_request_id: 6, driver_id: 15, status: "Approved", start_date: "2026-10-01", end_date: "2026-10-01" },
      { leave_request_id: 3, driver_id: 13, status: "Pending", start_date: "2026-10-02", end_date: "2026-10-02" },
      { leave_request_id: 4, driver_id: 11, status: "Approved", start_date: "2026-10-02", end_date: "2026-10-02" },
    ];

    expect(countApprovedLeaveForDay(rows, "2026-10-02")).toBe(1);
  });

  it("counts only scheduled maintenance dated before today", () => {
    const rows = [
      { status: "Scheduled", maintenance_date: "2026-10-01" },
      { status: "Scheduled", maintenance_date: "2026-10-02" },
      { status: "Scheduled", maintenance_date: "2026-10-03" },
      { status: "In Progress", maintenance_date: "2026-10-01" },
      { status: "Completed", maintenance_date: "2026-10-01" },
    ];

    expect(countOverdueScheduledMaintenance(rows, "2026-10-02")).toBe(1);
  });

  it("keeps reassignment exceptions visible and lists only future scheduled departures", () => {
    const now = new Date("2026-10-02T13:33:00.000Z");
    const rows = getDashboardDispatchRows({
      pendingReassignment: [{ dispatch_id: 1, scheduled_departure: "2026-09-30T07:00:00.000Z" }],
      scheduled: [
        { dispatch_id: 2, scheduled_departure: "2026-10-02T07:00:00.000Z" },
        { dispatch_id: 3, scheduled_departure: "2026-10-02T15:00:00.000Z" },
        { dispatch_id: 4, scheduled_departure: "invalid" },
        { dispatch_id: 5, scheduled_departure: "2026-10-02T14:00:00.000Z" },
        { dispatch_id: 6, scheduled_departure: now.toISOString() },
      ],
    }, now);

    expect(rows.map((row) => row.dispatch_id)).toEqual([1, 5, 3]);
  });
});
