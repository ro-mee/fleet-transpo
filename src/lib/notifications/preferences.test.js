// Tests for the notification preference resolver — the read side that makes
// notification_preferences (migration 037) real: a row overrides, an absent
// row inherits the NOTIFICATION_EVENTS default.
import { describe, it, expect, vi, afterEach } from "vitest";
import * as db from "@/lib/db";
import { channelEnabled, loadPreferenceRows } from "./preferences";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("channelEnabled — row overrides, absence inherits the default", () => {
  it("an explicit false row wins over a true default", () => {
    const rows = [{ employee_id: 77, event_key: "trip_start_window", channel: "push", enabled: false }];
    expect(channelEnabled({ preferenceRows: rows, employeeId: 77, eventKey: "trip_start_window", channel: "push" })).toBe(false);
  });

  it("an explicit true row wins over a false default", () => {
    const events = { some_event: { label: "X", defaults: { push: false } } };
    const rows = [{ employee_id: 77, event_key: "some_event", channel: "push", enabled: true }];
    expect(channelEnabled({ preferenceRows: rows, employeeId: 77, eventKey: "some_event", channel: "push", events })).toBe(true);
  });

  it("no row → the NOTIFICATION_EVENTS default applies", () => {
    // trip_start_window defaults: in_app true, push true, email false.
    expect(channelEnabled({ preferenceRows: [], employeeId: 77, eventKey: "trip_start_window", channel: "in_app" })).toBe(true);
    expect(channelEnabled({ preferenceRows: [], employeeId: 77, eventKey: "trip_start_window", channel: "push" })).toBe(true);
    expect(channelEnabled({ preferenceRows: [], employeeId: 77, eventKey: "trip_start_window", channel: "email" })).toBe(false);
  });

  it("a row for a DIFFERENT employee or event or channel never leaks", () => {
    const rows = [
      { employee_id: 88, event_key: "trip_start_window", channel: "push", enabled: false },
      { employee_id: 77, event_key: "trip_departure_due", channel: "push", enabled: false },
      { employee_id: 77, event_key: "trip_start_window", channel: "in_app", enabled: false },
    ];
    expect(channelEnabled({ preferenceRows: rows, employeeId: 77, eventKey: "trip_start_window", channel: "push" })).toBe(true);
  });

  it("a non-boolean enabled value is treated as disabled, not truthy", () => {
    const rows = [{ employee_id: 77, event_key: "trip_start_window", channel: "push", enabled: "yes" }];
    expect(channelEnabled({ preferenceRows: rows, employeeId: 77, eventKey: "trip_start_window", channel: "push" })).toBe(false);
  });
});

describe("loadPreferenceRows — scoped read", () => {
  it("queries only the given employees and known event keys", async () => {
    const fn = vi.spyOn(db, "query").mockResolvedValue({ rows: [] });
    await loadPreferenceRows([77, 77, 88], ["trip_start_window", "not_a_real_event"]);
    const [sql, params] = fn.mock.calls[0];
    expect(String(sql)).toContain("FROM notification_preferences");
    expect(params[0]).toEqual([77, 88]);
    expect(params[1]).toEqual(["trip_start_window"]); // unknown key filtered out
  });

  it("returns [] without querying when nothing to load", async () => {
    const fn = vi.spyOn(db, "query").mockResolvedValue({ rows: [] });
    expect(await loadPreferenceRows([], ["trip_start_window"])).toEqual([]);
    expect(await loadPreferenceRows([77], [])).toEqual([]);
    expect(await loadPreferenceRows([], [])).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});
