import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildRouteUrl,
  addressCandidateFromSearch,
  addressCandidatesFromSearch,
  centreFromSearch,
  decodePolyline,
  serverSearchUrl,
  staticImageUrl,
  rasterTileUrl,
  trafficTileUrl,
  getPublicKey,
  getServerKey,
  parseRouteSummary,
  fetchTomTomRoute,
} from "@/lib/tomtom";

beforeEach(() => {
  process.env.NEXT_PUBLIC_TOMTOM_API_KEY = "pub-key";
  process.env.TOMTOM_API_KEY = "srv-key";
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_TOMTOM_API_KEY;
  delete process.env.TOMTOM_API_KEY;
});

describe("key accessors", () => {
  it("reads the public and server keys from env", () => {
    expect(getPublicKey()).toBe("pub-key");
    expect(getServerKey()).toBe("srv-key");
  });
});

describe("rasterTileUrl", () => {
  it("points at TomTom basic tiles and embeds the public key", () => {
    const url = rasterTileUrl();
    expect(url).toContain("api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png");
    expect(url).toContain("key=pub-key");
    expect(url).toContain("tileSize=256");
  });
});

describe("trafficTileUrl", () => {
  it("points at the traffic flow overlay with the public key", () => {
    const url = trafficTileUrl();
    expect(url).toContain("api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png");
    expect(url).toContain("key=pub-key");
  });
});

describe("buildRouteUrl", () => {
  it("builds a computeRoute URL with the server key and lat,lon order", () => {
    const url = buildRouteUrl([14.6, 121.0], [14.7, 121.1]);
    expect(url).toContain("api.tomtom.com/routing/1/calculateRoute/");
    expect(url).toContain("14.6,121:14.7,121.1/json");
    expect(url).toContain("key=srv-key");
    expect(url).toContain("routeType=fastest");
  });

  it("preserves computeTravelTimeFor=all and adds traffic by default", () => {
    const url = buildRouteUrl([14.6, 121.0], [14.7, 121.1]);
    expect(url).toContain("computeTravelTimeFor=all");
    expect(url).toContain("traffic=true");
  });

  it("supports departAt and clamps maxAlternatives to 0-2", () => {
    const url = buildRouteUrl([14.6, 121.0], [14.7, 121.1], {
      departAt: "2026-09-07T08:15:00+08:00",
      maxAlternatives: 9,
    });
    expect(url).toContain("departAt=2026-09-07T00%3A15%3A00.000Z");
    expect(url).toContain("maxAlternatives=2");
    expect(buildRouteUrl([14.6, 121.0], [14.7, 121.1], { traffic: false })).not.toContain("traffic=true");
    expect(buildRouteUrl([14.6, 121.0], [14.7, 121.1], {})).not.toContain("maxAlternatives");
  });
});

describe("parseRouteSummary", () => {
  it("exposes traffic delay instead of dropping it", () => {
    const out = parseRouteSummary({
      summary: { lengthInMeters: 8200, travelTimeInSeconds: 1500, trafficDelayInSeconds: 300 },
    });
    expect(out).toMatchObject({ distanceKm: 8.2, durationMin: 25, trafficDelayMin: 5 });
  });

  it("defaults traffic delay to 0 and returns null without core fields", () => {
    expect(parseRouteSummary({ summary: { lengthInMeters: 1000, travelTimeInSeconds: 120 } }).trafficDelayMin).toBe(0);
    expect(parseRouteSummary({ summary: {} })).toBeNull();
    expect(parseRouteSummary(null)).toBeNull();
  });
});

describe("fetchTomTomRoute", () => {
  it("returns primary + alternatives with live provenance", async () => {
    const payload = {
      routes: [
        {
          summary: { lengthInMeters: 8200, travelTimeInSeconds: 1500, trafficDelayInSeconds: 300 },
          legs: [{ points: [{ latitude: 14.6, longitude: 121.0 }] }],
          guidance: { instructions: [{ message: "Turn left", instructionType: "TURN" }] },
        },
        { summary: { lengthInMeters: 9000, travelTimeInSeconds: 1600, trafficDelayInSeconds: 60 } },
      ],
    };
    const fetchImpl = async () => ({ ok: true, json: async () => payload });
    const out = await fetchTomTomRoute([14.6, 121.0], [14.7, 121.1], { fetchImpl, maxAlternatives: 1 });
    expect(out.provenance).toBe("live");
    expect(out.trafficDelayMin).toBe(5);
    expect(out.coordinates).toEqual([[14.6, 121.0]]);
    expect(out.instructions).toHaveLength(1);
    expect(out.alternatives).toHaveLength(1);
    expect(out.alternatives[0].durationMin).toBe(27);
  });

  it("fails open to null without a key or on provider errors", async () => {
    delete process.env.TOMTOM_API_KEY;
    expect(await fetchTomTomRoute([14.6, 121.0], [14.7, 121.1], { fetchImpl: async () => ({}) })).toBeNull();
    process.env.TOMTOM_API_KEY = "srv-key";
    expect(
      await fetchTomTomRoute([14.6, 121.0], [14.7, 121.1], { fetchImpl: async () => { throw new Error("down"); } })
    ).toBeNull();
    expect(
      await fetchTomTomRoute([14.6, 121.0], [14.7, 121.1], {
        fetchImpl: async () => ({ ok: true, json: async () => ({ routes: [] }) }),
      })
    ).toBeNull();
  });
});

describe("staticImageUrl", () => {
  it("builds a static image URL with markers and a centered view", () => {
    const url = staticImageUrl({
      center: [14.6, 121.0],
      markers: [
        { lat: 14.6, lng: 121.0, color: "D50000" },
        { lat: 14.7, lng: 121.1, color: "00AA00" },
      ],
    });
    expect(url).toContain("api.tomtom.com/map/1/staticimage");
    expect(url).toContain("key=pub-key");
    expect(url).toContain("center=121%2C14.6");
    expect(url).toContain("color%3A0xD50000");
    expect(url).toContain("color%3A0x00AA00");
  });
});

describe("serverSearchUrl", () => {
  it("points at the search endpoint and encodes the whole query as a path segment", () => {
    const url = serverSearchUrl("8572 Winding Creek Blvd, Santa Rosa City, 4026, Philippines");
    expect(url).toContain("api.tomtom.com/search/2/search/");
    expect(url).toContain(".json?");
    // Commas and spaces are both encoded: the query is one path segment, not
    // several, and a raw comma would terminate it.
    expect(url).toContain("8572%20Winding%20Creek%20Blvd%2C%20Santa%20Rosa");
    expect(url).not.toContain(" ");
  });

  it("scopes to PH and defaults to a single result", () => {
    const url = serverSearchUrl("Caloocan City Hall");
    expect(url).toContain("countrySet=PH");
    expect(url).toContain("limit=1");
    expect(new URL(url).searchParams.get("limit")).toBe("1");
  });

  it("carries the server key and never the public key", () => {
    const url = serverSearchUrl("Caloocan City Hall");
    expect(url).toContain("key=srv-key");
    expect(url).not.toContain("pub-key");
  });

  it("survives a missing query or a missing key without throwing", () => {
    delete process.env.TOMTOM_API_KEY;
    delete process.env.NEXT_PUBLIC_TOMTOM_API_KEY;
    expect(serverSearchUrl(null)).toContain("api.tomtom.com/search/2/search/.json");
    expect(serverSearchUrl("x")).not.toContain("key=");
  });
});

describe("centreFromSearch", () => {
  /**
   * A response shaped the way TomTom's `/search/2/search` really answers.
   * `span` is the TOTAL width of the viewport box in degrees — each corner is
   * offset by half of it, so `span` is what the zoom is derived from.
   */
  const payloadWith = (span) => ({
    results: [
      {
        type: "Point Address",
        position: { lat: 14.2811, lon: 121.4117 },
        viewport: {
          topLeftPoint: { lat: 14.2811 + span / 2, lon: 121.4117 - span / 2 },
          btmRightPoint: { lat: 14.2811 - span / 2, lon: 121.4117 + span / 2 },
        },
      },
    ],
  });

  it("reads the position and derives the zoom from the provider's own viewport", () => {
    // A ~1.1km box is a barangay-scale match: wide enough to need zoom 15.
    expect(centreFromSearch(payloadWith(0.01))).toEqual({
      lat: 14.2811,
      lng: 121.4117,
      zoom: 15,
    });
  });

  it("clamps at both ends rather than trusting the viewport", () => {
    // A doorway-tight box would compute zoom 17. It must not exceed PIN_ZOOM.
    expect(centreFromSearch(payloadWith(0.002)).zoom).toBe(16);
    // A province-scale box would compute zoom 9 — worse than useless to move
    // for, and below the floor.
    expect(centreFromSearch(payloadWith(0.5)).zoom).toBe(13);
  });

  it("handles reversed corners, since the span is an absolute difference", () => {
    const flipped = {
      results: [
        {
          position: { lat: 14.2811, lon: 121.4117 },
          viewport: {
            topLeftPoint: { lat: 14.2811 - 0.005, lon: 121.4117 + 0.005 },
            btmRightPoint: { lat: 14.2811 + 0.005, lon: 121.4117 - 0.005 },
          },
        },
      ],
    };
    expect(centreFromSearch(flipped)).toEqual({ lat: 14.2811, lng: 121.4117, zoom: 15 });
  });

  it("falls back to a plain zoom when the provider sends no usable viewport", () => {
    expect(centreFromSearch({ results: [{ position: { lat: 14.2811, lon: 121.4117 } }] }).zoom).toBe(14);
    expect(
      centreFromSearch({
        results: [{ position: { lat: 14.2811, lon: 121.4117 }, viewport: { topLeftPoint: {} } }],
      }).zoom
    ).toBe(14);
  });

  it("returns null for every shape of no-answer rather than throwing", () => {
    expect(centreFromSearch(null)).toBeNull();
    expect(centreFromSearch({})).toBeNull();
    expect(centreFromSearch({ results: [] })).toBeNull();
    expect(centreFromSearch({ results: [{ position: {} }] })).toBeNull();
    expect(centreFromSearch({ results: [{ position: { lat: "north", lon: 121 } }] })).toBeNull();
    expect(centreFromSearch({ results: [{ position: { lat: 120, lon: 121 } }] })).toBeNull();
    expect(centreFromSearch({ results: [{ position: { lat: 14, lon: 200 } }] })).toBeNull();
  });
});

describe("addressCandidateFromSearch", () => {
  it("returns only bounded candidate metadata and keeps its point separate from a pin", () => {
    const candidate = addressCandidateFromSearch({
      results: [{
        position: { lat: 14.2811, lon: 121.4117 },
        address: { freeformAddress: "8572 Winding Creek Boulevard" },
        type: "Point Address",
        matchConfidence: { score: 0.91 },
      }],
    });
    expect(candidate).toMatchObject({
      centre: { lat: 14.2811, lng: 121.4117 },
      label: "8572 Winding Creek Boulevard",
      precision: "Point Address",
      confidence: 0.91,
    });
  });

  it("does not turn a malformed result into a candidate", () => {
    expect(addressCandidateFromSearch({ results: [{ position: { lat: 200, lon: 121 } }] })).toBeNull();
  });

  it("keeps multiple results as separate candidates for an explicit choice", () => {
    const candidates = addressCandidatesFromSearch({
      results: [
        { position: { lat: 14.2, lon: 121.1 }, address: { freeformAddress: "Main Street" } },
        { position: { lat: 14.3, lon: 121.2 }, address: { freeformAddress: "Main Road" } },
      ],
    });
    expect(candidates.map((candidate) => candidate.label)).toEqual(["Main Street", "Main Road"]);
    expect(addressCandidatesFromSearch({ results: [{ position: { lat: 200, lon: 121 } }] })).toEqual([]);
  });
});

describe("decodePolyline", () => {
  it("decodes a google-encoded polyline into [lat, lng] pairs", () => {
    // Hand-encoded: (0,0) -> 0<<1 = 0 -> 0b0 + 63 = '?' for lat and lng.
    // Two consecutive (0,0) points are "????".
    expect(decodePolyline("????")).toEqual([[0, 0], [0, 0]]);
  });

  it("returns [] for empty input", () => {
    expect(decodePolyline("")).toEqual([]);
    expect(decodePolyline(null)).toEqual([]);
  });

  it("decodes a real street route", () => {
    // A canonical polyline sample from the Google polyline docs:
    // _p~iF~ps|U_ulLnnqC_mqNvxq`@ decodes to (38.5,-120.2), (40.7,-120.95),
    // (43.252,-126.453).
    const out = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(out.length).toBe(3);
    for (const p of out) {
      expect(p.length).toBe(2);
      expect(Number.isFinite(p[0])).toBe(true);
      expect(Number.isFinite(p[1])).toBe(true);
    }
    expect(out[0][0]).toBeCloseTo(38.5, 4);
    expect(out[0][1]).toBeCloseTo(-120.2, 4);
    expect(out[2][0]).toBeCloseTo(43.252, 3);
    expect(out[2][1]).toBeCloseTo(-126.453, 3);
  });
});
