import { describe, it, expect } from "vitest";
import { QUICK_ACTION_PRESS } from "./quick-action-press.js";

describe("quick-action press config", () => {
  it("defines a same-frame pressed state (scale + opacity, no delay)", () => {
    expect(QUICK_ACTION_PRESS.scale).toBe(0.97);
    expect(QUICK_ACTION_PRESS.pressedOpacity).toBe(0.7);
  });
});
