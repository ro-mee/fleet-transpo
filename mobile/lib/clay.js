/**
 * Claymorphism material constants, shared by the Profile / Settings screens.
 *
 * Pure data only — no imports — so this file is safe for vitest (libs that
 * pull in theme.js/scaling.js drag react-native side effects into the test
 * runner; this one cannot).
 *
 * Values are copied from the Home/Trips clay implementation (trips.js,
 * trip/[id].js), which remain the visual reference. Those screens keep their
 * local copies; new screens import from here.
 */

/** Soft raised-card depth with white top edge / shaded bottom edge. */
export const clayShade = {
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.22,
  shadowRadius: 14,
  elevation: 7,
  borderTopWidth: 2,
  borderTopColor: "#FFFFFF70",
  borderBottomWidth: 3,
  borderBottomColor: "#00000016",
};

/** Base clay surface: a softly raised 30dp card. */
export const clayCard = {
  borderRadius: 30,
  padding: 20,
  gap: 18,
};

/** Raised status pill with its own edge highlights. */
export const clayPill = {
  paddingHorizontal: 14,
  paddingVertical: 9,
  borderRadius: 20,
  borderTopWidth: 1,
  borderTopColor: "#FFFFFF80",
  borderBottomWidth: 2,
  borderBottomColor: "#00000012",
};

/** Tactile CTA: minimum 48dp control with clay edge strips. */
export const clayCta = {
  minHeight: 48,
  borderRadius: 18,
  borderTopWidth: 2,
  borderTopColor: "#FFFFFF60",
  borderBottomWidth: 2,
  borderBottomColor: "#00000012",
};

/** Raised clay icon tile: puffy depth with its own edge highlights,
 * sized to sit inside a clay card without competing with it. */
export const clayTile = {
  borderTopWidth: 1.5,
  borderTopColor: "#FFFFFF75",
  borderBottomWidth: 2,
  borderBottomColor: "#00000012",
  shadowOffset: { width: 0, height: 3 },
  shadowOpacity: 0.16,
  shadowRadius: 5,
  elevation: 2,
};
