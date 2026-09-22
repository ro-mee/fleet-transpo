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
 * is exactly what keeps a circle a circle and turns a pill into a stadium.
 *
 * This radius is the ONLY shape the driver sees. `CoachMarkTarget` used to paint
 * a second, component-local contour, and the dual contour was removed on
 * 2026-09-22 because sub-pixel drift made the two rings read as doubled. That
 * removal fixed the doubling but took the round controls' shape cue with it — a
 * `radius = shortSide / 2` button is now distinguished from a card by this
 * number alone. Do not treat it as a cosmetic detail.
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

/**
 * Resolve the hole's absolute box, with symmetric breathing room and whole-dp
 * edges.
 *
 * Two properties this buys, both of which were device-visible defects:
 *
 * 1. **Symmetric padding.** The overlay used to place the hole with
 *    `Math.max(0, target.x - pad)` and then size it `target.w + 2 * pad`
 *    independently, so a target nearer than `pad` to a screen edge got its
 *    padding on one side only — the ring sat off-centre from the control it was
 *    framing. Here each axis' padding is reduced to what the screen actually
 *    allows, on both sides at once. A target flush to an edge gets zero padding
 *    rather than 8dp of lopsided slack, and the hole is never smaller than the
 *    target.
 *
 * 2. **Whole-dp edges.** `measureInWindow` returns device pixels divided by
 *    density, so real boxes arrive as `49.77777099609375`. The scrim is painted
 *    by four rectangles that abut exactly, and abutting translucent views at a
 *    fractional boundary anti-alias independently, which is what leaves a
 *    hairline where they meet. Snapping the EDGES (not the origin and the size
 *    separately, which lets 1dp of drift open up between them) removes the
 *    fraction at its source.
 *
 * @returns {{ x: number, y: number, width: number, height: number, radius: number, pad: number }}
 */
export function resolveSpotlightRect({
  x,
  y,
  width,
  height,
  radius,
  padding,
  screenWidth,
  screenHeight,
} = {}) {
  const pad = positive(padding, DEFAULT_PADDING);
  const targetW = positive(width, 0);
  const targetH = positive(height, 0);
  const targetX = Number.isFinite(x) ? x : 0;
  const targetY = Number.isFinite(y) ? y : 0;

  const roomX = (start) =>
    Number.isFinite(screenWidth) ? Math.max(0, screenWidth - (start + targetW)) : pad;
  const roomY = (start) =>
    Number.isFinite(screenHeight) ? Math.max(0, screenHeight - (start + targetH)) : pad;

  const padX = Math.max(0, Math.min(pad, targetX, roomX(targetX)));
  const padY = Math.max(0, Math.min(pad, targetY, roomY(targetY)));

  const left = Math.round(targetX - padX);
  const right = Math.round(targetX + targetW + padX);
  const top = Math.round(targetY - padY);
  const bottom = Math.round(targetY + targetH + padY);

  const holeW = Math.max(0, right - left);
  const holeH = Math.max(0, bottom - top);

  // The radius follows the padding the hole ACTUALLY received. Growing it by the
  // nominal padding would hand an edge-flush target a radius sized for breathing
  // room it never got, bulging the hole's corners past the control.
  const grown = Math.min(padX, padY);

  return {
    x: left,
    y: top,
    width: holeW,
    height: holeH,
    radius: Math.min(
      positive(radius, DEFAULT_RADIUS) + grown,
      Math.min(holeW, holeH) / 2
    ),
    pad,
  };
}

/** A box is only usable once both of its dimensions are real. */
export function isMeasuredBox({ width, height } = {}) {
  return positive(width, 0) > 0 && positive(height, 0) > 0;
}

/**
 * Translate a box measured with `measureInWindow` into the space an
 * absolutely-positioned child of the overlay is laid out in.
 *
 * `measureInWindow` reports every view in ONE space, so a target box and the
 * overlay's own container box are directly comparable. Comparable is not the
 * same as interchangeable, and that is where this went wrong for five rounds:
 * a `StyleSheet.absoluteFill` child is positioned in the CONTAINER's local
 * space, whose origin is the container's own top-left — measured at
 * `{x: 0, y: -39.11}` on the device this was found on, not `{0, 0}`.
 *
 * Drawing a measured `y` into that space therefore places the hole 39.11dp
 * above its target, i.e. a status bar too high. That is the "laging lagpas,
 * masyadong mataas" symptom, and it survived every earlier fix because each of
 * them reasoned about the target's box while the error lived in the space the
 * box was drawn into.
 *
 * Subtracting the container's measured origin is the entire correction, and it
 * is a NO-OP on any device where the container does sit at the measured origin,
 * so it is safe on both. Do NOT remove it by comparing the container's height
 * against the window's: on this device those read 853 and 853.33 — "one space"
 * by that test — while the origins differ by a full status bar. Equal heights do
 * not imply a shared origin, and that coincidence is exactly what deleted this
 * correction on 2026-09-22.
 *
 * An unmeasured container (`{0,0,0,0}` — the state before the first
 * `measureInWindow` callback, and what the first device log misread as a settled
 * origin) yields no conversion, so the box is returned untouched rather than
 * shifted by a default.
 *
 * @returns {object|null} the box, re-expressed in the container's local space
 */
export function toContainerSpace({ box, container } = {}) {
  if (!box) return null;
  if (!isMeasuredBox(container)) return box;

  const originX = Number.isFinite(container.x) ? container.x : 0;
  const originY = Number.isFinite(container.y) ? container.y : 0;

  return {
    ...box,
    x: Number.isFinite(box.x) ? box.x - originX : box.x,
    y: Number.isFinite(box.y) ? box.y - originY : box.y,
  };
}

export const TOOLTIP_WIDTH_RATIO = 0.9;
export const TOOLTIP_MAX_WIDTH = 340;

/**
 * The tooltip card's width, as ONE shared answer.
 *
 * The card is laid out by `width: "90%"` plus an `maxWidth` that goes through
 * `moderateScale`, while the overlay used to compute the same width as
 * `Math.min(screenWidth * 0.9, 340)` — a raw 340. `moderateScale(340)` is 340
 * only at a 375dp-wide screen; at 412dp it is 356.8. The two disagreed, and the
 * arrow is positioned relative to the card's left edge, so the disagreement went
 * straight into the arrow's aim.
 *
 * `maxCardWidth` is passed in already scaled, because `lib/scaling.js` reads
 * `Dimensions` from React Native and this module stays renderer-free on purpose.
 */
export function resolveTooltipCardWidth({ screenWidth, maxCardWidth } = {}) {
  const ratio = Number.isFinite(screenWidth)
    ? Math.max(0, screenWidth) * TOOLTIP_WIDTH_RATIO
    : 0;
  const cap = Number.isFinite(maxCardWidth)
    ? Math.max(0, maxCardWidth)
    : TOOLTIP_MAX_WIDTH;
  return Math.max(0, Math.min(ratio, cap));
}

/** The card is centred, so its left edge follows from the width that was used. */
export function resolveTooltipCardLeft({ screenWidth, cardWidth } = {}) {
  if (!Number.isFinite(screenWidth) || !Number.isFinite(cardWidth)) return 0;
  return Math.max(0, (screenWidth - cardWidth) / 2);
}

export const ARROW_HALF_WIDTH = 9;
export const ARROW_MIN_INSET = 16;

/**
 * Where the arrow's centre sits, measured from the card's leading edge.
 *
 * Returns the arrow's CENTRE so both callers agree on the geometry: the card's
 * arrow paints its left edge at `centre - halfWidth`, the floating bubble's
 * paints at `centre - halfWidth` too. The previous cap was a bare `280`, which
 * is not a property of the card at all — on a 412dp screen the arrow saturated
 * there while the card reached 356.8, so any target on the right of the screen
 * got an arrow pointing at empty card. Bounding it by the card's own width is
 * the fix, and it is also why this belongs next to the width resolver.
 *
 * Axis-agnostic: the floating bubble passes its height as `cardWidth` to place
 * its side arrow vertically.
 */
export function resolveArrowOffset({
  targetCenter,
  cardLeft,
  cardWidth,
  halfWidth = ARROW_HALF_WIDTH,
  minInset = ARROW_MIN_INSET,
} = {}) {
  const width = Number.isFinite(cardWidth) ? Math.max(0, cardWidth) : 0;
  const half = positive(halfWidth, ARROW_HALF_WIDTH);
  const inset = positive(minInset, ARROW_MIN_INSET);
  const lowest = half + inset;
  const highest = Math.max(lowest, width - half - inset);
  const centre = Number.isFinite(targetCenter) ? targetCenter : 0;
  const left = Number.isFinite(cardLeft) ? cardLeft : 0;

  return Math.min(Math.max(centre - left, lowest), highest);
}

/**
 * Re-express window-space safe-area insets in the space `measureInWindow`
 * reports.
 *
 * These are two different coordinate systems, and the code treated them as one.
 * `useSafeAreaInsets()` describes the WINDOW; `measureInWindow` describes the
 * view it is called on, which resolves against the root view. Those coincide
 * only when the root view starts at the window origin — i.e. only under
 * edge-to-edge. On a window that is not edge-to-edge the root view begins below
 * the status bar, and the provider's `insets.top` (39.11 on the device this was
 * found on) is then larger than any inset that exists inside the measured space.
 *
 * The provider is mounted above the navigators, so it reads insets from one API
 * while every target box it is handed arrives from another. What the live
 * container measurement settles is narrower than this note used to claim: the
 * overlay's own box sits at `{x: 0, y: -39.11}` in measured space — its top edge
 * is 39.11dp ABOVE the measured origin, which matches `insets.top` on the same
 * device — so this container spans the status-bar region rather than beginning
 * below it.
 *
 * The hole is NOT unaffected by that, which this note asserted until
 * 2026-09-22. It is offset and sized from a target in the same space, yes, but
 * it is DRAWN as a `position: absolute` child of this container, so the space
 * that matters is the container's LOCAL one — see `toContainerSpace`.
 *
 * Only the `safeTop` / `safeBottom` clamps are this function's business, and the
 * conversion below is deliberately left as it is. It moves them by
 * `windowHeight - containerHeight` (0.33dp here) and so is near-harmless, but
 * note that the `offset` it derives is NOT the origin difference (39.11dp):
 * heights that agree to a third of a dp are the coincidence, not the proof.
 * Whether these insets need any conversion at all is still unresolved, and
 * guessing the direction wrong would pin every tooltip to a screen edge. Do not
 * change it without a device run reporting `insets.window` beside `container.y`.
 *
 * @returns {{ top: number, bottom: number, offset: number }}
 */
export function normalizeInsetsToMeasuredSpace({
  insets,
  windowHeight,
  containerHeight,
} = {}) {
  const top = Number.isFinite(insets?.top) ? Math.max(0, insets.top) : 0;
  const bottom = Number.isFinite(insets?.bottom) ? Math.max(0, insets.bottom) : 0;

  if (!Number.isFinite(windowHeight) || !Number.isFinite(containerHeight)) {
    return { top, bottom, offset: 0 };
  }

  const offset = Math.max(0, Math.max(0, windowHeight) - Math.max(0, containerHeight));

  return {
    top: Math.max(0, top - offset),
    bottom: Math.max(0, bottom - Math.max(0, offset - top)),
    offset,
  };
}
