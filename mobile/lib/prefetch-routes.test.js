import { describe, it, expect } from "vitest";
import { QUICK_ACTION_ROUTES } from "./prefetch-routes.js";

describe("quick-action prefetch routes", () => {
  it("covers exactly the four shortcut targets", () => {
    expect(QUICK_ACTION_ROUTES).toEqual(["/work-schedule", "/submissions", "/incidents", "/fuel-report"]);
  });
});
