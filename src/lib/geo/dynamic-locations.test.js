import { describe, it, expect, beforeEach } from "vitest";
import {
  buildHotelEntry,
  buildAirportEntries,
  resolveCoordinates,
  estimateTrip,
  resolveHotelBase,
} from "@/lib/geo/distance";
import {
  getHotelContext,
  getActiveLocations,
  resolveCoordinatesWithDb,
  clearDynamicLocationCache,
} from "@/lib/geo/dynamic-locations";

const HOTEL = { hotel_name: "Sunrise Bay Hotel", latitude: 14.6, longitude: 121.0 };
const AIRPORTS = [
  { name: "Clark Terminal - Arrivals", latitude: 15.18, longitude: 120.56 },
  { name: "Clark Terminal - Departures", latitude: 15.18, longitude: 120.56 },
];

function memDb({ hotel = HOTEL, locations = [] } = {}) {
  return {
    query: async (sql) => {
      if (sql.includes("system_settings")) return { rows: hotel ? [{ setting_value: hotel }] : [] };
      if (sql.includes("FROM locations")) {
        return {
          rows: locations.map((l) => ({ name: l.name, latitude: l.lat, longitude: l.lng })),
        };
      }
      return { rows: [] };
    },
  };
}

describe("buildHotelEntry — no brand literal", () => {
  it("matches the configured hotel name, not CoCo", () => {
    const entry = buildHotelEntry(HOTEL);
    expect(entry.match.test("Sunrise Bay Hotel")).toBe(true);
    expect(entry.match.test("CoCo Star")).toBe(false);
    expect(entry.label).toBe("Sunrise Bay Hotel");
  });

  it("returns null without usable hotel", () => {
    expect(buildHotelEntry(null)).toBeNull();
    expect(buildHotelEntry({ hotel_name: "", latitude: 1, longitude: 1 })).toBeNull();
  });
});

describe("buildAirportEntries — DB wins, seeds fall back", () => {
  it("uses supplied terminals", () => {
    const entries = buildAirportEntries(AIRPORTS);
    expect(entries).toHaveLength(2);
    expect(entries[0].label).toBe("Clark Terminal - Arrivals");
  });

  it("falls back to seed defaults when empty", () => {
    const entries = buildAirportEntries([]);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].label).toMatch(/NAIA/);
  });
});

describe("resolveCoordinates with overrides", () => {
  it("resolves dynamic hotel name and coords", () => {
    const out = resolveCoordinates("Sunrise Bay Hotel", { hotel: HOTEL, airportLocations: AIRPORTS });
    expect(out).toMatchObject({ label: "Sunrise Bay Hotel", lat: 14.6, lng: 121.0 });
  });

  it("resolves dynamic airport terminal", () => {
    const out = resolveCoordinates("Clark Terminal - Arrivals", { hotel: HOTEL, airportLocations: AIRPORTS });
    expect(out).toMatchObject({ label: "Clark Terminal - Arrivals" });
  });

  it("legacy callers keep seed behaviour", () => {
    const out = resolveCoordinates("NAIA Terminal 2 - Arrivals");
    expect(out).toMatchObject({ label: "NAIA Terminal 2 - Arrivals" });
  });
});

describe("resolveHotelBase", () => {
  it("prefers DB hotel coords", () => {
    expect(resolveHotelBase(HOTEL)).toEqual({ lat: 14.6, lng: 121.0 });
  });
});

describe("estimateTrip with overrides", () => {
  it("labels dynamic hotel pair honestly", () => {
    const out = estimateTrip("Sunrise Bay Hotel", "Clark Terminal - Arrivals", {
      hotel: HOTEL,
      airportLocations: AIRPORTS,
    });
    expect(out.confidence).toBe("high");
    expect(out.basis).toContain("Sunrise Bay Hotel");
  });
});

describe("resolveCoordinatesWithDb — registry first", () => {
  beforeEach(() => clearDynamicLocationCache());

  it("prefers the registry row over the gazetteer", async () => {
    const db = memDb({
      locations: [{ name: "Harbor Point", lat: 14.8, lng: 120.9 }],
    });
    const out = await resolveCoordinatesWithDb(db, "Harbor Point");
    expect(out).toMatchObject({ label: "Harbor Point", source: "canonical", lat: 14.8 });
  });

  it("resolves the configured hotel by name", async () => {
    const db = memDb({ locations: [] });
    const out = await resolveCoordinatesWithDb(db, "Sunrise Bay Hotel");
    expect(out).toMatchObject({ source: "hotel", label: "Sunrise Bay Hotel" });
  });

  it("returns null for unknown text (honest unknown)", async () => {
    const db = memDb({ hotel: null, locations: [] });
    const out = await resolveCoordinatesWithDb(db, "Nowhere Fictional XYZ 999");
    expect(out).toBeNull();
  });

  it("caches hotel + locations reads", async () => {
    let calls = 0;
    const db = { query: async () => { calls += 1; return { rows: [] }; } };
    await getHotelContext(db);
    await getHotelContext(db);
    await getActiveLocations(db);
    await getActiveLocations(db);
    expect(calls).toBe(2);
  });
});
