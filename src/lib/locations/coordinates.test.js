import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/google-maps", () => ({ resolveGoogleMapsCoordinates: vi.fn() }));

import { resolveGoogleMapsCoordinates } from "@/lib/google-maps";
import { chooseLocationCoordinates, resolveCoordinates } from "@/lib/locations/coordinates";

// Two real canonical endpoints, comfortably far apart — the audit put them about
// 1.9 km from each other, so "these disagree" is never a rounding question.
const T2 = { latitude: 14.51058, longitude: 121.01222 };
const T3 = { latitude: 14.52048, longitude: 121.01445 };

describe("chooseLocationCoordinates — one source supplied", () => {
  it("uses the coordinates when only they were supplied", () => {
    expect(chooseLocationCoordinates({ latitude: "14.51058", longitude: "121.01222" })).toEqual(T2);
  });

  it("uses the link when only it was supplied", () => {
    expect(chooseLocationCoordinates({ linked: T2, linkSupplied: true })).toEqual(T2);
  });

  it("refuses when neither was supplied", () => {
    const out = chooseLocationCoordinates({});
    expect(out.error.maps_url).toContain("Add a Google Maps link or enter both coordinates.");
  });

  it("refuses when a link was supplied and did not resolve", () => {
    const out = chooseLocationCoordinates({ linked: null, linkSupplied: true });
    expect(out.error.maps_url).toContain("could not be resolved");
  });
});

describe("chooseLocationCoordinates — both sources supplied", () => {
  it("accepts a link and coordinates that name the same point", () => {
    // Same point to seven decimals, which is the precision both are stored at.
    const out = chooseLocationCoordinates({
      latitude: "14.5105800",
      longitude: "121.0122200",
      linked: T2,
      linkSupplied: true,
    });
    expect(out).toEqual(T2);
  });

  it("REFUSES a link and coordinates that name different points", () => {
    // The regression this module exists for. Before it, `linked?.latitude ??
    // body.latitude` let the link win here in silence: the pin was discarded,
    // the location was saved at the link's position, and nothing said so. The
    // position is what the geofence is built on, so the wrong one is not a
    // cosmetic error — it is a driver sent to the wrong bay.
    const out = chooseLocationCoordinates({
      latitude: T3.latitude,
      longitude: T3.longitude, // the operator pinned Terminal 3
      linked: T2, // the stale link still says Terminal 2
      linkSupplied: true,
    });

    expect(out.error).toBeDefined();
    expect(out.error.maps_url).toContain("name different points");
    // Not the "no coordinates" message: an out-of-range or half-supplied pin is
    // silently dropped, and reporting this case as that one would hide the very
    // conflict being refused.
    expect(out.latitude).toBeUndefined();
  });

  it("does not let a link that failed to resolve block a pin", () => {
    // The geocoder is a convenience, not a dependency. A dead provider must not
    // make an operator's own coordinates unsaveable.
    expect(
      chooseLocationCoordinates({ latitude: T3.latitude, longitude: T3.longitude, linked: null, linkSupplied: true })
    ).toEqual(T3);
  });
});

describe("chooseLocationCoordinates — what does not count as a position", () => {
  it("drops a half pair and lets the link decide", () => {
    expect(
      chooseLocationCoordinates({ latitude: "14.51058", linked: T2, linkSupplied: true })
    ).toEqual(T2);
  });

  it("drops an out-of-range value and lets the link decide", () => {
    expect(
      chooseLocationCoordinates({ latitude: "914.5", longitude: "121.01222", linked: T2, linkSupplied: true })
    ).toEqual(T2);
  });

  it("refuses a half pair when there is no link to fall back to", () => {
    const out = chooseLocationCoordinates({ latitude: "14.51058" });
    expect(out.error.maps_url).toContain("Add a Google Maps link or enter both coordinates.");
  });

  it("refuses text that is not a number", () => {
    const out = chooseLocationCoordinates({ latitude: "here", longitude: "there" });
    expect(out.error).toBeDefined();
  });
});

describe("chooseLocationCoordinates — storage precision", () => {
  it("rounds to the seven decimals numeric(10,7) holds", () => {
    // Latitude carries digits past the seventh and is rounded back to the stored
    // precision; longitude is already at exactly seven and is untouched. Note
    // the rounding is real, not truncation — 121.01222009876 would come back as
    // 121.0122201, so a test that reused a clean pair here would prove nothing.
    expect(
      chooseLocationCoordinates({ latitude: "14.51058001234", longitude: "121.0122200" })
    ).toEqual(T2);
  });
});

describe("resolveCoordinates — reading the request body", () => {
  beforeEach(() => resolveGoogleMapsCoordinates.mockReset());

  it("passes the resolved link through", async () => {
    resolveGoogleMapsCoordinates.mockResolvedValue(T2);
    expect(await resolveCoordinates({ maps_url: "https://maps.app.goo.gl/x" })).toEqual(T2);
    expect(resolveGoogleMapsCoordinates).toHaveBeenCalledWith("https://maps.app.goo.gl/x");
  });

  it("does not call the provider for a blank or absent link", async () => {
    await resolveCoordinates({ latitude: T3.latitude, longitude: T3.longitude, maps_url: "  " });
    await resolveCoordinates({ latitude: T3.latitude, longitude: T3.longitude });
    expect(resolveGoogleMapsCoordinates).not.toHaveBeenCalled();
  });

  it("tells 'no link given' apart from 'a link that did not resolve'", async () => {
    // Both arrive as `linked: null`, so only `linkSupplied` separates them. Get
    // that flag wrong and a failed paste reports the same message as an empty
    // form, sending the operator to fix a field they never touched.
    resolveGoogleMapsCoordinates.mockResolvedValue(null);
    const failed = await resolveCoordinates({ maps_url: "https://maps.app.goo.gl/dead" });
    const absent = await resolveCoordinates({});
    expect(failed.error.maps_url).toContain("could not be resolved");
    expect(absent.error.maps_url).toContain("Add a Google Maps link");
  });

  it("carries a body-level disagreement through to the refusal", async () => {
    resolveGoogleMapsCoordinates.mockResolvedValue(T2);
    const out = await resolveCoordinates({
      maps_url: "https://maps.app.goo.gl/x",
      latitude: T3.latitude,
      longitude: T3.longitude,
    });
    expect(out.error.maps_url).toContain("name different points");
  });
});
