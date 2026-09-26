import { describe, it, expect } from "vitest";
import { missedReportCopy, lateReportHref, plateLabel } from "./missed-report";

const day = { date: "2026-09-23", vehicleId: 5, plateNumber: "ABC-1234" };

describe("missed report copy", () => {
  it("says nothing when there is nothing to report", () => {
    expect(missedReportCopy(null)).toBeNull();
  });

  it("names the day in the title, so the driver knows which shift is owed", () => {
    expect(missedReportCopy(day).title).toMatch(/September 23/);
  });

  it("does not ask the driver to 'end duty' — the shift is already closed", () => {
    // The duty may already be closed by the sweep. Telling a driver to end a
    // shift that has ended would be false, and the copy is the only thing
    // standing between the two.
    const copy = missedReportCopy(day);
    expect(copy.body).not.toMatch(/end your (shift|duty)/i);
    expect(copy.body).toMatch(/closed/i);
  });

  it("names the vehicle only when the server resolved one", () => {
    expect(missedReportCopy(day).body).toMatch(/ABC-1234/);
    expect(missedReportCopy({ ...day, plateNumber: null }).body).not.toMatch(/ABC-1234/);
  });
});

describe("late report route", () => {
  it("carries the day, because the screen must file against that day and not today", () => {
    expect(lateReportHref("2026-09-23")).toBe("/end-duty?reportFor=2026-09-23");
  });
});

describe("plate label", () => {
  it("shows the plate when there is one, and refuses to invent one when there is not", () => {
    expect(plateLabel("ABC-1234")).toBe("ABC-1234");
    expect(plateLabel(null)).toBe("the vehicle on that day's check");
  });
});
