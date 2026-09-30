import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildDriverPerformanceWorkbook, buildExecutiveWorkbook } from "./remaining-workbooks";

// Fixture mirrors getDriverPerformanceReport() in operational-reports.js (the
// `totalDrivers / totalCompletedTrips / punctuality / details / trips / methodology`
// payload). Field names are the source's, not a remembered shape.
const DETAIL_ROWS = [
  {
    driver_id: 1,
    name: "Ana Reyes",
    face_image_url: null,
    avatar_url: null,
    driver_status: "Active",
    completed_trips: 10,
    measured_trips: 8,
    on_time_trips: 7,
    late_trips: 1,
    unmeasured_trips: 1,
    override_trips: 1,
    punctuality_rate: 88,
    avg_late_minutes: 12.5,
    max_late_minutes: 20,
  },
  {
    driver_id: 2,
    name: "Ben Cruz",
    face_image_url: null,
    avatar_url: null,
    driver_status: "Active",
    completed_trips: 5,
    measured_trips: 0,
    on_time_trips: 0,
    late_trips: 0,
    unmeasured_trips: 5,
    override_trips: 0,
    punctuality_rate: null,
    avg_late_minutes: null,
    max_late_minutes: null,
  },
];

const TRIP_ROWS = [
  {
    trip_id: 101,
    driver_id: 1,
    driver_name: "Ana Reyes",
    scheduled_pickup: "2026-09-10T08:00:00+08:00",
    at_pickup_at: "2026-09-10T08:09:00+08:00",
    override: false,
    variance_minutes: 9,
    result: "late",
  },
  {
    trip_id: 102,
    driver_id: 1,
    driver_name: "Ana Reyes",
    scheduled_pickup: "2026-09-10T09:00:00+08:00",
    at_pickup_at: "2026-09-10T08:57:00+08:00",
    override: false,
    variance_minutes: -3,
    result: "on_time",
  },
  {
    trip_id: 103,
    driver_id: 1,
    driver_name: "Ana Reyes",
    scheduled_pickup: "2026-09-10T10:00:00+08:00",
    at_pickup_at: null,
    override: false,
    variance_minutes: null,
    result: "unmeasured",
  },
  {
    trip_id: 104,
    driver_id: 2,
    driver_name: "Ben Cruz",
    scheduled_pickup: "2026-09-10T11:00:00+08:00",
    at_pickup_at: "2026-09-10T11:12:36+08:00",
    override: true,
    variance_minutes: 12.6,
    result: "override",
  },
];

function driverPayload(overrides = {}) {
  return {
    totalDrivers: 2,
    totalCompletedTrips: 15,
    punctuality: {
      measuredTrips: 8,
      onTimeTrips: 7,
      lateTrips: 1,
      unmeasuredTrips: 6,
      overrideTrips: 1,
      onTimeRate: 88,
      avgLateMinutes: 12.5,
      maxLateMinutes: 20,
    },
    details: DETAIL_ROWS,
    trips: TRIP_ROWS,
    methodology:
      "Completed non-deleted trips by end_time in window. Rate = on-time / measured only.",
    ...overrides,
  };
}

async function load(payload) {
  const buffer = await buildDriverPerformanceWorkbook(payload, { from: "2026-09-01", to: "2026-09-30" });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer);
  return book;
}

async function loadExecutive(drivers) {
  const buffer = await buildExecutiveWorkbook(
    { fleet: {}, fuel: {}, financial: {}, drivers },
    { from: "2026-09-01", to: "2026-09-30" },
  );
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer);
  return book;
}

const headers = (sheet) => sheet.getRow(1).values.slice(1);

function cellText(cell) {
  const value = cell.value;
  if (value && typeof value === "object" && "formula" in value) return String(value.result ?? "");
  return String(value ?? "");
}

// A numeric cell carrying a percent format is a fraction (0-1). Anything above 1
// renders as >100% — the 8800% class of bug, caught generically.
function oversizedPercentCells(book) {
  const offenders = [];
  book.eachSheet((sheet) => {
    sheet.eachRow((row) => row.eachCell((cell) => {
      if (
        typeof cell.numFmt === "string"
        && cell.numFmt.includes("%")
        && typeof cell.value === "number"
        && cell.value > 1
      ) {
        offenders.push(`${sheet.name}!${cell.address}=${cell.value} (${cell.numFmt})`);
      }
    }));
  });
  return offenders;
}

function suspiciousCells(book) {
  const offenders = [];
  book.eachSheet((sheet) => {
    sheet.eachRow((row) => row.eachCell((cell) => {
      if (/undefined|NaN|8800/.test(cellText(cell))) offenders.push(`${sheet.name}!${cell.address}=${cellText(cell)}`);
    }));
  });
  return offenders;
}

describe("driver performance workbook (Task 6)", () => {
  it("produces the plan's three sheets", async () => {
    const book = await load(driverPayload());
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(["Summary", "Driver Details", "Trip Details"]);
  });

  it("Summary carries the plan's seven punctuality KPIs, in order", async () => {
    const book = await load(driverPayload());
    const summary = book.getWorksheet("Summary");
    const labels = ["A5", "C5", "E5", "G5", "A9", "C9", "E9"].map((ref) => summary.getCell(ref).value);
    expect(labels).toEqual([
      "Drivers",
      "Completed",
      "Fleet Punctuality",
      "On-Time",
      "Late",
      "Unmeasured",
      "Overrides",
    ]);
    const values = ["A6", "C6", "E6", "G6", "A10", "C10", "E10"].map((ref) => summary.getCell(ref).value);
    expect(values).toEqual([2, 15, 0.88, 7, 1, 6, 1]);
  });

  it("writes the fleet punctuality as a numeric fraction with a percent format", async () => {
    const book = await load(driverPayload());
    const cell = book.getWorksheet("Summary").getCell("E6");
    expect(cell.value).toBe(0.88);
    expect(typeof cell.value).toBe("number");
    expect(cell.numFmt).toBe("0.0%");
  });

  it("says Insufficient data (never 0%) when the fleet rate is unmeasured", async () => {
    const book = await load(driverPayload({
      punctuality: {
        measuredTrips: 0,
        onTimeTrips: 0,
        lateTrips: 0,
        unmeasuredTrips: 15,
        overrideTrips: 0,
        onTimeRate: null,
        avgLateMinutes: null,
        maxLateMinutes: null,
      },
    }));
    const cell = book.getWorksheet("Summary").getCell("E6");
    expect(cell.value).not.toBe(0);
    // ExcelJS drops the default "General" format on a write→load round-trip,
    // so an absent numFmt IS General. What matters: no percent/number format.
    expect(cell.numFmt ?? "General").toBe("General");
    expect(String(cellText(cell))).toContain("Insufficient data");
  });

  it("Driver Details uses the plan's nine columns and the payload's per-driver values", async () => {
    const book = await load(driverPayload());
    const sheet = book.getWorksheet("Driver Details");
    expect(headers(sheet)).toEqual([
      "Driver",
      "Status",
      "Completed",
      "Measured",
      "On-Time",
      "Late",
      "Punctuality",
      "Avg Late",
      "Max Late",
    ]);
    // Row 2 = Ana Reyes, row 3 = Ben Cruz (payload order is preserved).
    expect(sheet.getRow(2).values.slice(1)).toEqual([
      "Ana Reyes",
      "Active",
      10,
      8,
      7,
      1,
      0.88,
      12.5,
      20,
    ]);
    expect(sheet.getCell("G2").value).toBe(0.88);
    expect(sheet.getCell("G2").numFmt).toBe("0.0%");
    expect(sheet.getCell("C2").value).toBe(10);
    expect(sheet.getCell("D2").value).toBe(8);
    expect(sheet.getCell("E2").value).toBe(7);
    expect(sheet.getCell("F2").value).toBe(1);
  });

  it("Driver Details renders — (never 0) for a driver with no measured trips", async () => {
    const book = await load(driverPayload());
    const sheet = book.getWorksheet("Driver Details");
    expect(sheet.getCell("G3").value).toBe("—");
    expect(sheet.getCell("H3").value).toBe("—");
    expect(sheet.getCell("I3").value).toBe("—");
    // The count that does exist is still a number.
    expect(sheet.getCell("C3").value).toBe(5);
    expect(sheet.getCell("E3").value).toBe(0);
  });

  it("keeps every percent-formatted cell a fraction (no 8800%)", async () => {
    expect(oversizedPercentCells(await load(driverPayload()))).toEqual([]);
  });

  it("Trip Details uses the plan's six columns and maps the variance", async () => {
    const book = await load(driverPayload());
    const sheet = book.getWorksheet("Trip Details");
    expect(headers(sheet)).toEqual([
      "#id",
      "Driver",
      "Scheduled Pickup",
      "Actual At Pickup",
      "Variance ±m",
      "Result",
    ]);
    expect(sheet.getCell("A2").value).toBe(101);
    expect(sheet.getCell("B2").value).toBe("Ana Reyes");
    expect(sheet.getCell("C2").value instanceof Date).toBe(true);
    expect(sheet.getCell("D2").value instanceof Date).toBe(true);
    expect(sheet.getCell("E2").value).toBe("+9m Late");
    expect(sheet.getCell("F2").value).toBe("Late");
    expect(sheet.getCell("E3").value).toBe("-3m On Time");
    expect(sheet.getCell("F3").value).toBe("On Time");
    expect(sheet.getCell("E4").value).toBe("— Unmeasured");
    expect(sheet.getCell("F4").value).toBe("Unmeasured");
    expect(sheet.getCell("D4").value).toBe("—");
  });

  it("reads an override arrival as Override, never as On Time or Late", async () => {
    const book = await load(driverPayload());
    const sheet = book.getWorksheet("Trip Details");
    expect(sheet.getCell("E5").value).toBe("+12.6m Override");
    expect(sheet.getCell("F5").value).toBe("Override");
  });

  it("drops every score/rating/incident/distance/cost column and invents no value", async () => {
    const book = await load(driverPayload());
    const banned = /score|rating|incident|distance|cost/i;
    const offendingHeaders = [];
    book.eachSheet((sheet) => {
      sheet.getRow(1).eachCell((cell) => {
        if (banned.test(String(cell.value ?? ""))) offendingHeaders.push(`${sheet.name}!${cell.address}=${cell.value}`);
      });
    });
    expect(offendingHeaders).toEqual([]);
    expect(suspiciousCells(book)).toEqual([]);
  });

  it("analytics workbook reads the punctuality payload for its driver KPI and leaderboard", async () => {
    const book = await loadExecutive(driverPayload());
    const summary = book.getWorksheet("Summary");
    expect(summary.getCell("G9").value).toBe("Driver punctuality");
    expect(summary.getCell("G10").value).toBe(0.88);
    expect(summary.getCell("G10").numFmt).toBe("0.0%");

    const leaderboard = book.getWorksheet("Driver Leaderboard");
    expect(headers(leaderboard)).toEqual(["Rank", "Driver", "Completed", "Punctuality", "On-Time", "Late"]);
    expect(leaderboard.getCell("A2").value).toBe(1);
    expect(leaderboard.getCell("B2").value).toBe("Ana Reyes");
    expect(leaderboard.getCell("C2").value).toBe(10);
    expect(leaderboard.getCell("D2").value).toBe(0.88);
    expect(leaderboard.getCell("D2").numFmt).toBe("0.0%");
    expect(leaderboard.getCell("D3").value).toBe("—");
    expect(leaderboard.rowCount).toBe(3);
  });

  it("analytics workbook reports the punctuality signal without a score", async () => {
    const book = await loadExecutive(driverPayload());
    const analysis = book.getWorksheet("Analysis");
    const labels = analysis.getColumn(1).values.slice(5, 10);
    expect(labels).not.toContain("Average driver score");
    expect(labels).toContain("Driver punctuality");
    const signal = analysis.getCell("B9");
    expect(signal.value).toBe(0.88);
    expect(signal.numFmt).toBe("0.0%");
    expect(analysis.getCell("D9").value).toBe("Derived");
  });

  it("analytics workbook keeps percent cells fractional when the rate is unmeasured", async () => {
    const unmeasured = driverPayload({
      details: [DETAIL_ROWS[1]],
      trips: [],
      totalDrivers: 1,
      totalCompletedTrips: 5,
      punctuality: {
        measuredTrips: 0,
        onTimeTrips: 0,
        lateTrips: 0,
        unmeasuredTrips: 5,
        overrideTrips: 0,
        onTimeRate: null,
        avgLateMinutes: null,
        maxLateMinutes: null,
      },
    });
    const book = await loadExecutive(unmeasured);
    const summary = book.getWorksheet("Summary");
    expect(summary.getCell("G10").value).not.toBe(0);
    expect(oversizedPercentCells(book)).toEqual([]);
    const leaderboard = book.getWorksheet("Driver Leaderboard");
    expect(leaderboard.getCell("D2").value).toBe("—");
  });
});
