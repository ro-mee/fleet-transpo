import { describe, it, expect } from "vitest";
import { isGoogleMapsUrl, parseGoogleMapsCoordinates } from "@/lib/google-maps";

describe("Google Maps coordinate links", () => {
  it("extracts coordinates from common Google Maps URLs", () => {
    expect(parseGoogleMapsCoordinates("https://www.google.com/maps/@14.5097,121.0006,17z")).toEqual({ latitude: 14.5097, longitude: 121.0006 });
    expect(parseGoogleMapsCoordinates("https://www.google.com/maps/search/?api=1&query=14.5097%2C121.0006")).toEqual({ latitude: 14.5097, longitude: 121.0006 });
    expect(parseGoogleMapsCoordinates("https://www.google.com/maps/place/NAIA/data=!3d14.5097!4d121.0006")).toEqual({ latitude: 14.5097, longitude: 121.0006 });
  });

  it("rejects non-Google links and out-of-range coordinates", () => {
    expect(isGoogleMapsUrl("https://example.com/@14.5,121.0,17z")).toBe(false);
    expect(parseGoogleMapsCoordinates("https://www.google.com/maps/@95,121,17z")).toBeNull();
  });
});
