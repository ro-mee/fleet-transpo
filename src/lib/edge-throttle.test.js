import { describe, expect, it } from "vitest";
import { checkEdgeThrottle, EDGE_LIMIT, EDGE_WINDOW_MS } from "./edge-throttle";

describe("edge throttle", () => {
  it("allows a generous burst", () => {
    expect(EDGE_LIMIT).toBe(600);
    expect(EDGE_WINDOW_MS).toBe(60_000);
    for (let i = 0; i < 600; i++) {
      expect(checkEdgeThrottle("9.9.9.9", 1_000_000).allowed).toBe(true);
    }
  });

  it("blocks the 601st hit with a retry hint", () => {
    for (let i = 0; i < 600; i++) checkEdgeThrottle("8.8.8.8", 2_000_000);
    const result = checkEdgeThrottle("8.8.8.8", 2_000_000);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it("resets after the window", () => {
    for (let i = 0; i < 600; i++) checkEdgeThrottle("7.7.7.7", 3_000_000);
    expect(checkEdgeThrottle("7.7.7.7", 3_000_000).allowed).toBe(false);
    expect(checkEdgeThrottle("7.7.7.7", 3_000_000 + 60_001).allowed).toBe(true);
  });

  it("tracks IPs independently", () => {
    for (let i = 0; i < 600; i++) checkEdgeThrottle("6.6.6.6", 4_000_000);
    expect(checkEdgeThrottle("6.6.6.6", 4_000_000).allowed).toBe(false);
    expect(checkEdgeThrottle("5.5.5.5", 4_000_000).allowed).toBe(true);
  });
});
