import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import {
  BACKEND_TELEMETRY_MS,
  FLEET_ANIMATION_MS,
  FLEET_BRIDGE_PUSH_MS,
  buildFleetPositionJs,
  buildMapActiveJs,
  fleetRespondersSignature,
  normalizeFleetResponders,
  shouldPushFleetBridge,
} from "./fleet-bridge";

describe("fleet bridge throttle", () => {
  it("keeps the bridge an order of magnitude faster than backend telemetry", () => {
    expect(FLEET_BRIDGE_PUSH_MS).toBe(1500);
    expect(FLEET_ANIMATION_MS).toBe(1200);
    expect(BACKEND_TELEMETRY_MS).toBeGreaterThanOrEqual(10000);
    expect(BACKEND_TELEMETRY_MS).toBeGreaterThan(FLEET_BRIDGE_PUSH_MS);
  });

  it("allows the first push then gates on the interval", () => {
    expect(shouldPushFleetBridge(1000, 0)).toBe(true);
    expect(shouldPushFleetBridge(1000, Number.NaN)).toBe(true);
    expect(shouldPushFleetBridge(2000, 1000)).toBe(false);
    expect(shouldPushFleetBridge(2500, 1000)).toBe(true);
    expect(shouldPushFleetBridge(Number.NaN, 1000)).toBe(false);
  });

  it("normalizes responders to bridge-safe coordinates only", () => {
    expect(normalizeFleetResponders(null)).toEqual([]);
    const list = normalizeFleetResponders([
      { id: "r1", lat: 14.6, lng: 121, raw: { secret: "never-bridged" } },
      { id: "bad", lat: "0;alert(1)//", lng: 121 },
      { id: "oob", lat: 91, lng: 121 },
      null,
    ]);
    expect(list).toEqual([{ id: "r1", lat: 14.6, lng: 121 }]);
  });

  it("gives a stable signature independent of array identity", () => {
    const a = [{ id: "r1", lat: 14.6, lng: 121 }];
    const b = [{ id: "r1", lat: 14.6, lng: 121 }];
    expect(a).not.toBe(b);
    expect(fleetRespondersSignature(a)).toBe(fleetRespondersSignature(b));
    expect(fleetRespondersSignature([])).toBe("[]");
  });

  it("builds a direct global-function inject and refuses bad fixes", () => {
    const js = buildFleetPositionJs(14.6, 121, 90, [{ id: "r1", lat: 14.61, lng: 121.01 }]);
    expect(js).toContain("window.__updateFleetPositions && window.__updateFleetPositions(14.6, 121, 90,");
    expect(js).toContain('"r1"');
    expect(js.endsWith("; true;")).toBe(true);
    expect(js).not.toContain("postMessage");
    expect(buildFleetPositionJs(null, 121, 0, [])).toBeNull();
    expect(buildFleetPositionJs(14.6, 200, 0, [])).toBeNull();
    expect(buildFleetPositionJs(14.6, 121, -5, "not-json")).toContain(", null, []);");
  });

  it.each([null, undefined, -1, Number.NaN])("preserves unknown heading (%s) for the WebView's last-heading fallback", heading => {
    let delivered;
    runInNewContext(buildFleetPositionJs(14.6, 121, heading, []), {
      window: { __updateFleetPositions: (...args) => { delivered = args; } },
    });
    expect(delivered).toEqual([14.6, 121, null, []]);
  });

  it("delivers a real north heading as zero", () => {
    let delivered;
    runInNewContext(buildFleetPositionJs(14.6, 121, 0, []), {
      window: { __updateFleetPositions: (...args) => { delivered = args; } },
    });
    expect(delivered[2]).toBe(0);
  });

  it('delivers capture time without replacing it with the bridge clock', () => {
    const positions = [];
    const window = { __updateFleetPositions: (...args) => positions.push(args) };
    runInNewContext(buildFleetPositionJs(14.6, 121, 0, [], 1234), { window });
    runInNewContext(buildFleetPositionJs(14.6, 121, 0, [], null), { window });
    expect(positions.map(args => args[4])).toEqual([1234, null]);
  });

  it("builds the map-active pause/resume inject", () => {
    expect(buildMapActiveJs(true)).toBe("window.__setMapActive && window.__setMapActive(true); true;");
    expect(buildMapActiveJs(false)).toBe("window.__setMapActive && window.__setMapActive(false); true;");
  });
});
