import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/services/push.service", () => ({ flushOutbox: vi.fn(async () => []) }));
vi.mock("@/lib/email/smtp", () => ({
  isEmailConfigured: vi.fn(() => true),
  sendNewSignInAlertEmail: vi.fn(async () => ({ messageId: "smtp-1" })),
}));

import { query, withTransaction } from "@/lib/db";
import { flushOutbox } from "@/services/push.service";
import { isEmailConfigured, sendNewSignInAlertEmail } from "@/lib/email/smtp";
import {
  NEW_DEVICE_EVENT_KEY,
  NEW_DEVICE_WINDOW_DAYS,
  deviceLabelForRow,
  isKnownDevice,
  shouldAlert,
  newDeviceCopy,
  recordNewDeviceAlert,
} from "./new-device-alert";

const EMPLOYEE = { employee_id: 8 };
/** Same id, with an address the email leg can actually reach. */
const EMPLOYEE_WITH_EMAIL = { employee_id: 8, email: "driver@fleetops.ph" };

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

const txQuery = vi.fn();

/** Route the module's SELECTs by the table they read. */
function mockDb({ prior = [], prefs = [] } = {}) {
  query.mockImplementation(async (sql) => {
    if (sql.includes("FROM audit_logs")) return { rows: prior };
    if (sql.includes("FROM notification_preferences")) return { rows: prefs };
    return { rows: [] };
  });
}

/** Every statement the transaction ran, in order. */
const txStatements = () => txQuery.mock.calls.map(([sql]) => sql);
const txFor = (table) =>
  txQuery.mock.calls.filter(([sql]) => sql.includes(`INSERT INTO ${table}`));

beforeEach(() => {
  vi.clearAllMocks();
  txQuery.mockReset();
  txQuery.mockResolvedValue({ rows: [] });
  withTransaction.mockImplementation(async (fn) => fn({ query: txQuery }));
  flushOutbox.mockResolvedValue([]);
  isEmailConfigured.mockReturnValue(true);
  sendNewSignInAlertEmail.mockResolvedValue({ messageId: "smtp-1" });
  mockDb();
});

describe("deviceLabelForRow", () => {
  it("reduces a web user agent to browser + OS", () => {
    expect(deviceLabelForRow({ user_agent: CHROME_WINDOWS, channel: "web" })).toBe(
      "Chrome on Windows"
    );
    expect(deviceLabelForRow({ user_agent: SAFARI_MAC, channel: "web" })).toBe("Safari on macOS");
  });

  it("collapses every mobile sign-in to one constant label", () => {
    // Documents a real limit rather than a feature: the driver app sends no
    // device-identifying agent, and sessions.js hardcodes the mobile label, so
    // two different phones are indistinguishable here.
    expect(deviceLabelForRow({ user_agent: "okhttp/4.9.2", channel: "mobile" })).toBe(
      "FleetOps Driver app"
    );
    expect(deviceLabelForRow({ user_agent: "CFNetwork/1490", channel: "mobile" })).toBe(
      "FleetOps Driver app"
    );
  });

  it("treats a missing channel as web", () => {
    expect(deviceLabelForRow({ user_agent: CHROME_WINDOWS })).toBe("Chrome on Windows");
  });
});

describe("isKnownDevice / shouldAlert", () => {
  it("recognises a device the account has used", () => {
    const prior = [{ user_agent: CHROME_WINDOWS, channel: "web" }];
    expect(isKnownDevice(prior, "Chrome on Windows")).toBe(true);
    expect(shouldAlert(prior, "Chrome on Windows")).toBe(false);
  });

  it("flags a device the account has never used", () => {
    const prior = [{ user_agent: CHROME_WINDOWS, channel: "web" }];
    expect(isKnownDevice(prior, "Safari on macOS")).toBe(false);
    expect(shouldAlert(prior, "Safari on macOS")).toBe(true);
  });

  it("stays silent with no history — a brand-new account has nothing to compare", () => {
    expect(shouldAlert([], "Chrome on Windows")).toBe(false);
    expect(shouldAlert(undefined, "Chrome on Windows")).toBe(false);
  });

  it("ignores browser version, so an update is not a new device", () => {
    const prior = [{ user_agent: CHROME_WINDOWS, channel: "web" }];
    const upgraded = CHROME_WINDOWS.replace("Chrome/130", "Chrome/141");
    expect(shouldAlert(prior, deviceLabelForRow({ user_agent: upgraded, channel: "web" }))).toBe(
      false
    );
  });
});

describe("newDeviceCopy", () => {
  it("names the device and tells the owner what to do", () => {
    const copy = newDeviceCopy("Chrome on Windows");
    expect(copy.title).toBe("New sign-in to your account");
    expect(copy.message).toContain("Chrome on Windows");
    expect(copy.message).toContain("change your password");
    expect(copy.pushBody).toContain("Chrome on Windows");
  });
});

describe("recordNewDeviceAlert", () => {
  it("scopes the history lookup to this employee's successful sign-ins", async () => {
    mockDb({ prior: [{ user_agent: CHROME_WINDOWS, channel: "web" }] });
    await recordNewDeviceAlert({ employee: EMPLOYEE, userAgent: CHROME_WINDOWS, kind: "web" });

    const [sql, params] = query.mock.calls.find(([s]) => s.includes("FROM audit_logs"));
    expect(sql).toContain("action = 'login_success'");
    expect(sql).toContain("resource = 'authentication'");
    expect(sql).toContain("resource_id = $1");
    expect(params).toEqual([8, NEW_DEVICE_WINDOW_DAYS]);
  });

  it("notifies in-app and by push on an unfamiliar device", async () => {
    mockDb({ prior: [{ user_agent: SAFARI_MAC, channel: "web" }] });
    const result = await recordNewDeviceAlert({
      employee: EMPLOYEE,
      userAgent: CHROME_WINDOWS,
      kind: "web",
    });

    expect(result).toEqual({ alerted: true, label: "Chrome on Windows" });

    const [notifSql, notifParams] = txFor("notifications")[0];
    expect(notifSql).toContain("'Alert'");
    expect(notifSql).toContain("'security'");
    expect(notifParams).toEqual([8, "New sign-in to your account", expect.any(String)]);
    // reference_id must be non-null or the href never resolves (target.js) and
    // pushed_at is never stamped (= NULL never matches).
    expect(notifParams[0]).toBe(8);

    const [pushSql, pushParams] = txFor("push_outbox")[0];
    expect(pushSql).toContain("'default'");
    expect(pushParams[0]).toBe(8);

    // `pushBody` is one short sentence — the tone rule in
    // Capstone/02 - Features/Notifications.md. A second sentence here is the
    // regression this pins, not the exact wording.
    expect(pushParams[2]).toBe("Chrome on Windows — was this you?");
    expect(pushParams[2]).not.toMatch(/\.\s/);

    expect(flushOutbox).toHaveBeenCalledWith({ employeeIds: [8] });
  });

  it("stays silent for a device the account has used", async () => {
    mockDb({ prior: [{ user_agent: CHROME_WINDOWS, channel: "web" }] });
    const result = await recordNewDeviceAlert({
      employee: EMPLOYEE,
      userAgent: CHROME_WINDOWS,
      kind: "web",
    });

    expect(result).toEqual({ alerted: false, reason: "known_device" });
    expect(txQuery).not.toHaveBeenCalled();
    expect(flushOutbox).not.toHaveBeenCalled();
  });

  it("stays silent on a first-ever sign-in", async () => {
    mockDb({ prior: [] });
    expect(
      await recordNewDeviceAlert({ employee: EMPLOYEE, userAgent: CHROME_WINDOWS, kind: "web" })
    ).toEqual({ alerted: false, reason: "no_history" });
    expect(txQuery).not.toHaveBeenCalled();
  });

  it("honours an opt-out of every channel", async () => {
    mockDb({
      prior: [{ user_agent: SAFARI_MAC, channel: "web" }],
      prefs: [
        { employee_id: 8, event_key: NEW_DEVICE_EVENT_KEY, channel: "in_app", enabled: false },
        { employee_id: 8, event_key: NEW_DEVICE_EVENT_KEY, channel: "push", enabled: false },
        { employee_id: 8, event_key: NEW_DEVICE_EVENT_KEY, channel: "email", enabled: false },
      ],
    });

    expect(
      await recordNewDeviceAlert({ employee: EMPLOYEE, userAgent: CHROME_WINDOWS, kind: "web" })
    ).toEqual({ alerted: false, reason: "opted_out" });
    expect(txQuery).not.toHaveBeenCalled();
    expect(sendNewSignInAlertEmail).not.toHaveBeenCalled();
  });

  it("emails the owner when email is the only channel left on", async () => {
    mockDb({
      prior: [{ user_agent: SAFARI_MAC, channel: "web" }],
      prefs: [
        { employee_id: 8, event_key: NEW_DEVICE_EVENT_KEY, channel: "in_app", enabled: false },
        { employee_id: 8, event_key: NEW_DEVICE_EVENT_KEY, channel: "push", enabled: false },
      ],
    });

    const result = await recordNewDeviceAlert({
      employee: EMPLOYEE_WITH_EMAIL,
      userAgent: CHROME_WINDOWS,
      kind: "web",
    });

    expect(result).toEqual({ alerted: true, label: "Chrome on Windows" });
    // Nothing to insert, so no transaction is opened at all.
    expect(txQuery).not.toHaveBeenCalled();
    expect(flushOutbox).not.toHaveBeenCalled();
    expect(sendNewSignInAlertEmail).toHaveBeenCalledWith({
      to: "driver@fleetops.ph",
      deviceLabel: "Chrome on Windows",
    });
  });

  it("skips the email when that channel alone is opted out", async () => {
    mockDb({
      prior: [{ user_agent: SAFARI_MAC, channel: "web" }],
      prefs: [{ employee_id: 8, event_key: NEW_DEVICE_EVENT_KEY, channel: "email", enabled: false }],
    });

    const result = await recordNewDeviceAlert({
      employee: EMPLOYEE_WITH_EMAIL,
      userAgent: CHROME_WINDOWS,
      kind: "web",
    });

    expect(result.alerted).toBe(true);
    expect(sendNewSignInAlertEmail).not.toHaveBeenCalled();
  });

  it("still reports the alert when the mail send fails", async () => {
    // The in-app row is already committed by the time mail is attempted, so a
    // transport failure must not be reported as a failed alert.
    mockDb({ prior: [{ user_agent: SAFARI_MAC, channel: "web" }] });
    sendNewSignInAlertEmail.mockRejectedValue(new Error("535 Authentication failed"));

    const result = await recordNewDeviceAlert({
      employee: EMPLOYEE_WITH_EMAIL,
      userAgent: CHROME_WINDOWS,
      kind: "web",
    });

    expect(result).toEqual({ alerted: true, label: "Chrome on Windows" });
    expect(txFor("notifications")).toHaveLength(1);
  });

  it("still sends the email when push delivery fails", async () => {
    // flushOutbox sits between the committed in-app row and the email leg, so
    // an unhandled push failure would take the email down with it — and push
    // is the channel we already know can reach nobody without a device_tokens
    // row, which is exactly the case that must not matter.
    mockDb({ prior: [{ user_agent: SAFARI_MAC, channel: "web" }] });
    flushOutbox.mockRejectedValue(new Error("push provider down"));

    const result = await recordNewDeviceAlert({
      employee: EMPLOYEE_WITH_EMAIL,
      userAgent: CHROME_WINDOWS,
      kind: "web",
    });

    expect(result).toEqual({ alerted: true, label: "Chrome on Windows" });
    expect(sendNewSignInAlertEmail).toHaveBeenCalledTimes(1);
  });

  it("does not attempt mail when the transport is unconfigured", async () => {
    mockDb({ prior: [{ user_agent: SAFARI_MAC, channel: "web" }] });
    isEmailConfigured.mockReturnValue(false);

    await recordNewDeviceAlert({
      employee: EMPLOYEE_WITH_EMAIL,
      userAgent: CHROME_WINDOWS,
      kind: "web",
    });

    expect(sendNewSignInAlertEmail).not.toHaveBeenCalled();
  });

  it("does not attempt mail to a non-deliverable seed address", async () => {
    // The abandoned test fixtures on the live DB use @example.com, which can
    // never receive; attempting it only spends sender reputation on a bounce.
    mockDb({ prior: [{ user_agent: SAFARI_MAC, channel: "web" }] });

    const result = await recordNewDeviceAlert({
      employee: { employee_id: 8, email: "testdriver1-1788084811@example.com" },
      userAgent: CHROME_WINDOWS,
      kind: "web",
    });

    expect(result.alerted).toBe(true);
    expect(sendNewSignInAlertEmail).not.toHaveBeenCalled();
  });

  it("does not attempt mail when the employee row carries no address", async () => {
    mockDb({ prior: [{ user_agent: SAFARI_MAC, channel: "web" }] });

    await recordNewDeviceAlert({ employee: EMPLOYEE, userAgent: CHROME_WINDOWS, kind: "web" });

    expect(sendNewSignInAlertEmail).not.toHaveBeenCalled();
  });

  it("writes only the in-app row when push is opted out, and does not flush", async () => {
    mockDb({
      prior: [{ user_agent: SAFARI_MAC, channel: "web" }],
      prefs: [
        { employee_id: 8, event_key: NEW_DEVICE_EVENT_KEY, channel: "push", enabled: false },
      ],
    });

    const result = await recordNewDeviceAlert({
      employee: EMPLOYEE,
      userAgent: CHROME_WINDOWS,
      kind: "web",
    });

    expect(result.alerted).toBe(true);
    expect(txFor("notifications")).toHaveLength(1);
    expect(txFor("push_outbox")).toHaveLength(0);
    expect(flushOutbox).not.toHaveBeenCalled();
  });

  it("writes only the push row when in-app is opted out", async () => {
    mockDb({
      prior: [{ user_agent: SAFARI_MAC, channel: "web" }],
      prefs: [
        { employee_id: 8, event_key: NEW_DEVICE_EVENT_KEY, channel: "in_app", enabled: false },
      ],
    });

    const result = await recordNewDeviceAlert({
      employee: EMPLOYEE,
      userAgent: CHROME_WINDOWS,
      kind: "web",
    });

    expect(result.alerted).toBe(true);
    expect(txFor("notifications")).toHaveLength(0);
    expect(txFor("push_outbox")).toHaveLength(1);
    expect(flushOutbox).toHaveBeenCalledWith({ employeeIds: [8] });
  });

  it("never throws when the history lookup fails", async () => {
    query.mockRejectedValue(new Error("db down"));
    expect(
      await recordNewDeviceAlert({ employee: EMPLOYEE, userAgent: CHROME_WINDOWS, kind: "web" })
    ).toEqual({ alerted: false, reason: "history_unavailable" });
  });

  it("never throws when the write fails — a missed notice is not a failed login", async () => {
    mockDb({ prior: [{ user_agent: SAFARI_MAC, channel: "web" }] });
    withTransaction.mockRejectedValue(new Error("db down"));
    expect(
      await recordNewDeviceAlert({ employee: EMPLOYEE, userAgent: CHROME_WINDOWS, kind: "web" })
    ).toEqual({ alerted: false, reason: "error" });
  });

  it("returns without touching the database when there is no employee id", async () => {
    expect(await recordNewDeviceAlert({ employee: {}, userAgent: CHROME_WINDOWS })).toEqual({
      alerted: false,
      reason: "no_employee",
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("runs both inserts in one transaction", async () => {
    mockDb({ prior: [{ user_agent: SAFARI_MAC, channel: "web" }] });
    await recordNewDeviceAlert({ employee: EMPLOYEE, userAgent: CHROME_WINDOWS, kind: "web" });
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(txStatements().filter((s) => s.includes("INSERT INTO")).length).toBe(2);
  });
});
