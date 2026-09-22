import { describe, expect, it } from "vitest";
import {
  ARROW_HALF_WIDTH,
  ARROW_MIN_INSET,
  DEFAULT_PADDING,
  DEFAULT_RADIUS,
  isMeasuredBox,
  normalizeInsetsToMeasuredSpace,
  resolveArrowOffset,
  resolveSpotlightRect,
  resolveSpotlightShape,
  resolveTooltipCardLeft,
  resolveTooltipCardWidth,
  toContainerSpace,
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

describe("resolveSpotlightRect", () => {
  // The device these were derived from: 384dp wide, insets {top: 39.111, bottom: 16}.
  const SCREEN = { screenWidth: 384, screenHeight: 814.4 };

  it("pads symmetrically when there is room on both sides", () => {
    const hole = resolveSpotlightRect({
      x: 33.07,
      y: 502.76,
      width: 317.87,
      height: 48,
      radius: 16,
      padding: 6,
      ...SCREEN,
    });

    expect(hole.x).toBe(27);
    expect(hole.width).toBe(330);
    // 6dp of breathing room on each side, within the 1dp the edge snap can move
    // each rounded edge by.
    expect(33.07 - hole.x).toBeCloseTo(6.07, 1);
    expect(hole.x + hole.width - (33.07 + 317.87)).toBeCloseTo(6.06, 1);
  });

  it("reduces padding on BOTH sides at a screen edge instead of one", () => {
    // A target flush to the left edge: the old code produced x=0 with a full
    // 2*pad of width, putting all the slack on the right and sliding the ring
    // off-centre from the control.
    const hole = resolveSpotlightRect({
      x: 0,
      y: 100,
      width: 100,
      height: 40,
      radius: 12,
      padding: 8,
      ...SCREEN,
    });

    expect(hole.x).toBe(0);
    expect(hole.x + hole.width).toBe(100);
    // Slack is 0 on the left and 0 on the right — symmetric, not 0 and 16.
    expect(hole.x).toBe(0);
    expect(hole.x + hole.width - (0 + 100)).toBe(0);
  });

  it("never frames less than the target itself", () => {
    for (const x of [0, 2, 4, 8, 16]) {
      const hole = resolveSpotlightRect({
        x,
        y: 50,
        width: 48,
        height: 48,
        radius: 24,
        padding: 8,
        ...SCREEN,
      });

      expect(hole.width).toBeGreaterThanOrEqual(48);
      expect(hole.height).toBeGreaterThanOrEqual(48);
      expect(hole.x).toBeLessThanOrEqual(x);
      expect(hole.x + hole.width).toBeGreaterThanOrEqual(x + 48);
    }
  });

  it("snaps the edges to whole dp so abutting scrim rectangles share no fraction", () => {
    // These are real measured values; every one is fractional.
    const hole = resolveSpotlightRect({
      x: 34.844451904296875,
      y: 574.22216796875,
      width: 314.31109619140625,
      height: 70.755615234375,
      radius: 12,
      padding: 8,
      screenWidth: 384,
      screenHeight: 814.4,
    });

    expect(Number.isInteger(hole.x)).toBe(true);
    expect(Number.isInteger(hole.y)).toBe(true);
    expect(Number.isInteger(hole.width)).toBe(true);
    expect(Number.isInteger(hole.height)).toBe(true);
    // Edge snapping must not let the two edges drift apart from each other.
    expect(hole.x + hole.width).toBe(Math.round(34.844451904296875 + 314.31109619140625 + 8));
  });

  it("keeps a round control a circle in the hole", () => {
    const hole = resolveSpotlightRect({
      x: 320,
      y: 618.31,
      width: 48,
      height: 48,
      radius: 24,
      padding: 8,
      ...SCREEN,
    });

    expect(hole.width).toBe(64);
    expect(hole.height).toBe(64);
    expect(hole.radius).toBe(32);
    expect(hole.radius).toBe(hole.width / 2);
  });

  it("does not grow the radius for padding the edge never allowed", () => {
    // Flush to the left edge, so the actual padding is 0 — a radius grown by the
    // nominal 8 would bulge the corners out past the control.
    const hole = resolveSpotlightRect({
      x: 0,
      y: 100,
      width: 48,
      height: 48,
      radius: 12,
      padding: 8,
      ...SCREEN,
    });

    expect(hole.radius).toBe(12);
  });

  it("stays within the radius ceiling for every edge position", () => {
    for (const x of [0, 1, 7, 8, 9, 168, 320, 376, 384]) {
      for (const padding of [0, 4, 8, 16]) {
        const hole = resolveSpotlightRect({
          x,
          y: 100,
          width: 48,
          height: 48,
          radius: 24,
          padding,
          ...SCREEN,
        });
        expect(hole.radius).toBeLessThanOrEqual(
          Math.min(hole.width, hole.height) / 2
        );
        expect(hole.radius).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("handles a target wider than the screen without inverting", () => {
    const hole = resolveSpotlightRect({
      x: 0,
      y: 0,
      width: 500,
      height: 40,
      radius: 12,
      padding: 8,
      ...SCREEN,
    });

    expect(hole.width).toBeGreaterThan(0);
    expect(hole.x).toBe(0);
  });

  it("falls back to the default padding for missing input", () => {
    // No screen dimensions and no padding: the padding must still be symmetric,
    // which with no known edge is simply the default on both sides.
    const hole = resolveSpotlightRect({ x: 10, y: 20, width: 100, height: 40 });

    expect(hole.pad).toBe(DEFAULT_PADDING);
    expect(hole.x).toBe(10 - DEFAULT_PADDING);
    expect(hole.y).toBe(20 - DEFAULT_PADDING);
    expect(hole.width).toBe(100 + DEFAULT_PADDING * 2);
    expect(hole.height).toBe(40 + DEFAULT_PADDING * 2);
    expect(DEFAULT_RADIUS).toBeGreaterThan(0);
  });
});

describe("resolveTooltipCardWidth", () => {
  it("uses the passed, already-scaled cap rather than a raw 340", () => {
    // moderateScale(340) at a 412dp screen is 340 * (0.5 + 412/750) = 356.8.
    expect(
      resolveTooltipCardWidth({ screenWidth: 412, maxCardWidth: 356.8 })
    ).toBeCloseTo(356.8, 4);
  });

  it("is 90% of the screen while that is under the cap", () => {
    // 360dp: 90% = 324, which is under moderateScale(340) = 333.2.
    expect(
      resolveTooltipCardWidth({ screenWidth: 360, maxCardWidth: 333.2 })
    ).toBeCloseTo(324, 4);
  });

  it("reproduces the measured device card width", () => {
    // 384dp screen, moderateScale(340) = 340 * (0.5 + 384/750) = 344.08.
    expect(
      resolveTooltipCardWidth({ screenWidth: 384, maxCardWidth: 344.08 })
    ).toBeCloseTo(344.08, 4);
  });

  it("falls back to the unscaled cap when none is given", () => {
    expect(resolveTooltipCardWidth({ screenWidth: 1000 })).toBe(340);
  });
});

describe("resolveTooltipCardLeft", () => {
  it("centres the card", () => {
    expect(resolveTooltipCardLeft({ screenWidth: 384, cardWidth: 344.08 })).toBeCloseTo(
      19.96,
      2
    );
  });

  it("never returns a negative left", () => {
    expect(resolveTooltipCardLeft({ screenWidth: 300, cardWidth: 400 })).toBe(0);
  });
});

describe("resolveArrowOffset", () => {
  // The measured Map controls: a 48dp button at x=320 on a 384dp screen, so its
  // centre is 344 while the card spans 19.96 .. 364.04.
  const card = { cardLeft: 19.96, cardWidth: 344.08 };

  it("points at a right-side target instead of saturating at a bare 280", () => {
    const centre = resolveArrowOffset({ targetCenter: 344, ...card });
    const aimedAt = card.cardLeft + centre;

    // The old code clamped the arrow's left edge to a bare 280 — not a property
    // of the card — leaving a centre of 289, i.e. 35dp short of the target.
    expect(centre).toBeGreaterThan(289);

    // The arrow's own box must stay inside the card, so a target whose centre is
    // within (halfWidth + inset) of the card's right edge cannot be hit exactly.
    // What matters is that the miss is smaller than the arrow itself, so the
    // arrow still covers the point it is meant to indicate.
    const miss = Math.abs(aimedAt - 344);
    expect(miss).toBeLessThan(ARROW_HALF_WIDTH);
  });

  it("keeps the arrow's own box inside the card", () => {
    for (const targetCenter of [0, 19.96, 100, 192, 344, 384, 1000]) {
      const centre = resolveArrowOffset({ targetCenter, ...card });
      expect(centre - ARROW_HALF_WIDTH).toBeGreaterThanOrEqual(ARROW_MIN_INSET);
      expect(centre + ARROW_HALF_WIDTH).toBeLessThanOrEqual(
        card.cardWidth - ARROW_MIN_INSET + 1e-9
      );
    }
  });

  it("still centres a centred target", () => {
    // fuel.request_button: x=33.07 w=317.87, centre 192.
    const centre = resolveArrowOffset({ targetCenter: 192, ...card });
    expect(card.cardLeft + centre).toBeCloseTo(192, 0);
  });

  it("uses the card height when placing a vertical arrow", () => {
    // The floating SOS bubble passes its height as the cross-axis extent.
    const centre = resolveArrowOffset({
      targetCenter: 656,
      cardLeft: 586,
      cardWidth: 150,
      halfWidth: 8,
    });
    expect(centre).toBeGreaterThan(0);
    expect(centre - 8).toBeGreaterThanOrEqual(0);
    expect(centre + 8).toBeLessThanOrEqual(150);
  });

  it("survives a zero-width card without producing NaN", () => {
    const centre = resolveArrowOffset({
      targetCenter: 100,
      cardLeft: 0,
      cardWidth: 0,
    });
    expect(Number.isFinite(centre)).toBe(true);
  });
});

describe("normalizeInsetsToMeasuredSpace", () => {
  it("discounts a top inset the container never spans", () => {
    // The measured device: window 853.33, root view 814.4, so the root starts
    // 38.93 below the window top and the 39.11 status bar is outside it.
    const result = normalizeInsetsToMeasuredSpace({
      insets: { top: 39.111, bottom: 16 },
      windowHeight: 853.33,
      containerHeight: 814.4,
    });

    expect(result.offset).toBeCloseTo(38.93, 2);
    // Effectively zero: the measured space has no status bar in it.
    expect(result.top).toBeLessThan(1);
    expect(result.top).toBeGreaterThanOrEqual(0);
    // The bottom inset is real — the container reaches the bottom of the window.
    expect(result.bottom).toBe(16);
  });

  it("leaves insets alone when the container is the whole window", () => {
    const result = normalizeInsetsToMeasuredSpace({
      insets: { top: 24, bottom: 16 },
      windowHeight: 800,
      containerHeight: 800,
    });

    expect(result.offset).toBe(0);
    expect(result.top).toBe(24);
    expect(result.bottom).toBe(16);
  });

  it("absorbs the bottom inset once the container is short by both", () => {
    const result = normalizeInsetsToMeasuredSpace({
      insets: { top: 24, bottom: 16 },
      windowHeight: 800,
      containerHeight: 760,
    });

    expect(result.offset).toBe(40);
    expect(result.top).toBe(0);
    expect(result.bottom).toBe(0);
  });

  it("passes insets through when the heights are unknown", () => {
    const result = normalizeInsetsToMeasuredSpace({ insets: { top: 39, bottom: 16 } });

    expect(result.offset).toBe(0);
    expect(result.top).toBe(39);
    expect(result.bottom).toBe(16);
  });

  it("tolerates a missing insets object", () => {
    const result = normalizeInsetsToMeasuredSpace({ windowHeight: 800, containerHeight: 800 });

    expect(result.top).toBe(0);
    expect(result.bottom).toBe(0);
  });
});

describe("isMeasuredBox", () => {
  it("rejects the unmeasured default", () => {
    // The container's initial state. Both device logs printed it, and the first
    // one was misread as a settled origin of {0,0}.
    expect(isMeasuredBox({ x: 0, y: 0, width: 0, height: 0 })).toBe(false);
  });

  it("rejects a box missing one dimension", () => {
    expect(isMeasuredBox({ width: 384, height: 0 })).toBe(false);
    expect(isMeasuredBox({ width: 0, height: 853 })).toBe(false);
    expect(isMeasuredBox({})).toBe(false);
    expect(isMeasuredBox()).toBe(false);
  });

  it("accepts the real container box", () => {
    expect(isMeasuredBox({ x: 0, y: -39.11, width: 384, height: 853 })).toBe(true);
  });
});

describe("toContainerSpace", () => {
  // The device's real numbers: a container whose top edge sits a full status bar
  // ABOVE the measured origin, at 853dp tall against a 853.33dp window.
  const container = { x: 0, y: -39.11, width: 384, height: 853 };

  it("moves a measured box into the container's local space", () => {
    // This is the whole bug: target measured at y=160.89 is 200.00dp below the
    // container's top edge, and the container's local origin is its top edge.
    // Drawing it at 160.89 put the hole 39.11dp above the control.
    const local = toContainerSpace({
      box: { x: 12, y: 160.89, width: 100, height: 48 },
      container,
    });

    expect(local.y).toBeCloseTo(200, 2);
    expect(local.x).toBe(12);
    // Size and the rest of the box ride along untouched — only the origin moves.
    expect(local.width).toBe(100);
    expect(local.height).toBe(48);
  });

  it("is a no-op when the container sits at the measured origin", () => {
    // Every device where the root view starts at the window origin. The
    // correction must not invent an offset there.
    const box = { x: 12, y: 160.89, width: 100, height: 48 };
    const local = toContainerSpace({
      box,
      container: { x: 0, y: 0, width: 384, height: 853 },
    });

    expect(local).toEqual(box);
  });

  it("returns the box untouched while the container is unmeasured", () => {
    // No conversion is available yet, and a default offset would be a guess.
    // The first render precedes the first `measureInWindow` callback.
    const box = { x: 12, y: 160.89, width: 100, height: 48 };
    const local = toContainerSpace({
      box,
      container: { x: 0, y: 0, width: 0, height: 0 },
    });

    expect(local).toEqual(box);
  });

  it("passes a null box through as null", () => {
    // The Welcome card has no target, and the overlay early-returns on it.
    expect(toContainerSpace({ box: null, container })).toBeNull();
    expect(toContainerSpace({ container })).toBeNull();
  });

  it("preserves the declared shape through the translation", () => {
    // `radius` and `padding` are what make a round control round. A translation
    // that dropped them would flatten every circle into the default rectangle.
    const local = toContainerSpace({
      box: { x: 0, y: 100, width: 48, height: 48, radius: 24, padding: 4 },
      container,
    });

    expect(local.radius).toBe(24);
    expect(local.padding).toBe(4);
  });

  it("tolerates a box with a missing origin", () => {
    const local = toContainerSpace({
      box: { width: 100, height: 48 },
      container,
    });

    expect(local.x).toBeUndefined();
    expect(local.y).toBeUndefined();
    expect(local.width).toBe(100);
  });
});
