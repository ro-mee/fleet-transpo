import { describe, it, expect } from "vitest";
import { computeDepartureWindow } from "@/lib/scheduling/departure-window";

const PICKUP = "2026-08-14T00:00:00.000Z"; // 8:00 AM PHT

describe("computeDepartureWindow", () => {
  it("8:00 pickup − 12 ETA − 10 buffer → 7:38 recommended; −10 allowance → 7:28 earliest", () => {
    const w = computeDepartureWindow({
      pickup: PICKUP,
      etaMinutes: 12,
      departureBufferMinutes: 10,
      earlyStartAllowanceMinutes: 10,
    });
    expect(w.recommended_departure.toISOString()).toBe("2026-08-13T23:38:00.000Z"); // 7:38 AM PHT
    expect(w.earliest_start.toISOString()).toBe("2026-08-13T23:28:00.000Z"); // 7:28 AM PHT
    expect(w.latest_start.toISOString()).toBe(PICKUP);
    expect(w.eta_minutes).toBe(12);
  });

  it("uses a zero buffer/allowance when configured values are junk", () => {
    const w = computeDepartureWindow({
      pickup: PICKUP,
      etaMinutes: 12,
      departureBufferMinutes: -5,
      earlyStartAllowanceMinutes: "nope",
    });
    expect(w.recommended_departure.toISOString()).toBe("2026-08-13T23:48:00.000Z"); // 12 ETA only
    expect(w.earliest_start.toISOString()).toBe("2026-08-13T23:48:00.000Z"); // no allowance
  });

  it("fails open (nulls) when pickup is missing", () => {
    const w = computeDepartureWindow({ pickup: null, etaMinutes: 5 });
    expect(w.recommended_departure).toBeNull();
    expect(w.earliest_start).toBeNull();
    expect(w.latest_start).toBeNull();
    expect(w.eta_minutes).toBeNull();
  });

  it("fails open when ETA is unknown — keeps latest_start only", () => {
    const w = computeDepartureWindow({ pickup: PICKUP, etaMinutes: null });
    expect(w.recommended_departure).toBeNull();
    expect(w.earliest_start).toBeNull();
    expect(w.latest_start.toISOString()).toBe(PICKUP);
    expect(w.eta_minutes).toBeNull();
  });

  it("fails open on an unparseable pickup", () => {
    const w = computeDepartureWindow({ pickup: "nope", etaMinutes: 5 });
    expect(w.recommended_departure).toBeNull();
    expect(w.earliest_start).toBeNull();
  });
});
