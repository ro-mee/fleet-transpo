import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildRouteUrl,
  decodePolyline,
  staticImageUrl,
  rasterTileUrl,
  trafficTileUrl,
  getPublicKey,
  getServerKey,
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
