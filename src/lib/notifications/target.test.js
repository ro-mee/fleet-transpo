import { describe, it, expect } from "vitest";
import { getNotificationHref } from "./target";

describe("getNotificationHref", () => {
  it("gives a driver a destination for a duty reminder", () => {
    expect(getNotificationHref({ reference_type: "duty", reference_id: 20260924 }, "driver"))
      .toBe("/driver");
  });

  it("leaves staff without a duty destination — the reminder is driver-only", () => {
    // A staff role has no duty of their own to end, so this must resolve to
    // null and the tap must fall through to marking read.
    expect(getNotificationHref({ reference_type: "duty", reference_id: 20260924 }, "admin"))
      .toBeNull();
  });

  it("still resolves a staff role's own routes — the null above is about duty, not roles", () => {
    expect(getNotificationHref({ reference_type: "incident", reference_id: 1 }, "admin"))
      .toBe("/incidents");
    expect(getNotificationHref({ reference_type: "leave_request", reference_id: 1 }, "driver"))
      .toBe("/driver/schedule");
  });

  it("resolves a mechanic vehicle tap to null — no /mechanic/vehicles/:id route exists", () => {
    // Mark-read fallback, matching the file's null convention: a tap must
    // fall through to marking read instead of triggering a guard redirect.
    expect(getNotificationHref({ reference_type: "vehicle", reference_id: 7 }, "mechanic"))
      .toBeNull();
  });

  it("rejects cross-role explicit links instead of bypassing the guard", () => {
    expect(getNotificationHref({ reference_type: "maintenance", reference_id: 5, link: "/fleet/vehicles/5" }, "mechanic"))
      .toBeNull();
    expect(getNotificationHref({ reference_type: "mechanic_maintenance", reference_id: 5, link: "/mechanic/work-orders/5" }, "mechanic"))
      .toBe("/mechanic/work-orders/5");
  });
});
