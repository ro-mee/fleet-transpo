import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/services/push.service", () => ({
  flushOutbox: vi.fn().mockResolvedValue([]),
  CHANNEL: { PUSH: { id: "default" }, HEADS_UP: { id: "heads-up" } },
}));
vi.mock("@/lib/notifications/preferences", () => ({
  loadPreferenceRows: vi.fn().mockResolvedValue([]),
  channelEnabled: vi.fn().mockReturnValue(true),
}));
vi.mock("@/services/driver-schedule.service", () => ({ loadDriverScheduleContext: vi.fn() }));

import { query, withTransaction } from "@/lib/db";
import { flushOutbox } from "@/services/push.service";
import { channelEnabled } from "@/lib/notifications/preferences";
import { loadDriverScheduleContext } from "@/services/driver-schedule.service";
import { syncEndDutyReminders } from "./end-duty-reminder.service";

/** A Manila instant as UTC, so the suite does not depend on the runner's zone. */
const manila = (day, hhmm) => new Date(`${day}T${hhmm}:00+08:00`);

/** One open attendance row, joined to the driver's employee id. */
const openRow = (over = {}) => ({
  attendance_id: 501, driver_id: 7, employee_id: 21,
  date: "2026-09-24", time_in: "2026-09-24T08:05:00+08:00", time_out: null,
  ...over,
});

/**
 * A schedule context whose named drivers work 08:00–17:00 on Thursday AND
 * Friday. Both days are registered because the consecutive-days test moves the
 * duty from the 24th to the 25th (Thu -> Fri); a day 4-only fixture reports
 * Friday as "No work schedule configured" and skips it, which is correct
 * behaviour reported as a dedupe failure.
 */
const scheduleCtx = (shiftEnd = "17:00:00", driverIds = [7]) => {
  const byDay = new Map([
    [4, { day_of_week: 4, shift_start: "08:00:00", shift_end: shiftEnd, is_rest_day: false }],
    [5, { day_of_week: 5, shift_start: "08:00:00", shift_end: shiftEnd, is_rest_day: false }],
  ]);
  return {
    schedules: new Map(driverIds.map((driverId) => [driverId, byDay])),
    leave: new Map(),
  };
};

/**
 * Wire the transaction stub: every tx.query resolves rows by SQL substring, and
 * the dedupe lookup ("FROM notifications") answers `existing` so a test can
 * decide whether this is a first notification or a repeat.
 */
function stubTx({ existing = false, inserted = [] } = {}) {
  withTransaction.mockImplementation(async (fn) => fn({
    query: vi.fn(async (sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("FROM notifications")) return { rows: existing ? [{ notification_id: 1 }] : [] };
      if (sql.includes("INSERT INTO")) return { rows: [{ notification_id: 900 }] };
      return { rows: [] };
    }),
  }));
  return inserted;
}

describe("syncEndDutyReminders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `clearAllMocks` clears call data but KEEPS implementations, so the two
    // tests below that turn a channel off would otherwise leak into every later
    // test in this file — which is exactly how "isolates one driver's failure"
    // first came back with created: 0 and errors: 0 (every driver skipped at
    // the preference gate, so withTransaction was never even called).
    channelEnabled.mockReturnValue(true);
    query.mockResolvedValue({ rows: [openRow()] });
    loadDriverScheduleContext.mockResolvedValue(scheduleCtx());
  });

  it("stays silent while the shift is still running", async () => {
    const result = await syncEndDutyReminders({ now: manila("2026-09-24", "16:45") });
    expect(result).toMatchObject({ created: 0, skipped: 1 });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("stays silent through the grace period", async () => {
    const result = await syncEndDutyReminders({ now: manila("2026-09-24", "17:15") });
    expect(result.created).toBe(0);
  });

  it("notifies the quiet stage once the grace has passed", async () => {
    stubTx();
    const result = await syncEndDutyReminders({ now: manila("2026-09-24", "17:45") });
    expect(result).toMatchObject({ created: 2, pushes_attempted: 1, scanned: 1 });
    expect(flushOutbox).toHaveBeenCalledWith({ employeeIds: [21] });
  });

  it("uses the quiet heads-up channel for stage 1 and the loud one for stage 2", async () => {
    const seen = [];
    withTransaction.mockImplementation(async (fn) => fn({
      query: vi.fn(async (sql, params) => {
        if (sql.includes("INSERT INTO push_outbox")) seen.push(params[3]);
        if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
        if (sql.includes("FROM notifications")) return { rows: [] };
        return { rows: [] };
      }),
    }));

    await syncEndDutyReminders({ now: manila("2026-09-24", "17:45") });
    await syncEndDutyReminders({ now: manila("2026-09-24", "19:30") });

    expect(seen).toEqual(["heads-up", "default"]);
  });

  it("keys the reference on the duty day, so consecutive forgotten days both notify", async () => {
    const refs = [];
    withTransaction.mockImplementation(async (fn) => fn({
      query: vi.fn(async (sql, params) => {
        if (sql.includes("INSERT INTO notifications")) refs.push(params[5]);
        if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
        if (sql.includes("FROM notifications")) return { rows: [] };
        return { rows: [] };
      }),
    }));

    query.mockResolvedValue({ rows: [openRow({ date: "2026-09-24" })] });
    await syncEndDutyReminders({ now: manila("2026-09-24", "17:45") });
    query.mockResolvedValue({ rows: [openRow({ date: "2026-09-25", attendance_id: 502 })] });
    await syncEndDutyReminders({ now: manila("2026-09-25", "17:45") });

    expect(refs).toEqual([20260924, 20260925]);
  });

  it("sends nothing when this stage was already delivered for this day", async () => {
    stubTx({ existing: true });
    const result = await syncEndDutyReminders({ now: manila("2026-09-24", "17:45") });
    expect(result.created).toBe(0);
    expect(flushOutbox).not.toHaveBeenCalled();
  });

  it("selects only rows that are open — checked in with no out-time", async () => {
    stubTx();
    await syncEndDutyReminders({ now: manila("2026-09-24", "17:45") });
    const [sql] = query.mock.calls[0];
    expect(sql).toContain("time_in IS NOT NULL");
    expect(sql).toContain("time_out IS NULL");
  });

  it("skips a driver with no usable roster time instead of guessing a deadline", async () => {
    loadDriverScheduleContext.mockResolvedValue({ schedules: new Map(), leave: new Map() });
    const result = await syncEndDutyReminders({ now: manila("2026-09-24", "17:45") });
    expect(result).toMatchObject({ created: 0, skipped: 1, errors: 0 });
  });

  it("skips a rest day", async () => {
    loadDriverScheduleContext.mockResolvedValue({
      schedules: new Map([[7, new Map([[4, { day_of_week: 4, shift_start: "08:00:00", shift_end: "17:00:00", is_rest_day: true }]])]]),
      leave: new Map(),
    });
    const result = await syncEndDutyReminders({ now: manila("2026-09-24", "17:45") });
    expect(result.created).toBe(0);
  });

  it("honours a disabled push preference — the in-app row still lands, the outbox row does not", async () => {
    const { channelEnabled } = await import("@/lib/notifications/preferences");
    channelEnabled.mockImplementation(({ channel }) => channel !== "push");
    stubTx();
    const result = await syncEndDutyReminders({ now: manila("2026-09-24", "17:45") });
    expect(result).toMatchObject({ created: 1, pushes_attempted: 0 });
  });

  it("honours both channels being off — nothing written at all", async () => {
    const { channelEnabled } = await import("@/lib/notifications/preferences");
    channelEnabled.mockReturnValue(false);
    stubTx();
    const result = await syncEndDutyReminders({ now: manila("2026-09-24", "17:45") });
    expect(result).toMatchObject({ created: 0, pushes_attempted: 0 });
  });

  // Dedupe has to consider BOTH tables: with in_app off no `notifications` row
  // is ever written, so a notifications-only lookup never trips and the same
  // stage would enqueue a fresh outbox row on every cron tick (~1/min in the
  // deployed loop) until it advances — a push every minute until the report
  // closes. The outbox row must dedupe on its own.
  it("does not re-enqueue a push when in-app is off — the outbox row dedupes alone", async () => {
    const { channelEnabled } = await import("@/lib/notifications/preferences");
    channelEnabled.mockImplementation(({ channel }) => channel === "push");

    const outboxInserts = [];
    let outboxHasRow = false;
    withTransaction.mockImplementation(async (fn) => fn({
      query: vi.fn(async (sql, params) => {
        if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
        if (sql.includes("INSERT INTO push_outbox")) {
          outboxInserts.push(params);
          return { rows: [] };
        }
        // The combined dedupe query names both tables; push_outbox wins the
        // branch order, and in_app being off means notifications is always empty.
        if (sql.includes("FROM push_outbox")) return { rows: outboxHasRow ? [{ ok: 1 }] : [] };
        if (sql.includes("FROM notifications")) return { rows: [] };
        if (sql.includes("INSERT INTO notifications")) return { rows: [{ notification_id: 900 }] };
        return { rows: [] };
      }),
    }));

    const first = await syncEndDutyReminders({ now: manila("2026-09-24", "17:45") });
    outboxHasRow = true;
    const second = await syncEndDutyReminders({ now: manila("2026-09-24", "17:50") });

    expect(first).toMatchObject({ created: 1, pushes_attempted: 1 });
    expect(second).toMatchObject({ created: 0, pushes_attempted: 0 });
    expect(outboxInserts).toHaveLength(1);
  });

  it("never throws — a producer failure must not fail the cron run", async () => {
    query.mockRejectedValue(new Error("db down"));
    await expect(syncEndDutyReminders({ now: manila("2026-09-24", "17:45") }))
      .resolves.toMatchObject({ errors: 1 });
  });

  it("isolates one driver's failure from the rest of the scan", async () => {
    query.mockResolvedValue({ rows: [openRow(), openRow({ attendance_id: 502, driver_id: 8, employee_id: 22 })] });
    loadDriverScheduleContext.mockResolvedValue(scheduleCtx("17:00:00", [7, 8]));
    withTransaction
      .mockRejectedValueOnce(new Error("lock timeout"))
      .mockImplementationOnce(async (fn) => fn({
        query: vi.fn(async (sql) => {
          if (sql.includes("FROM notifications")) return { rows: [] };
          if (sql.includes("INSERT INTO")) return { rows: [{ notification_id: 901 }] };
          return { rows: [] };
        }),
      }));
    const result = await syncEndDutyReminders({ now: manila("2026-09-24", "17:45") });
    expect(result).toMatchObject({ scanned: 2, created: 2, errors: 1 });
  });
});
