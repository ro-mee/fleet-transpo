import { describe, it, expect } from "vitest";
import { QUICK_ACTION_ROUTES } from "./prefetch-routes.js";

describe("quick-action prefetch routes", () => {
  it("covers exactly the five shortcut targets", () => {
    expect(QUICK_ACTION_ROUTES).toEqual(["/work-schedule", "/submissions", "/incidents", "/fuel-report", "/end-duty"]);
  });

  it("includes the on-duty End Duty target, which is the only early clock-out path", () => {
    expect(QUICK_ACTION_ROUTES).toContain("/end-duty");
  });
});
