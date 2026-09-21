import { describe, expect, it } from "vitest";
import {
  DEFAULT_PADDING,
  DEFAULT_RADIUS,
  resolveSpotlightShape,
} from "./spotlight-geometry";

describe("resolveSpotlightShape", () => {
  it("keeps a fully-rounded target a circle once padding grows the hole", () => {
    // The Map round controls: standbyControl is 48x48 with borderRadius 24, so
    // 24 is exactly half the short side — "I am a circle".
    const shape = resolveSpotlightShape({ width: 48, height: 48, radius: 24 });

    expect(shape.holeW).toBe(64);
    expect(shape.holeH).toBe(64);
    // 24 + 8 = 32 = 64 / 2. Exact circle, not a rounded square.
    expect(shape.holeRadius).toBe(32);
    expect(shape.holeRadius).toBe(shape.holeW / 2);
  });

  it("keeps the DriverSos floating button a circle", () => {
    // DriverSos passes radius={SOS_SIZE / 2} = 32 with padding={4}.
    const shape = resolveSpotlightShape({
      width: 64,
      height: 64,
      radius: 32,
      padding: 4,
    });

    expect(shape.holeW).toBe(72);
    expect(shape.holeH).toBe(72);
    expect(shape.holeRadius).toBe(36);
    expect(shape.holeRadius).toBe(shape.holeH / 2);
  });

  it("turns a pill into a stadium rather than a rounded rectangle", () => {
    // 200x40 with radius 20: fully rounded on the short side.
    const shape = resolveSpotlightShape({
      width: 200,
      height: 40,
      radius: 20,
    });

    expect(shape.holeW).toBe(216);
    expect(shape.holeH).toBe(56);
    expect(shape.holeRadius).toBe(28);
    expect(shape.holeRadius).toBe(shape.holeH / 2);
  });

  it("leaves a card a rounded rectangle, not a circle", () => {
    const shape = resolveSpotlightShape({
      width: 300,
      height: 50,
      radius: 12,
    });

    expect(shape.holeW).toBe(316);
    expect(shape.holeH).toBe(66);
    // 12 + 8 = 20, well under half of 66 — stays a rounded rectangle.
    expect(shape.holeRadius).toBe(20);
    expect(shape.holeRadius).toBeLessThan(shape.holeH / 2);
  });

  it("does not pad the radius when padding is zero", () => {
    const shape = resolveSpotlightShape({
      width: 48,
      height: 48,
      radius: 24,
      padding: 0,
    });

    expect(shape.holeW).toBe(48);
    expect(shape.holeRadius).toBe(24);
  });

  it("clamps the radius so it can never exceed a stadium", () => {
    // 100x40 with radius 12 and padding 8: 12 + 8 = 20 would exceed the hole's
    // 36/2 = 18 half-height, so the hole caps at 18 rather than bulging.
    const shape = resolveSpotlightShape({
      width: 100,
      height: 20,
      radius: 12,
    });

    expect(shape.holeH).toBe(36);
    expect(shape.holeRadius).toBe(18);
  });

  it("treats a small target with a large declared radius as fully round", () => {
    const shape = resolveSpotlightShape({ width: 10, height: 10, radius: 12 });

    expect(shape.holeRadius).toBe(13);
    expect(shape.holeRadius).toBe(shape.holeW / 2);
  });

  it("clips the hole to the room available and shrinks the radius with it", () => {
    const shape = resolveSpotlightShape({
      width: 300,
      height: 50,
      radius: 12,
      maxWidth: 100,
      maxHeight: 30,
    });

    expect(shape.holeW).toBe(100);
    expect(shape.holeH).toBe(30);
    // Unclipped the radius would be 20; the clipped box caps it at 30/2 = 15.
    expect(shape.holeRadius).toBe(15);
  });

  it("falls back to the defaults for missing or invalid input", () => {
    const shape = resolveSpotlightShape();

    expect(shape.pad).toBe(DEFAULT_PADDING);
    expect(shape.holeW).toBe(DEFAULT_PADDING * 2);
    expect(shape.holeH).toBe(DEFAULT_PADDING * 2);
    expect(shape.holeRadius).toBe(DEFAULT_PADDING);
  });

  it("treats negatives and non-finite numbers as zero rather than NaN", () => {
    const shape = resolveSpotlightShape({
      width: -5,
      height: -5,
      radius: NaN,
      padding: -3,
      maxWidth: NaN,
      maxHeight: NaN,
    });

    expect(Number.isFinite(shape.holeRadius)).toBe(true);
    expect(shape.pad).toBe(0);
    expect(shape.holeW).toBe(0);
    expect(shape.holeRadius).toBe(0);
    expect(DEFAULT_RADIUS).toBeGreaterThan(0);
  });

  it("never returns a radius beyond the hole's short side", () => {
    const boxes = [
      [0, 0],
      [1, 40],
      [48, 48],
      [64, 64],
      [200, 40],
      [300, 50],
      [1000, 12],
    ];
    const radii = [0, 1, 12, 24, 32, 500];
    const paddings = [0, 4, 8, 16];

    for (const [width, height] of boxes) {
      for (const radius of radii) {
        for (const padding of paddings) {
          const shape = resolveSpotlightShape({
            width,
            height,
            radius,
            padding,
          });
          expect(shape.holeRadius).toBeGreaterThanOrEqual(0);
          expect(shape.holeRadius).toBeLessThanOrEqual(
            Math.min(shape.holeW, shape.holeH) / 2
          );
        }
      }
    }
  });
});
