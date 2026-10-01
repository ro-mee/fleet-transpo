import { describe, expect, it } from "vitest";
import { describeBookingNotify } from "@/lib/integration/booking-notify";

// The cancellation toast used to say "Booking will be notified" no matter what.
// Live, the gateway is the local MOCK, so the message promised an external
// notification that never happened. These cases pin the rule that replaced it:
// report what the outbound leg actually did, and never let the mock's
// `delivered: true` read as delivery.
describe("describeBookingNotify", () => {
  it("calls out MOCK mode even though the mock reports delivered", () => {
    const message = describeBookingNotify({ delivered: true, gateway: "mock" });
    expect(message).toContain("MOCK");
    expect(message).not.toMatch(/Booking was notified/);
  });

  it("confirms delivery only for a real gateway", () => {
    expect(describeBookingNotify({ delivered: true, gateway: "http" })).toBe("Booking was notified.");
  });

  it("reports a failed delivery as queued, not as sent", () => {
    const message = describeBookingNotify({ delivered: false, gateway: "http", reason: "delivery-failed" });
    expect(message).toContain("failed");
    expect(message).toContain("retry");
    expect(message).not.toMatch(/was notified\./);
  });

  it("explains that a locally-created request has nobody to notify", () => {
    const message = describeBookingNotify({ delivered: false, gateway: "mock", reason: "no-external-booking-id" });
    expect(message).toContain("no Booking reference");
    expect(message).not.toContain("MOCK");
  });

  it("says nothing was attempted when there is no result at all", () => {
    expect(describeBookingNotify(null)).toBe("No Booking notification was attempted.");
    expect(describeBookingNotify(undefined)).toBe("No Booking notification was attempted.");
  });

  it("treats an unknown gateway as real rather than silently claiming mock", () => {
    // Only the literal "mock" is the no-op gateway. A future/renamed
    // implementation must not be reported as mock by accident.
    expect(describeBookingNotify({ delivered: true, gateway: "http-v2" })).toBe("Booking was notified.");
  });
});
