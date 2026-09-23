import { describe, it, expect } from "vitest";
import {
  APP_LOCK_TIMEOUT_MS,
  shouldLockOnResume,
  noteAppStateChange,
  initialLocked,
} from "./app-lock";

const T0 = 1_700_000_000_000;

describe("APP_LOCK_TIMEOUT_MS", () => {
  it("is 5 minutes, matching the web idle timeout", () => {
    expect(APP_LOCK_TIMEOUT_MS).toBe(5 * 60 * 1000);
  });
});

describe("shouldLockOnResume", () => {
  it("does not lock when the app never left the foreground", () => {
    expect(shouldLockOnResume({ backgroundedAt: null, now: T0 })).toBe(false);
    expect(shouldLockOnResume({ backgroundedAt: undefined, now: T0 })).toBe(false);
    expect(shouldLockOnResume({ backgroundedAt: NaN, now: T0 })).toBe(false);
  });

  it("does not lock just under the window", () => {
    expect(shouldLockOnResume({ backgroundedAt: T0, now: T0 + APP_LOCK_TIMEOUT_MS - 1 })).toBe(false);
  });

  it("locks exactly at the window", () => {
    expect(shouldLockOnResume({ backgroundedAt: T0, now: T0 + APP_LOCK_TIMEOUT_MS })).toBe(true);
  });

  it("locks well past the window", () => {
    expect(shouldLockOnResume({ backgroundedAt: T0, now: T0 + 60 * 60 * 1000 })).toBe(true);
  });

  it("honours an override window", () => {
    expect(shouldLockOnResume({ backgroundedAt: T0, now: T0 + 1000, timeoutMs: 1000 })).toBe(true);
    expect(shouldLockOnResume({ backgroundedAt: T0, now: T0 + 999, timeoutMs: 1000 })).toBe(false);
  });

  // Fail closed: a backwards clock is exactly what an attacker holding an
  // unlocked phone would reach for, and the cost of being wrong here is one
  // prompt rather than a bypass.
  it("locks when the device clock moved backwards", () => {
    expect(shouldLockOnResume({ backgroundedAt: T0, now: T0 - 60 * 60 * 1000 })).toBe(true);
  });

  it("locks when the current time is unusable", () => {
    expect(shouldLockOnResume({ backgroundedAt: T0, now: NaN })).toBe(true);
    expect(shouldLockOnResume({ backgroundedAt: T0, now: Infinity })).toBe(true);
  });
});

describe("noteAppStateChange", () => {
  it("stamps the clock on leaving the foreground", () => {
    expect(
      noteAppStateChange({ previousState: "active", nextState: "background", backgroundedAt: null, now: T0 })
    ).toEqual({ backgroundedAt: T0, resumedFrom: null });
  });

  it("stamps on `inactive` too, so an app-switcher peek counts as leaving", () => {
    expect(
      noteAppStateChange({ previousState: "active", nextState: "inactive", backgroundedAt: null, now: T0 })
    ).toEqual({ backgroundedAt: T0, resumedFrom: null });
  });

  // Re-stamping while already away would let a stray `inactive` deep into a
  // backgrounded period silently extend the window — the bypass this lock
  // exists to prevent.
  it("never re-stamps while already away", () => {
    const later = T0 + 4 * 60 * 1000;
    expect(
      noteAppStateChange({ previousState: "background", nextState: "inactive", backgroundedAt: T0, now: later })
    ).toEqual({ backgroundedAt: T0, resumedFrom: null });
    expect(
      noteAppStateChange({ previousState: "inactive", nextState: "background", backgroundedAt: T0, now: later })
    ).toEqual({ backgroundedAt: T0, resumedFrom: null });
  });

  it("hands the stamp back once on resume, then clears it", () => {
    expect(
      noteAppStateChange({ previousState: "background", nextState: "active", backgroundedAt: T0, now: T0 + 10 })
    ).toEqual({ backgroundedAt: null, resumedFrom: T0 });

    // A second `active` event cannot re-evaluate the same window.
    expect(
      noteAppStateChange({ previousState: "active", nextState: "active", backgroundedAt: null, now: T0 + 20 })
    ).toEqual({ backgroundedAt: null, resumedFrom: null });
  });

  it("does not invent a resume when the app never left", () => {
    expect(
      noteAppStateChange({ previousState: "active", nextState: "active", backgroundedAt: null, now: T0 })
    ).toEqual({ backgroundedAt: null, resumedFrom: null });
  });
});

describe("full leave/return cycle", () => {
  it("locks after a long absence", () => {
    let backgroundedAt = null;

    let step = noteAppStateChange({ previousState: "active", nextState: "background", backgroundedAt, now: T0 });
    backgroundedAt = step.backgroundedAt;
    expect(backgroundedAt).toBe(T0);

    const now = T0 + APP_LOCK_TIMEOUT_MS + 1;
    step = noteAppStateChange({ previousState: "background", nextState: "active", backgroundedAt, now });
    expect(shouldLockOnResume({ backgroundedAt: step.resumedFrom, now })).toBe(true);
  });

  it("does not lock after a brief absence", () => {
    let backgroundedAt = null;

    let step = noteAppStateChange({ previousState: "active", nextState: "background", backgroundedAt, now: T0 });
    backgroundedAt = step.backgroundedAt;

    const now = T0 + 30 * 1000;
    step = noteAppStateChange({ previousState: "background", nextState: "active", backgroundedAt, now });
    expect(shouldLockOnResume({ backgroundedAt: step.resumedFrom, now })).toBe(false);
  });

  it("survives an interleaved inactive without extending the window", () => {
    let backgroundedAt = noteAppStateChange({
      previousState: "active",
      nextState: "inactive",
      backgroundedAt: null,
      now: T0,
    }).backgroundedAt;

    // Noise while away must not move the clock forward.
    backgroundedAt = noteAppStateChange({
      previousState: "inactive",
      nextState: "background",
      backgroundedAt,
      now: T0 + 4 * 60 * 1000,
    }).backgroundedAt;
    expect(backgroundedAt).toBe(T0);

    const now = T0 + APP_LOCK_TIMEOUT_MS;
    const step = noteAppStateChange({ previousState: "background", nextState: "active", backgroundedAt, now });
    expect(shouldLockOnResume({ backgroundedAt: step.resumedFrom, now })).toBe(true);
  });
});

describe("initialLocked", () => {
  it("starts locked only when the driver opted in", () => {
    expect(initialLocked({ biometricEnabled: true })).toBe(true);
    expect(initialLocked({ biometricEnabled: false })).toBe(false);
  });

  it("defaults to unlocked for anything but an explicit true", () => {
    expect(initialLocked({})).toBe(false);
    expect(initialLocked({ biometricEnabled: undefined })).toBe(false);
    expect(initialLocked({ biometricEnabled: "true" })).toBe(false);
  });
});
