import { describe, it, expect } from "vitest";
import { resolveIncidentCoords } from "@/lib/geo/incident-coords";

describe("resolveIncidentCoords", () => {
  it("uses explicit decimal lat/lng columns", () => {
    expect(resolveIncidentCoords({ latitude: 14.7518971, longitude: 121.0573913 })).toEqual({
      latitude: 14.7518971,
      longitude: 121.0573913,
    });
  });

  it("parses a decimal 'lat, lng' location string", () => {
    expect(resolveIncidentCoords({ location: "14.7519633, 121.0573733" })).toEqual({
      latitude: 14.7519633,
      longitude: 121.0573733,
    });
  });

  it("parses a Google Maps ?q= URL", () => {
    expect(resolveIncidentCoords({ location: "https://maps.google.com/?q=14.7518971,121.0573913" })).toEqual({
      latitude: 14.7518971,
      longitude: 121.0573913,
    });
  });

  it("parses a Google Maps @lat,lng URL", () => {
    expect(resolveIncidentCoords({ location: "https://maps.google.com/@14.7519,121.0574,15z" })).toEqual({
      latitude: 14.7519,
      longitude: 121.0574,
    });
  });

  it("parses the DMS format the driver app reports", () => {
    const r = resolveIncidentCoords({ location: `14°45'06.1"N 121°03'26.3"E` });
    expect(r).not.toBeNull();
    expect(r.latitude).toBeCloseTo(14.751694, 5);
    expect(r.longitude).toBeCloseTo(121.057306, 5);
  });

  it("parses a DMS string with the hemisphere separated by a space", () => {
    const r = resolveIncidentCoords({ location: `14°45'06.1 N 121°03'26.3 E` });
    expect(r).not.toBeNull();
    expect(r.latitude).toBeCloseTo(14.751694, 5);
    expect(r.longitude).toBeCloseTo(121.057306, 5);
  });

  it("handles southern/western hemispheres as negative", () => {
    const r = resolveIncidentCoords({ location: `14°45'06.1"S 121°03'26.3"W` });
    expect(r).not.toBeNull();
    expect(r.latitude).toBeLessThan(0);
    expect(r.longitude).toBeLessThan(0);
  });

  it("returns null for text-only or missing locations", () => {
    expect(resolveIncidentCoords({ location: "bagumbong dulo" })).toBeNull();
    expect(resolveIncidentCoords({ location: "haha" })).toBeNull();
    expect(resolveIncidentCoords({})).toBeNull();
    expect(resolveIncidentCoords(null)).toBeNull();
  });
});
