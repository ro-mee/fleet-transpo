import { describe, it, expect } from "vitest";
import {
  DEFAULT_FUEL_POLICY,
  FUEL_POLICY_RANGES,
  mergeFuelPolicy,
  validateFuelPolicy,
} from "./fuel-policy";

describe("fuel-policy pure module", () => {
  it("exports valid default configuration", () => {
    expect(DEFAULT_FUEL_POLICY.reserveBufferPercent).toBe(10);
    expect(DEFAULT_FUEL_POLICY.preferredTargetPercent).toBe(90);
    expect(DEFAULT_FUEL_POLICY.varianceThresholdPercent).toBe(15);
    expect(DEFAULT_FUEL_POLICY.autoApprovalEnabled).toBe(true);
    expect(DEFAULT_FUEL_POLICY.autoApprovalMaxLiters).toBe(60);
    expect(DEFAULT_FUEL_POLICY.budgetEnforcementMode).toBe("warning");
    expect(DEFAULT_FUEL_POLICY.maxPricePerLiter).toBe(120);
  });

  it("merges undefined / empty input with defaults", () => {
    const merged = mergeFuelPolicy();
    expect(merged).toEqual(DEFAULT_FUEL_POLICY);
    expect(mergeFuelPolicy({ reserveBufferPercent: null }).reserveBufferPercent).toBe(10);
  });

  it("clamps out-of-range numerical fields during merge", () => {
    const merged = mergeFuelPolicy({
      reserveBufferPercent: 999,
      varianceThresholdPercent: -10,
      autoApprovalMaxLiters: 1,
    });
    expect(merged.reserveBufferPercent).toBe(FUEL_POLICY_RANGES.reserveBufferPercent.max);
    expect(merged.varianceThresholdPercent).toBe(FUEL_POLICY_RANGES.varianceThresholdPercent.min);
    expect(merged.autoApprovalMaxLiters).toBe(FUEL_POLICY_RANGES.autoApprovalMaxLiters.min);
  });

  it("validates valid policy payloads successfully", () => {
    const check = validateFuelPolicy({
      reserveBufferPercent: 12,
      preferredTargetPercent: 85,
      varianceThresholdPercent: 10,
      autoApprovalMaxLiters: 50,
      budgetEnforcementMode: "strict",
    });
    expect(check.ok).toBe(true);
  });

  it("rejects policy when reserveBuffer exceeds or equals preferredTarget", () => {
    const check = validateFuelPolicy({
      reserveBufferPercent: 30,
      preferredTargetPercent: 50,
    });
    expect(check.ok).toBe(true);

    const failCheck = validateFuelPolicy({
      reserveBufferPercent: 40,
      preferredTargetPercent: 40,
    });
    expect(failCheck.ok).toBe(false);
    expect(failCheck.error).toMatch(/must be less than/i);
  });

  it("rejects invalid budgetEnforcementMode", () => {
    const check = validateFuelPolicy({
      budgetEnforcementMode: "invalid_mode",
    });
    expect(check.ok).toBe(false);
    expect(check.error).toMatch(/budgetEnforcementMode/i);
  });

  it("rejects non-boolean switches", () => {
    expect(validateFuelPolicy({ strictFuelTypeMatching: "false" }).ok).toBe(false);
  });

  it("rejects a target above the physical cap and normalizes stored values", () => {
    const invalid = { preferredTargetPercent: 95, maxFillCapPercent: 80 };
    expect(validateFuelPolicy(invalid).ok).toBe(false);
    expect(mergeFuelPolicy(invalid).preferredTargetPercent).toBe(80);
  });
});
