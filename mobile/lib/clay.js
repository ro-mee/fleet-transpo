/**
 * Claymorphism material constants, shared by the Profile / Settings screens.
 *
 * Pure data only — no imports — so this file is safe for vitest (libs that
 * pull in theme.js/scaling.js drag react-native side effects into the test
 * runner; this one cannot).
 *
 * Light values are the original recipe (white top edge / shaded bottom edge).
 * Dark mode cannot reuse them literally: a 2px 44%-white strip on a near-black
 * card renders as a harsh straight gray line, and a black shadow on a
 * near-black stage is invisible — depth collapses into flat rectangles. The
 * dark variants below keep the same "light from above" language but diffuse
 * it: a soft low-alpha border all around, a faint brighter top, a deeper
 * bottom shade, and stronger/wider shadows so the lift survives the dark
 * stage. Consumers pick via clayMaterials(scheme === "dark").
 */

/** Soft raised-card depth with white top edge / shaded bottom edge.
 * borderWidth/borderColor are declared explicitly (as 0/transparent) so the
 * light materials carry the SAME keys as the dark ones — React Native does
 * not reliably reset a style prop that merely vanishes from the style
 * object, so a dark-only key that has no light counterpart survives a
 * Dark→Light switch as stale native state (a visible rectangular border /
 * shadow outline on Android). Dark variants override both keys; light
 * restores them to invisible defaults. */
export const clayShade = {
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.22,
  shadowRadius: 14,
  elevation: 7,
  borderWidth: 0,
  borderColor: "transparent",
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

/** Compact clay depth — the same edge-highlight language as clayShade,
 * scaled down for dense menu cards (Profile tab, Settings, hubs) so the
 * tighter rhythm reads subtle instead of bulky. Overlays (modals) keep
 * the full clayShade: as overlays they earn more lift. */
export const compactShade = {
  shadowOffset: { width: 0, height: 5 },
  shadowOpacity: 0.15,
  shadowRadius: 10,
  elevation: 4,
  borderWidth: 0,
  borderColor: "transparent",
  borderTopWidth: 2,
  borderTopColor: "#FFFFFF70",
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

const lightMaterials = { clayShade, clayCard, clayPill, clayCta, compactShade, clayTile };

/** Dark clay: diffused highlights instead of hard strips. The overall soft
 * border + faint brighter top replaces the light mode's solid white strip
 * (no visible straight line); the bottom shade goes deep enough to read on
 * a dark card; shadows gain opacity and radius so lift is perceptible. */
const darkMaterials = {
  clayShade: {
    ...clayShade,
    shadowOpacity: 0.5,
    shadowRadius: 18,
    elevation: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    borderTopWidth: 1.5,
    borderTopColor: "rgba(255,255,255,0.11)",
    borderBottomWidth: 1.5,
    borderBottomColor: "rgba(0,0,0,0.45)",
  },
  clayCard,
  clayPill: {
    ...clayPill,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.10)",
    borderBottomWidth: 1.5,
    borderBottomColor: "rgba(0,0,0,0.35)",
  },
  clayCta: {
    ...clayCta,
    borderTopWidth: 1.5,
    borderTopColor: "rgba(255,255,255,0.12)",
    borderBottomWidth: 1.5,
    borderBottomColor: "rgba(0,0,0,0.38)",
  },
  compactShade: {
    ...compactShade,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 5,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
    borderTopWidth: 1.5,
    borderTopColor: "rgba(255,255,255,0.09)",
    borderBottomWidth: 1.5,
    borderBottomColor: "rgba(0,0,0,0.38)",
  },
  clayTile: {
    ...clayTile,
    borderTopWidth: 1.5,
    borderTopColor: "rgba(255,255,255,0.10)",
    borderBottomWidth: 1.5,
    borderBottomColor: "rgba(0,0,0,0.32)",
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
};

/** Scheme-aware clay materials. Pass `scheme === "dark"` (not just
 * high-contrast — the materials are subtle enough to keep in HC dark, where
 * the palette already forces white borders for legibility). */
export function clayMaterials(isDark) {
  return isDark ? darkMaterials : lightMaterials;
}
