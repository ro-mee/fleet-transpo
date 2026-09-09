// Tests for the shared GPS ping advisory block (geofence / monitor / weather)
// that both ingest POST handlers return to the mobile poster.
//
// Contract (mirrors the routes' guarantee): the GPS write it describes has
// ALREADY happened — so a failure in any advisory must never surface as an
// error to the poster. Monitor and weather fail open to null; a throwing
// monitor (mocked) is caught exactly as the routes previously caught it.
import { describe, it, expect, vi } from "vitest";

// The services pull in db/env transitively; stub the heavy dependencies so
// this test exercises only the wiring, not the database.
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/services/trip-geofence.service", () => ({
  evaluatePingGeofence: vi.fn(async () => ({ geofence_state: "unknown" })),
}));
vi.mock("@/services/live-trip-monitor.service", () => ({
  evaluatePingMonitor: vi.fn(async () => null),
}));
vi.mock("@/lib/weather", () => ({
  getCurrentWeather: vi.fn(async () => null),
  getCurrentConditions: vi.fn(async () => null),
}));

import { buildPingAdvisories } from "./ping-advisories.service";
import { evaluatePingMonitor } from "@/services/live-trip-monitor.service";
import { getCurrentConditions } from "@/lib/weather";

const trip = { trip_id: 7, vehicle_id: 3, driver_id: 5 };
const fix = { latitude: 14.6, longitude: 121.0, accuracy: 12 };
const query = vi.fn();

describe("buildPingAdvisories", () => {
  it("returns geofence, monitor, and weather together", async () => {
    evaluatePingMonitor.mockResolvedValueOnce({ live: true, risk: "NORMAL" });
    getCurrentConditions.mockResolvedValueOnce({ temperatureC: 28.4, code: 61, label: "Light Rain", placeName: "Quezon City" });
    const out = await buildPingAdvisories(trip, fix, query);
    expect(out).toEqual({
      geofence: { geofence_state: "unknown" },
      monitor: { live: true, risk: "NORMAL" },
      weather: { temperatureC: 28.4, code: 61, label: "Light Rain", placeName: "Quezon City" },
    });
    // The fix coordinates reach the weather lookup — same position the driver
    // already posted, no new location source.
    expect(getCurrentConditions).toHaveBeenCalledWith(14.6, 121.0);
  });

  it("a throwing monitor fails open to null — the GPS write is already stored", async () => {
    evaluatePingMonitor.mockRejectedValueOnce(new Error("monitor exploded"));
    const out = await buildPingAdvisories(trip, fix, query);
    expect(out.monitor).toBeNull();
    expect(out.weather).not.toBeNull; // other advisories unaffected
  });

  it("a weather failure fails open to null and never rejects", async () => {
    getCurrentConditions.mockRejectedValueOnce(new Error("provider down"));
    await expect(buildPingAdvisories(trip, fix, query)).resolves.toMatchObject({
      weather: null,
    });
  });
});
