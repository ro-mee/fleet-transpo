import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { onboardingTheme } from "../components/onboarding/onboardingTheme";

describe("onboarding theme and assets contract", () => {
  it("provides comprehensive dark-green onboarding tokens", () => {
    const { colors, spacing, radius } = onboardingTheme;

    expect(colors.background).toBe("#031B1B");
    expect(colors.surface).toBe("#0B2728");
    expect(colors.mint).toBe("#9CF0D7");
    expect(colors.aqua).toBe("#57D7D4");
    expect(colors.textPrimary).toBe("#F4FAF8");
    expect(colors.textSecondary).toBe("#B9CFCA");
    expect(colors.buttonGrad).toEqual(["#88EED2", "#52D4D0"]);
    expect(colors.buttonDisabled).toBe("#173C38");

    expect(spacing.sm).toBe(10);
    expect(spacing.md).toBe(14);
    expect(spacing.xl).toBe(24);

    expect(radius.card).toBe(18);
    expect(radius.pill).toBe(999);
  });

  it("verifies required image assets exist in mobile/assets/images/onboarding", () => {
    const baseDir = resolve(__dirname, "../assets/images/onboarding");
    expect(existsSync(resolve(baseDir, "map-bg.png"))).toBe(true);
    expect(existsSync(resolve(baseDir, "permissions-hero.png"))).toBe(true);
    expect(existsSync(resolve(baseDir, "privacy-shield.png"))).toBe(true);
  });
});

