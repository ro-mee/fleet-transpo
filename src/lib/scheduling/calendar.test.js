import { describe, expect, it } from "vitest";
import { DISPATCH_STATUS } from "@/lib/constants";
import { EVENT_KIND, dispatchToEvent, isPendingReassignment } from "./calendar";

function mk(over = {}) {
  return {
    dispatch_id: 1,
    dispatch_number: "DSP-1",
    scheduled_departure: "2026-09-23T08:00:00Z",
    scheduled_arrival: "2026-09-23T09:00:00Z",
    status: DISPATCH_STATUS.SCHEDULED,
    ...over,
  };
}

describe("dispatchToEvent tone", () => {
  it("maps every dispatch status to an explicit tone", () => {
    const tone = (status) => dispatchToEvent(mk({ status }))?.tone;
    expect(tone(DISPATCH_STATUS.SCHEDULED)).toBe("info");
    expect(tone(DISPATCH_STATUS.IN_PROGRESS)).toBe("warning");
    expect(tone(DISPATCH_STATUS.COMPLETED)).toBe("success");
    expect(tone(DISPATCH_STATUS.CANCELLED)).toBe("secondary");
    // Pending Reassignment must NEVER fall through to Cancelled's secondary.
    expect(tone(DISPATCH_STATUS.PENDING_REASSIGNMENT)).toBe("danger");
  });

  it("carries the request id for reservation deep-links", () => {
    const event = dispatchToEvent(
      mk({ transportation_requests: { request_id: 42, guest_name: "Ada" } })
    );
    expect(event.requestId).toBe(42);
    expect(event.guestName).toBe("Ada");
  });
});

describe("isPendingReassignment", () => {
  it("is true only for dispatch events in Pending Reassignment", () => {
    const re = dispatchToEvent(mk({ status: DISPATCH_STATUS.PENDING_REASSIGNMENT }));
    const ok = dispatchToEvent(mk({ status: DISPATCH_STATUS.SCHEDULED }));
    expect(re.kind).toBe(EVENT_KIND.DISPATCH);
    expect(isPendingReassignment(re)).toBe(true);
    expect(isPendingReassignment(ok)).toBe(false);
    expect(isPendingReassignment(null)).toBe(false);
    expect(isPendingReassignment({ kind: EVENT_KIND.LEAVE, status: DISPATCH_STATUS.PENDING_REASSIGNMENT })).toBe(false);
  });
});
