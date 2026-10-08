import { describe, expect, it } from "vitest";
import {
  CARGO_HANDLING_DEFAULTS,
  cargoHandlingMinutes,
  cargoServiceEnd,
} from "@/lib/scheduling/cargo-schedule";

const PICKUP = "2026-10-08T02:00:00Z";

describe("cargo booking schedule", () => {
  it("adds loading, securement, unloading and turnaround to the drive estimate", () => {
    expect(CARGO_HANDLING_DEFAULTS).toMatchObject({
      loadingMin: 30,
      securementMin: 15,
      unloadingMin: 30,
      turnaroundMin: 15,
      provenance: "fleetops-cargo-handling-policy-v1",
    });
    expect(cargoHandlingMinutes()).toBe(90);
    const r = cargoServiceEnd({ pickup: PICKUP, scheduledArrival: null, driveMinutes: 60 });
    expect(r.end?.toISOString()).toBe("2026-10-08T04:30:00.000Z");
    expect(r.basis).toBe("handling-buffered-estimate");
    expect(r.handlingMin).toBe(90);
    expect(r.provenance).toBe("fleetops-cargo-handling-policy-v1");
  });

  it("never creates a zero-length booking from a null arrival", () => {
    const r = cargoServiceEnd({ pickup: PICKUP, scheduledArrival: null, driveMinutes: 0 });
    expect(r.end.getTime()).toBeGreaterThan(new Date(PICKUP).getTime());
    const noDrive = cargoServiceEnd({ pickup: PICKUP, scheduledArrival: null, driveMinutes: null });
    expect(noDrive.end).toBeNull();
    expect(noDrive.basis).toBe("unknown-drive");
  });

  it("preserves ample plans and rejects deficient explicit plans", () => {
    const roomy = cargoServiceEnd({ pickup: PICKUP, scheduledArrival: "2026-10-08T06:00:00Z", driveMinutes: 60 });
    expect(roomy.end?.toISOString()).toBe("2026-10-08T06:00:00.000Z");
    expect(roomy.basis).toBe("scheduled");
    expect(roomy.shortfallMin).toBe(0);

    const tight = cargoServiceEnd({ pickup: PICKUP, scheduledArrival: "2026-10-08T04:00:00Z", driveMinutes: 60 });
    expect(tight.end).toBeNull();
    expect(tight.basis).toBe("insufficient-arrival");
    expect(tight.shortfallMin).toBe(30);
  });

  it("fails closed on invalid input instead of inventing a window", () => {
    expect(cargoServiceEnd({ pickup: "not-a-date", scheduledArrival: null, driveMinutes: 60 }).end).toBeNull();
    expect(cargoServiceEnd({ pickup: null, scheduledArrival: null, driveMinutes: 60 }).basis).toBe("unknown-pickup");
    // An arrival at or before pickup is not a window at all.
    const r = cargoServiceEnd({ pickup: PICKUP, scheduledArrival: PICKUP, driveMinutes: 60 });
    expect(r.end).toBeNull();
    expect(r.basis).toBe("invalid-arrival");
  });

  it("does not treat an explicit arrival as proof of unknown driving time", () => {
    const r = cargoServiceEnd({ pickup: PICKUP, scheduledArrival: "2026-10-08T06:00:00Z", driveMinutes: null });
    expect(r.end).toBeNull();
    expect(r.basis).toBe("unknown-drive");
  });

  it("does not accept invalid buffers just because an explicit arrival exists", () => {
    expect(cargoServiceEnd({ pickup: PICKUP, scheduledArrival: "2026-10-08T06:00:00Z", driveMinutes: 60,
      buffers: { loadingMin: NaN } }).end).toBeNull();
  });

  it.each([null, "", " "])("does not turn an unknown handling buffer %s into zero", (loadingMin) => {
    expect(cargoHandlingMinutes({ loadingMin })).toBeNull();
    expect(cargoServiceEnd({ pickup: PICKUP, driveMinutes: 60, buffers: { loadingMin } }).end).toBeNull();
  });

  it("accepts configured buffers with provenance instead of the defaults", () => {
    const r = cargoServiceEnd({
      pickup: PICKUP,
      scheduledArrival: null,
      driveMinutes: 60,
      buffers: { loadingMin: 45, securementMin: 20, unloadingMin: 40, turnaroundMin: 15, provenance: "site-survey-makati-2026-10" },
    });
    expect(r.handlingMin).toBe(120);
    expect(r.provenance).toBe("site-survey-makati-2026-10");
    expect(r.end?.toISOString()).toBe("2026-10-08T05:00:00.000Z");
  });
});
