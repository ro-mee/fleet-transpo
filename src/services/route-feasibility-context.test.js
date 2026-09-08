import { describe, it, expect } from "vitest";
import {
  buildPairFeasibility,
  attachPairFeasibility,
  provenanceOfEstimate,
} from "@/services/route-feasibility-context.service";

// Offline stubs: no TomTom key in test env, so every live resolve fails open
// to the haversine fallback and every DB lookup returns no rows.
const db = { query: async () => ({ rows: [] }) };

const REQUEST = {
  pickup_location: "CoCo Star Hotel",
  dropoff_location: "Makati",
  pickup_datetime: "2026-09-07T09:00:00+08:00",
  passenger_count: 4,
};
const NOW = new Date("2026-09-07T08:15:00+08:00");
const ESTIMATE = { distanceKm: 6.5, durationMin: 42, basis: "Stored TomTom estimate", source: "TomTom" };

const DRIVER = {
  driver_id: 7,
  _position_lat: 14.53,
  _position_lng: 121.02,
  _pickup_distance_km: 3.1,
  _deadhead_minutes_routed: 19,
  _deadhead_provenance: "live",
};

describe("provenanceOfEstimate", () => {
  it("labels snapshots, live calls, and fallbacks honestly", () => {
    expect(provenanceOfEstimate(ESTIMATE)).toBe("snapshot");
    expect(provenanceOfEstimate({ durationMin: 30, basis: "TomTom", source: "TomTom" })).toBe("live");
    expect(provenanceOfEstimate({ durationMin: 30, basis: "metro average", source: "Legacy / Unknown" })).toBe("fallback");
    expect(provenanceOfEstimate(null)).toBe("unknown");
  });
});

describe("buildPairFeasibility", () => {
  it("returns the SAFE acceptance shape for one pair", async () => {
    const out = await buildPairFeasibility(db, {
      request: REQUEST,
      passengerMinutes: 42,
      passengerProvenance: "snapshot",
      driverRow: DRIVER,
      pickupCoords: { lat: 14.5159, lng: 120.9953 },
      destinationCoords: { lat: 14.5547, lng: 121.0244 },
      vehicleId: 1,
      driverId: 7,
      now: NOW,
    });
    expect(out.verdict).toBe("SAFE");
    expect(out.deadheadMin).toBe(19); // shortlist routed minutes preferred
    expect(out.passengerMin).toBe(42);
    expect(out.pickupBufferMin).toBe(16);
    expect(out.nextPickupAt).toBeNull(); // no assigned dispatch in stub DB
    expect(out.provenance).toMatchObject({ deadhead: "live", passenger: "snapshot" });
    expect(typeof out.requiredDeparture).toBe("string");
    expect(out.reasons.length).toBeGreaterThan(0);
  });

  it("fails open to UNKNOWN when the driver position is unknown", async () => {
    const out = await buildPairFeasibility(db, {
      request: REQUEST,
      passengerMinutes: 42,
      passengerProvenance: "snapshot",
      driverRow: { driver_id: 9 },
      pickupCoords: null,
      destinationCoords: null,
      vehicleId: 2,
      driverId: 9,
      now: NOW,
    });
    expect(out.verdict).toBe("UNKNOWN");
  });
});

describe("attachPairFeasibility", () => {
  const rec = () => ({
    pair: {
      recommended: { vehicle_id: 1, driver_id: 7, score: 92 },
      alternate: { vehicle_id: 2, driver_id: 8, score: 81 },
      candidates: [
        { vehicle_id: 1, driver_id: 7, score: 92 },
        { vehicle_id: 2, driver_id: 8, score: 81 },
        { vehicle_id: 3, driver_id: 9, score: 70 },
      ],
    },
  });

  it("attaches feasibility to recommended + alternate + top candidates", async () => {
    const recommendation = rec();
    await attachPairFeasibility(db, {
      request: REQUEST,
      estimate: ESTIMATE,
      recommendation,
      drivers: [DRIVER],
      now: NOW,
    });
    expect(recommendation.pair.recommended.feasibility.verdict).toBe("SAFE");
    expect(recommendation.pair.alternate.feasibility.verdict).toBe("UNKNOWN"); // no driver row
    expect(recommendation.pair.candidates[0].feasibility.verdict).toBe("SAFE");
    expect(recommendation.pair.candidates[2].feasibility.verdict).toBe("UNKNOWN");
  });

  it("passes the payload through untouched when there is nothing to score", async () => {
    const recommendation = { pair: null };
    await attachPairFeasibility(db, { request: REQUEST, estimate: ESTIMATE, recommendation, drivers: [], now: NOW });
    expect(recommendation.pair).toBeNull();
  });
});
