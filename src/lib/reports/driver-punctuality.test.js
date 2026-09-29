import { describe, expect, it, beforeEach, vi } from "vitest";
import { query } from "@/lib/db";
import {
  getDriverPerformanceReport,
  PUNCTUALITY_GRACE_MINUTES,
} from "./operational-reports";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

const driverRows = [
  {
    driver_id: 1,
    name: "Driver One",
    face_image_url: "https://cdn.example.com/face-1.jpg",
    avatar_url: "https://cdn.example.com/avatar-1.jpg",
    driver_status: "Active",
    completed_trips: 10,
    measured_trips: 8,
    on_time_trips: 7,
    late_trips: 1,
    override_trips: 1,
    avg_late_minutes: 12.5,
    max_late_minutes: 20.0,
  },
  {
    driver_id: 2,
    name: "Driver Two",
    face_image_url: null,
    avatar_url: null,
    driver_status: "Active",
    completed_trips: 5,
    measured_trips: 0,
    on_time_trips: 0,
    late_trips: 0,
    override_trips: 0,
    avg_late_minutes: null,
    max_late_minutes: null,
  },
];

const fleetRow = { avg_late_minutes: 12.5, max_late_minutes: 20.0 };

const tripRows = [
  {
    trip_id: 101,
    driver_id: 1,
    driver_name: "Driver One",
    scheduled_pickup: "2026-09-10T08:00:00+08:00",
    at_pickup_at: "2026-09-10T08:03:00+08:00",
    override: false,
    variance_minutes: 3.0,
    result: "on_time",
  },
];

function mockReport(driverGrain = driverRows, fleetGrain = fleetRow, trips = tripRows) {
  vi.mocked(query).mockResolvedValueOnce({ rows: driverGrain });
  vi.mocked(query).mockResolvedValueOnce({ rows: [fleetGrain] });
  vi.mocked(query).mockResolvedValueOnce({ rows: trips });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getDriverPerformanceReport punctuality rewrite (Task 3)", () => {
  it("rolls up per-driver unmeasured + punctuality_rate", async () => {
    mockReport();
    const report = await getDriverPerformanceReport("2026-09-01", "2026-09-30");
    const one = report.details.find((d) => d.driver_id === 1);
    expect(one.unmeasured_trips).toBe(1);
    expect(one.punctuality_rate).toBe(88);
  });

  it("returns null rate (not 0) when measured is 0", async () => {
    mockReport();
    const report = await getDriverPerformanceReport("2026-09-01", "2026-09-30");
    const two = report.details.find((d) => d.driver_id === 2);
    expect(two.punctuality_rate).toBeNull();
    expect(two.unmeasured_trips).toBe(5);
  });

  it("rolls up fleet sums; onTimeRate null when fleet measured is 0", async () => {
    mockReport();
    const report = await getDriverPerformanceReport("2026-09-01", "2026-09-30");
    expect(report.punctuality.measuredTrips).toBe(8);
    expect(report.punctuality.onTimeTrips).toBe(7);
    expect(report.punctuality.lateTrips).toBe(1);
    expect(report.punctuality.unmeasuredTrips).toBe(6);
    expect(report.punctuality.overrideTrips).toBe(1);
    expect(report.totalCompletedTrips).toBe(15);

    vi.clearAllMocks();
    const zeroDrivers = [
      {
        driver_id: 9,
        name: "Nobody Measured",
        driver_status: "Active",
        completed_trips: 3,
        measured_trips: 0,
        on_time_trips: 0,
        late_trips: 0,
        override_trips: 0,
        avg_late_minutes: null,
        max_late_minutes: null,
      },
    ];
    mockReport(zeroDrivers, { avg_late_minutes: null, max_late_minutes: null }, []);
    const empty = await getDriverPerformanceReport("2026-09-01", "2026-09-30");
    expect(empty.punctuality.onTimeRate).toBeNull();
  });

  it("drops legacy scoring fields", async () => {
    mockReport();
    const report = await getDriverPerformanceReport("2026-09-01", "2026-09-30");
    expect(report).not.toHaveProperty("avgScore");
    expect(report).not.toHaveProperty("topDrivers");
    expect(report.details[0]).not.toHaveProperty("performance_score");
  });

  it("keeps face_image_url/avatar_url on details rows (driver photos)", async () => {
    mockReport();
    const report = await getDriverPerformanceReport("2026-09-01", "2026-09-30");
    const one = report.details.find((d) => d.driver_id === 1);
    const two = report.details.find((d) => d.driver_id === 2);
    expect(one.face_image_url).toBe("https://cdn.example.com/face-1.jpg");
    expect(one.avatar_url).toBe("https://cdn.example.com/avatar-1.jpg");
    // Null-safe: absent photo columns must surface as null, never undefined.
    expect(two.face_image_url).toBeNull();
    expect(two.avatar_url).toBeNull();
  });

  it("locks grace to 5 minutes", () => {
    expect(PUNCTUALITY_GRACE_MINUTES).toBe(5);
  });

  it("scopes the fleet-late query to non-deleted drivers", async () => {
    mockReport();
    await getDriverPerformanceReport("2026-09-01", "2026-09-30");
    // Query B feeds fleet.avgLateMinutes/maxLateMinutes while punctuality.lateTrips is
    // summed from Query A's details, so it must carry Query A's driver guard or the KPI
    // averages trips the per-driver rows beneath it exclude.
    const fleetLateSql = vi.mocked(query).mock.calls[1][0];
    expect(fleetLateSql).toContain("LEFT JOIN drivers d ON d.driver_id = t.driver_id");
    expect(fleetLateSql).toContain("d.deleted_at IS NULL");
  });
});
