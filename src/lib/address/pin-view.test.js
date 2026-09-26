import { describe, it, expect } from "vitest";
import {
  COUNTRY_ZOOM,
  DEFAULT_CENTER,
  PIN_ZOOM,
  isViewableCentre,
  planViewMove,
} from "@/lib/address/pin-view";

const CENTRE = { lat: 14.2811, lng: 121.4117, zoom: 15 };
const ELSEWHERE = { lat: 10.3157, lng: 123.8854, zoom: 14 };

/** The country view, as the module itself would produce it. */
const COUNTRY = { center: DEFAULT_CENTER, zoom: COUNTRY_ZOOM };

describe("PIN_ZOOM", () => {
  it("is the literal tomtom.js restates as LOOKUP_MAX_ZOOM", () => {
    // Deliberately a literal on both sides. `tomtom.js` asserts its own `16` in
    // its clamp test; this asserts the same number here. If someone moves one and
    // not the other, one of the two suites fails — which is the point, because a
    // lookup framing tighter than a placed pin would make a guess look like a
    // measurement.
    expect(PIN_ZOOM).toBe(16);
  });
});

describe("isViewableCentre", () => {
  it("accepts a centre that can be handed to setView", () => {
    expect(isViewableCentre(CENTRE)).toBe(true);
    expect(isViewableCentre({ lat: 0, lng: 0, zoom: 0 })).toBe(true);
  });

  it("rejects every shape that would otherwise reach Leaflet", () => {
    expect(isViewableCentre(null)).toBe(false);
    expect(isViewableCentre(undefined)).toBe(false);
    expect(isViewableCentre({})).toBe(false);
    expect(isViewableCentre({ lat: 14.28 })).toBe(false);
    expect(isViewableCentre({ lat: "14.28", lng: 121.4, zoom: 15 })).toBe(false);
    expect(isViewableCentre({ lat: Number.NaN, lng: 121.4, zoom: 15 })).toBe(false);
    expect(isViewableCentre({ lat: 14.28, lng: 121.4, zoom: Number.POSITIVE_INFINITY })).toBe(false);
  });
});

describe("planViewMove", () => {
  it("does not move on mount when there is no pin and no centre", () => {
    // `MapContainer`'s own `center`/`zoom` props are the initial values. Moving
    // here would re-assert them for nothing.
    expect(planViewMove({ hasPin: false, hadPin: false, lastKey: null, centre: null })).toEqual({
      key: null,
      move: null,
    });
  });

  it("moves to the centre when one is already held on mount", () => {
    // The dialog reopening on an address whose lookup result is still in hand.
    const { move } = planViewMove({ hasPin: false, hadPin: false, lastKey: null, centre: CENTRE });
    expect(move).toEqual({ center: [CENTRE.lat, CENTRE.lng], zoom: CENTRE.zoom });
  });

  it("moves when a new centre arrives — the barangay pick, and the whole task", () => {
    const first = planViewMove({ hasPin: false, hadPin: false, lastKey: null, centre: CENTRE });
    const second = planViewMove({
      hasPin: false,
      hadPin: false,
      lastKey: first.key,
      centre: ELSEWHERE,
    });
    expect(second.move).toEqual({ center: [ELSEWHERE.lat, ELSEWHERE.lng], zoom: ELSEWHERE.zoom });
  });

  it("does not re-set the view when the same centre comes round again", () => {
    // A re-render, or a parent passing a freshly-built but identical object. The
    // key is what makes this a comparison of values rather than identity.
    const first = planViewMove({ hasPin: false, hadPin: false, lastKey: null, centre: CENTRE });
    expect(typeof first.key).toBe("string");
    const again = planViewMove({
      hasPin: false,
      hadPin: false,
      lastKey: first.key,
      centre: { ...CENTRE },
    });
    expect(again.move).toBeNull();
  });

  it("never moves while a pin is placed, and does not record a centre it declined to act on", () => {
    // The rule the whole module exists for: the operator's own pin is the answer
    // about where the address is, and a lookup for the same address does not get
    // to overrule it.
    expect(planViewMove({ hasPin: true, hadPin: true, lastKey: "stale", centre: CENTRE })).toEqual({
      key: "stale",
      move: null,
    });
    expect(planViewMove({ hasPin: true, hadPin: false, lastKey: null, centre: CENTRE })).toEqual({
      key: null,
      move: null,
    });
  });

  it("returns to the centre when the pin is cleared, not to the country view", () => {
    // The address is still on screen, so jumping to country would be a non
    // sequitur. Note the centre is UNCHANGED from what was last recorded — this
    // move happens because the pin left, not because the centre is new.
    const key = planViewMove({ hasPin: false, hadPin: false, lastKey: null, centre: CENTRE }).key;
    const cleared = planViewMove({ hasPin: false, hadPin: true, lastKey: key, centre: CENTRE });
    expect(cleared.move).toEqual({ center: [CENTRE.lat, CENTRE.lng], zoom: CENTRE.zoom });
  });

  it("goes to the country view when the pin is cleared with no centre to return to", () => {
    expect(planViewMove({ hasPin: false, hadPin: true, lastKey: null, centre: null }).move).toEqual(
      COUNTRY
    );
  });

  it("goes to the country view when the centre is withdrawn", () => {
    // Changing the city clears the barangay, so the centre describes an address
    // that no longer exists. Keeping the old view would point at the place the
    // operator just left.
    const key = planViewMove({ hasPin: false, hadPin: false, lastKey: null, centre: CENTRE }).key;
    expect(planViewMove({ hasPin: false, hadPin: false, lastKey: key, centre: null }).move).toEqual(
      COUNTRY
    );
  });

  it("treats a malformed centre exactly as no centre, so it never reaches setView", () => {
    // On mount an unusable centre is indistinguishable from no centre at all, so
    // nothing moves and `MapContainer`'s own props stand.
    expect(planViewMove({ hasPin: false, hadPin: false, lastKey: null, centre: {} }).move).toBeNull();
    // Withdrawn after a real centre, it sends the map to the country view — the
    // same result a `null` centre gives. What matters is that `{}` is never the
    // thing handed to Leaflet.
    const key = planViewMove({ hasPin: false, hadPin: false, lastKey: null, centre: CENTRE }).key;
    expect(planViewMove({ hasPin: false, hadPin: false, lastKey: key, centre: {} }).move).toEqual(
      COUNTRY
    );
  });

  it("is total: every combination of its inputs returns a usable answer", () => {
    // Exhaustive over the combinations, with every kind of centre a caller could
    // hand it. The point is that nothing throws and every answer is either a real
    // move or an explicit refusal to move. Which cases land on which side is
    // asserted by the tests above rather than re-derived here.
    for (const hasPin of [false, true]) {
      for (const hadPin of [false, true]) {
        for (const lastKey of [null, "some-earlier-key"]) {
          for (const centre of [null, CENTRE, {}]) {
            const out = planViewMove({ hasPin, hadPin, lastKey, centre });
            if (out.move) {
              expect(out.move.center).toHaveLength(2);
              expect(out.move.center.every(Number.isFinite)).toBe(true);
              expect(Number.isFinite(out.move.zoom)).toBe(true);
            } else {
              expect(out.move).toBeNull();
            }
          }
        }
      }
    }
  });
});
