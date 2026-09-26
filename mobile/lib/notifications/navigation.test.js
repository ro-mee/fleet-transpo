import { describe, it, expect } from "vitest";
import { mobileNotificationTarget } from "./navigation";

describe("mobileNotificationTarget", () => {
  it("sends an End Duty reminder to the End Duty screen, not the Home tab", () => {
    // The whole value of the reminder is that the report can be filed from the
    // tap. Landing on Home leaves the driver to find the card themselves — one
    // more step on the night they already forgot once.
    expect(mobileNotificationTarget({ reference_type: "duty", reference_id: 20260924 }))
      .toBe("/end-duty");
  });

  it("keeps the pre-existing destinations", () => {
    expect(mobileNotificationTarget({ reference_type: "dispatch", reference_id: 1 })).toBe("/");
    expect(mobileNotificationTarget({ reference_type: "trip", reference_id: 1 })).toBe("/");
    expect(mobileNotificationTarget({ reference_type: "driver", reference_id: 9 })).toBe("/profile");
    expect(mobileNotificationTarget({ reference_type: "vehicle", reference_id: 3 })).toBe("/profile");
    expect(mobileNotificationTarget({ reference_type: "incident", reference_id: 7 })).toBe("/incident/7");
    expect(mobileNotificationTarget({ reference_type: "incident" })).toBe("/submissions");
    expect(mobileNotificationTarget({ reference_type: "fuel" })).toBeNull();
    expect(mobileNotificationTarget({})).toBeNull();
  });
});
