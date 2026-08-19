import { describe, it, expect } from "vitest";
import { deliveryFor, CHANNEL } from "./push.service";

describe("deliveryFor", () => {
  it("escalates Alert / Emergency types to a loud push", () => {
    expect(deliveryFor({ type: "Alert" })).toEqual({
      kind: "push",
      channelId: CHANNEL.PUSH.id,
      sound: CHANNEL.PUSH.sound,
    });
    expect(deliveryFor({ type: "Emergency" })).toMatchObject({ kind: "push" });
  });

  it("escalates Critical / Major severity to a loud push", () => {
    expect(deliveryFor({ type: "Info", severity: "Critical" })).toMatchObject({ kind: "push" });
    expect(deliveryFor({ type: "Info", severity: "Major" })).toMatchObject({ kind: "push" });
  });

  it("escalates any incident reference to a loud push", () => {
    expect(deliveryFor({ reference_type: "incident", severity: "Minor" })).toMatchObject({
      kind: "push",
    });
  });

  it("treats Warning / Moderate as a quiet heads-up push", () => {
    const headsUp = { kind: "heads-up", channelId: CHANNEL.HEADS_UP.id, sound: CHANNEL.HEADS_UP.sound };
    expect(deliveryFor({ type: "Warning" })).toEqual(headsUp);
    expect(deliveryFor({ type: "Info", severity: "Moderate" })).toMatchObject({ kind: "heads-up" });
  });

  it("keeps routine notifications silent (null)", () => {
    expect(deliveryFor({ type: "Success" })).toBeNull();
    expect(deliveryFor({ type: "Info" })).toBeNull();
    expect(deliveryFor({})).toBeNull();
  });
});