import { describe, it, expect, beforeEach } from "vitest";
import {
  buildRouteCacheKey,
  getCachedRoute,
  setCachedRoute,
  clearRouteCache,
  ROUTE_CACHE_BUCKET_MIN,
} from "@/lib/routing/route-cache";

const O = [14.5159, 120.9953];
const D = [14.5086, 121.0194];

beforeEach(() => clearRouteCache());

describe("buildRouteCacheKey", () => {
  it("rounds near-identical coordinates to the same key", () => {
    const a = buildRouteCacheKey(O, D, { departAt: "2026-09-07T08:15:00+08:00" });
    const b = buildRouteCacheKey([14.51591, 120.99531], [14.50861, 121.01941], {
      departAt: "2026-09-07T08:15:00+08:00",
    });
    expect(a).toBe(b);
  });

  it("buckets departures within the same window together", () => {
    const a = buildRouteCacheKey(O, D, { departAt: "2026-09-07T08:12:00+08:00" });
    const b = buildRouteCacheKey(O, D, { departAt: "2026-09-07T08:18:00+08:00" });
    expect(a).toBe(b);
    expect(ROUTE_CACHE_BUCKET_MIN).toBe(10);
  });

  it("separates different departure windows and alternative counts", () => {
    const a = buildRouteCacheKey(O, D, { departAt: "2026-09-07T08:12:00+08:00" });
    const b = buildRouteCacheKey(O, D, { departAt: "2026-09-07T08:25:00+08:00" });
    expect(a).not.toBe(b);
    expect(buildRouteCacheKey(O, D, { maxAlternatives: 1 })).not.toBe(buildRouteCacheKey(O, D, {}));
  });

  it("returns null for invalid coordinates", () => {
    expect(buildRouteCacheKey(null, D)).toBeNull();
    expect(buildRouteCacheKey(O, [999, 0])).toBeNull();
    expect(buildRouteCacheKey(O, D)).not.toBeNull();
  });
});

describe("get/setCachedRoute", () => {
  it("serves a cached route with cached provenance", () => {
    const value = { durationMin: 19, distanceKm: 8.2, provenance: "live" };
    setCachedRoute(O, D, value, { departAt: "2026-09-07T08:15:00+08:00" });
    const hit = getCachedRoute(O, D, { departAt: "2026-09-07T08:16:00+08:00" });
    expect(hit.durationMin).toBe(19);
    expect(hit.provenance).toBe("cached");
  });

  it("misses outside the departure bucket and after TTL expiry", async () => {
    setCachedRoute(O, D, { durationMin: 19 }, { departAt: "2026-09-07T08:15:00+08:00" });
    expect(getCachedRoute(O, D, { departAt: "2026-09-07T09:30:00+08:00" })).toBeNull();
    await new Promise((r) => setTimeout(r, 5));
    expect(getCachedRoute(O, D, { departAt: "2026-09-07T08:15:00+08:00", ttlMs: 1 })).toBeNull();
  });
});
