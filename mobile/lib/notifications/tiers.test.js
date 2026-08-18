import { describe, it, expect } from "vitest";
import { classifyNotification, toneForInAppEvent, TIER, TONE } from "./tiers";

describe("classifyNotification", () => {
  it("escalates Alert / Emergency types to a push", () => {
    expect(classifyNotification({ type: "Alert" })).toMatchObject({
      tier: TIER.PUSH,
      tone: TONE.CRITICAL,
      urgent: true,
    });
    expect(classifyNotification({ type: "Emergency" })).toMatchObject({
      tier: TIER.PUSH,
    });
  });

  it("escalates Critical / Major severity to a push", () => {
    expect(classifyNotification({ type: "Info", severity: "Critical" })).toMatchObject({
      tier: TIER.PUSH,
      tone: TONE.CRITICAL,
    });
    expect(classifyNotification({ type: "Info", severity: "Major" })).toMatchObject({
      tier: TIER.PUSH,
    });
  });

  it("escalates incident references to a push", () => {
    expect(classifyNotification({ reference_type: "incident", severity: "Minor" })).toMatchObject({
      tier: TIER.PUSH,
      tone: TONE.CRITICAL,
    });
  });

  it("treats Warning / Moderate as heads-up only", () => {
    expect(classifyNotification({ type: "Warning" })).toMatchObject({
      tier: TIER.HEADS_UP,
      tone: TONE.WARNING,
      urgent: true,
    });
    expect(classifyNotification({ type: "Info", severity: "Moderate" })).toMatchObject({
      tier: TIER.HEADS_UP,
    });
  });

  it("keeps routine notifications silent", () => {
    expect(classifyNotification({ type: "Success" })).toMatchObject({
      tier: TIER.SILENT,
      tone: TONE.INFO,
      urgent: false,
    });
    expect(classifyNotification({ type: "Info" })).toMatchObject({ tier: TIER.SILENT });
    expect(classifyNotification({})).toMatchObject({ tier: TIER.SILENT });
  });
});

describe("toneForInAppEvent", () => {
  it("maps urgent kinds to critical", () => {
    expect(toneForInAppEvent("sos")).toBe(TONE.CRITICAL);
    expect(toneForInAppEvent("critical")).toBe(TONE.CRITICAL);
    expect(toneForInAppEvent("error")).toBe(TONE.CRITICAL);
  });
  it("maps warning / success / info", () => {
    expect(toneForInAppEvent("warning")).toBe(TONE.WARNING);
    expect(toneForInAppEvent("success")).toBe(TONE.SUCCESS);
    expect(toneForInAppEvent("anything")).toBe(TONE.INFO);
  });
});