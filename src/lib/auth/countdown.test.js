import { describe, expect, it } from "vitest";
import {
  COUNTDOWN_WARNING_SECONDS,
  countdownTone,
  formatCountdown,
  formatCountdownSpoken,
} from "./countdown";
import { IDLE_WARNING_SECONDS } from "./session-policy";

describe("formatCountdown", () => {
  it("renders m:ss with the seconds zero-padded", () => {
    expect(formatCountdown(272)).toBe("4:32");
    expect(formatCountdown(300)).toBe("5:00");
    expect(formatCountdown(60)).toBe("1:00");
    expect(formatCountdown(9)).toBe("0:09");
  });

  it("clamps an expired deadline to 0:00 rather than going negative", () => {
    // Both surfaces tick against a deadline that has already passed for the
    // second or so between expiry and the redirect.
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-1)).toBe("0:00");
    expect(formatCountdown(-300)).toBe("0:00");
  });

  it("floors a fractional second instead of rounding up", () => {
    // Callers pass Math.ceil(ms / 1000); this must not round that back up.
    expect(formatCountdown(59.9)).toBe("0:59");
  });

  it("handles the legacy 3600s idle window as a 5-character string", () => {
    // Sessions created before migration 113 still store idle_timeout_seconds
    // = 3600, so "59:59" is reachable and the chip must not assume 4 chars.
    expect(formatCountdown(3599)).toBe("59:59");
  });

  it("cannot emit NaN from a non-finite input", () => {
    expect(formatCountdown(Number.NaN)).toBe("0:00");
    expect(formatCountdown(undefined)).toBe("0:00");
    expect(formatCountdown(Infinity)).toBe("0:00");
  });
});

describe("formatCountdownSpoken", () => {
  it("speaks a duration rather than a clock reading", () => {
    expect(formatCountdownSpoken(272)).toBe("4 minutes 32 seconds");
    expect(formatCountdownSpoken(61)).toBe("1 minute 1 second");
    expect(formatCountdownSpoken(60)).toBe("1 minute 0 seconds");
    expect(formatCountdownSpoken(1)).toBe("1 second");
    expect(formatCountdownSpoken(0)).toBe("0 seconds");
  });

  it("omits the minutes when there are none", () => {
    expect(formatCountdownSpoken(45)).toBe("45 seconds");
  });

  it("agrees with formatCountdown about the zero clamp", () => {
    expect(formatCountdownSpoken(-10)).toBe("0 seconds");
  });
});

describe("countdownTone", () => {
  it("escalates at exactly COUNTDOWN_WARNING_SECONDS", () => {
    expect(countdownTone(COUNTDOWN_WARNING_SECONDS + 1)).toBe("neutral");
    expect(countdownTone(COUNTDOWN_WARNING_SECONDS)).toBe("warning");
    expect(countdownTone(30)).toBe("warning");
    expect(countdownTone(0)).toBe("warning");
  });

  it("is neutral for a freshly extended session", () => {
    expect(countdownTone(300)).toBe("neutral");
  });
});

// The chip and the modal both warn about the same deadline. If the chip's
// threshold ever drops to the modal's, the chip turns amber on the same tick the
// modal's opaque backdrop covers it — the escalation becomes unreachable and the
// tone is dead code. This is the guard on that reasoning.
describe("Countdown tone invariant", () => {
  it("escalates strictly before the modal opens", () => {
    expect(COUNTDOWN_WARNING_SECONDS).toBeGreaterThan(IDLE_WARNING_SECONDS);
  });
});
