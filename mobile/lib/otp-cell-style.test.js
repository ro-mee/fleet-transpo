// mobile/lib/otp-cell-style.test.js
import { describe, it, expect } from "vitest";
import { otpCellFill, OTP_DASH } from "./otp-cell-style.js";

const light = { surfaceContainerLowest: "#FFFFFF", surfaceContainerHigh: "#ECE7DE" };
const dark = { surfaceContainerLowest: "#0D1311", surfaceContainerHigh: "#25302B" };

describe("otpCellFill — recipe B depth channel", () => {
  it("separates empty from filled in light (the root-cause fix)", () => {
    const empty = otpCellFill({ status: "idle", filled: false, isDark: false, colors: light });
    const filled = otpCellFill({ status: "idle", filled: true, isDark: false, colors: light });
    expect(empty).toBe("#ECE7DE");
    expect(filled).toBe("#FFFFFF");
    expect(empty).not.toBe(filled);
  });

  it("separates empty from filled in dark", () => {
    expect(otpCellFill({ status: "idle", filled: false, isDark: true, colors: dark })).toBe("#0D1311");
    expect(otpCellFill({ status: "idle", filled: true, isDark: true, colors: dark })).toBe("#25302B");
  });

  it("keeps the existing error and success tints untouched", () => {
    expect(otpCellFill({ status: "error", filled: false, isDark: false, colors: light })).toBe("rgba(168,67,64,0.06)");
    expect(otpCellFill({ status: "error", filled: true, isDark: true, colors: dark })).toBe("rgba(242,163,156,0.10)");
    expect(otpCellFill({ status: "success", filled: false, isDark: false, colors: light })).toBe("rgba(40,107,84,0.08)");
    expect(otpCellFill({ status: "success", filled: true, isDark: true, colors: dark })).toBe("rgba(130,190,163,0.12)");
  });

  it("gives a focused cell its fill-state material, never a third colour", () => {
    // `focused` is intentionally not a parameter: focus changes the ring, not the fill.
    expect(otpCellFill({ status: "idle", filled: false, isDark: false, colors: light })).toBe("#ECE7DE");
    expect(otpCellFill({ status: "idle", filled: true, isDark: false, colors: light })).toBe("#FFFFFF");
  });

  it("verifying keeps the depth channel (opacity handles the dimming)", () => {
    expect(otpCellFill({ status: "verifying", filled: true, isDark: false, colors: light })).toBe("#FFFFFF");
    expect(otpCellFill({ status: "verifying", filled: false, isDark: false, colors: light })).toBe("#ECE7DE");
  });
});

describe("OTP_DASH — the separator must fit its slot", () => {
  it("never lets the dash overflow the row gap", () => {
    expect(OTP_DASH.dashWidth).toBeLessThanOrEqual(OTP_DASH.rowGap);
    expect(OTP_DASH.separatorWidth).toBe(OTP_DASH.rowGap);
    expect(OTP_DASH.separatorLeft).toBe(-OTP_DASH.rowGap);
  });
});
