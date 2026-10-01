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

  it("scopes the trip-grain query to non-deleted drivers", async () => {
    mockReport();
    await getDriverPerformanceReport("2026-09-01", "2026-09-30");
    // Query C feeds the workbook/payload `trips` rows. Without the guard it returns
    // soft-deleted drivers' trips while `details` (Query A) excludes them, so the
    // Trip Details sheet would list more completed trips than the Summary counts.
    const tripSql = vi.mocked(query).mock.calls[2][0];
    expect(tripSql).toContain("LEFT JOIN drivers d ON d.driver_id = t.driver_id");
    expect(tripSql).toContain("d.deleted_at IS NULL");
  });

  // ── All Time must CONTAIN any shorter window ─────────────────────────────
  //
  // Reported symptom: "All Time shows 0 completed trips while shorter periods
  // show 4". The API layer was the first place checked (the plan's gate): a
  // read-only probe against live on 2026-10-01 returned totalCompletedTrips = 4
  // for 1970-01-01→2100-01-01 AND for the trailing 30 days, and the fleet report
  // returned 6 all-time against 4 for 30 days — i.e. the report layer is already
  // a superset and the mismatch was not at DB/API level. These two tests pin
  // that property so a future change to the window predicate cannot silently
  // invert it.
  it("sends the All Time window to every one of its queries", async () => {
    mockReport();
    await getDriverPerformanceReport("1970-01-01", "2100-01-01");
    expect(vi.mocked(query).mock.calls).toHaveLength(3);
    for (const call of vi.mocked(query).mock.calls) {
      expect(call[1].slice(0, 2)).toEqual(["1970-01-01", "2100-01-01"]);
    }
  });

  it("filters completed trips on the same half-open end_time window in every query", async () => {
    mockReport();
    await getDriverPerformanceReport("1970-01-01", "2100-01-01");
    for (const call of vi.mocked(query).mock.calls) {
      // `>= $1::date AND < ($2::date + 1)` is what makes the window half-open
      // and therefore strictly expanding: a wider `$1/$2` can only ADD rows.
      expect(call[0]).toContain("t.end_time >= $1::date AND t.end_time < ($2::date + 1)");
      expect(call[0]).toContain("t.trip_status = 'Completed'");
    }
  });

  it("returns the same total for All Time as for a window over the same rows", async () => {
    // Same underlying rows ⇒ same headline total. This is the property the
    // reported symptom violated (0 vs 4); the report must never re-filter in JS.
    mockReport();
    const all = await getDriverPerformanceReport("1970-01-01", "2100-01-01");
    vi.clearAllMocks();
    mockReport();
    const month = await getDriverPerformanceReport("2026-09-01", "2026-09-30");
    expect(all.totalCompletedTrips).toBe(month.totalCompletedTrips);
    expect(all.totalCompletedTrips).toBe(15);
  });
});
