import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISPATCH_STATUS } from "@/lib/constants";
import {
  EVENT_KIND,
  dispatchToEvent,
  isPendingReassignment,
  unassignedDispatchClusters,
} from "./calendar";

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

describe("dispatch urgency markers", () => {
  const now = new Date("2026-10-03T04:00:00.000Z");

  beforeEach(() => vi.useFakeTimers({ now }));
  afterEach(() => vi.useRealTimers());

  it("marks assigned past pickups with no recorded departure", () => {
    const event = dispatchToEvent(mk({
      vehicle_id: 3,
      driver_id: 8,
      scheduled_departure: new Date(+now - 1).toISOString(),
    }));
    expect(event.noStartRecorded).toBe(true);
    expect(event.isStartingSoon).toBe(false);
  });

  it("includes a departure due now and excludes started or unassigned records", () => {
    const dueNow = dispatchToEvent(mk({
      vehicle_id: 3,
      driver_id: 8,
      scheduled_departure: now.toISOString(),
    }));
    const started = dispatchToEvent(mk({
      vehicle_id: 3,
      driver_id: 8,
      actual_departure: new Date(+now - 1).toISOString(),
      scheduled_departure: new Date(+now - 1).toISOString(),
    }));
    const unassigned = dispatchToEvent(mk({
      vehicle_id: 3,
      driver_id: null,
      scheduled_departure: new Date(+now - 1).toISOString(),
    }));
    expect(dueNow.isStartingSoon).toBe(true);
    expect(dueNow.noStartRecorded).toBe(true);
    expect(started.noStartRecorded).toBe(false);
    expect(unassigned.noStartRecorded).toBe(false);
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

describe("unassigned dispatch clusters", () => {
  const day = new Date(2026, 9, 9);
  const at = (hour) => new Date(2026, 9, 9, hour).toISOString();
  const dispatch = (id, start, end, over = {}) =>
    dispatchToEvent(mk({
      dispatch_id: id,
      dispatch_number: `DSP-${id}`,
      scheduled_departure: at(start),
      scheduled_arrival: at(end),
      ...over,
    }));

  it("clusters identical and partially overlapping unassigned trips while preserving separate trips", () => {
    const events = [
      dispatch(1, 8, 10, { driver_id: null, vehicle_id: 3 }),
      dispatch(2, 8, 10, { driver_id: null, vehicle_id: 4 }),
      dispatch(3, 9, 11, { driver_id: null, vehicle_id: 5 }),
      dispatch(4, 12, 13, { driver_id: null, vehicle_id: 6 }),
      dispatch(5, 8, 10, { driver_id: 7, vehicle_id: 8 }),
      {
        id: "maintenance-1",
        kind: EVENT_KIND.MAINTENANCE,
        start: new Date(2026, 9, 9, 8),
        end: new Date(2026, 9, 9, 10),
        driverId: null,
      },
    ];

    const clusters = unassignedDispatchClusters(events, day, "driver");

    expect(clusters).toHaveLength(2);
    expect(clusters[0].isCluster).toBe(true);
    expect(clusters[0].events.map((event) => event.dispatchId)).toEqual([1, 2, 3]);
    expect(clusters[0].count + clusters[1].count).toBe(4);
    expect(clusters[1].isCluster).toBe(false);
    expect(clusters[1].primaryEvent.dispatchId).toBe(4);
  });

  it("filters by the missing lane resource", () => {
    const events = [
      dispatch(1, 8, 9, { driver_id: null, vehicle_id: 3 }),
      dispatch(2, 8, 9, { driver_id: 7, vehicle_id: null }),
      dispatch(3, 8, 9, { driver_id: null, vehicle_id: null }),
    ];

    const missingDrivers = unassignedDispatchClusters(events, day, "driver");
    const missingVehicles = unassignedDispatchClusters(events, day, "vehicle");

    expect(missingDrivers[0].events.map((event) => event.dispatchId)).toEqual([1, 3]);
    expect(missingVehicles[0].events.map((event) => event.dispatchId)).toEqual([2, 3]);
  });
});
