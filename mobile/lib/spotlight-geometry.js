/**
 * Spotlight cutout geometry — pure arithmetic, no React, so it can be tested
 * directly. `mobile/` has no renderer, and the coach-mark suite's source-text
 * assertions cannot observe a shape at all; keeping this here is what makes the
 * hole's shape verifiable without a device.
 */

export const DEFAULT_RADIUS = 12;
export const DEFAULT_PADDING = 8;

const positive = (value, fallback) =>
  Number.isFinite(value) ? Math.max(0, value) : fallback;

/**
 * Resolve the scrim hole and its corner radius from a target's measured box.
 *
 * The hole is the target plus breathing room, and its radius has to follow that
 * padding. A circular control says "I am a circle" by declaring
 * `radius = shortSide / 2`, so a radius that did not grow with the padding would
 * flatten that circle into a rounded square the moment the hole got bigger than
 * the target.
 *
 * `radius + padding` is that rule, and it is not a tuned constant: for a
 * fully-rounded target it is algebraically identical to `shortHole / 2`, which
 * is exactly what keeps a circle a circle and turns a pill into a stadium. It is
 * also the rule `CoachMarkTarget` already applies to its own local focus
 * contour, so the contour and the scrim hole stay concentric rather than
 * drifting apart.
 *
 * `maxWidth` / `maxHeight` are the room available around the hole; a target near
 * an edge is clipped to them, and the radius is clamped against the clipped box
 * so it can never exceed a stadium.
 *
 * @returns {{ pad: number, holeW: number, holeH: number, holeRadius: number }}
 */
export function resolveSpotlightShape({
  width,
  height,
  radius,
  padding,
  maxWidth,
  maxHeight,
} = {}) {
  const pad = positive(padding, DEFAULT_PADDING);
  const targetW = positive(width, 0);
  const targetH = positive(height, 0);
  const declaredRadius = positive(radius, DEFAULT_RADIUS);

  const limitW = Number.isFinite(maxWidth) ? Math.max(0, maxWidth) : Infinity;
  const limitH = Number.isFinite(maxHeight) ? Math.max(0, maxHeight) : Infinity;

  const holeW = Math.max(0, Math.min(limitW, targetW + pad * 2));
  const holeH = Math.max(0, Math.min(limitH, targetH + pad * 2));

  return {
    pad,
    holeW,
    holeH,
    holeRadius: Math.min(declaredRadius + pad, Math.min(holeW, holeH) / 2),
  };
}
