import { describe, expect, it } from "vitest";
import { validateVehicleImage } from "./vehicle-image";

describe("validateVehicleImage", () => {
  it("accepts real image signatures and rejects MIME spoofing", () => {
    expect(validateVehicleImage(
      { type: "image/png", size: 8 },
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )).toEqual({ contentType: "image/png", extension: "png" });

    expect(validateVehicleImage(
      { type: "image/png", size: 8 },
      new Uint8Array([0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74])
    ).error).toMatch(/does not match/i);
  });
});
