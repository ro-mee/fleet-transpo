import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import * as apiUtils from "@/lib/api/utils";
import * as rateLimits from "@/lib/rate-limit";
import * as psgc from "@/lib/geo/psgc";
import * as postalService from "@/services/postal-code.service";

const CHAIN = {
  region: { code: "0400000000", name: "CALABARZON (Region IV-A)" },
  province: { code: "0434000000", name: "Laguna" },
  city: { code: "0434040000", name: "Santa Rosa City" },
  barangay: { code: "043404001", name: "Balibago" },
};

const request = (body) => ({ json: async () => body });

beforeEach(() => {
  vi.spyOn(apiUtils, "requirePermission").mockResolvedValue({ user: { employeeId: 60 } });
  vi.spyOn(rateLimits, "rateLimit").mockResolvedValue({ allowed: true, remaining: 29, retryAfter: 0 });
  vi.spyOn(psgc, "resolveBarangayChain").mockResolvedValue(CHAIN);
  vi.spyOn(postalService, "checkPostalCodeForLocality").mockResolvedValue({
    status: "match",
    postalCodes: ["4026"],
  });
});

afterEach(() => vi.restoreAllMocks());

describe("POST /api/address/postal-check", () => {
  it("derives the locality from the barangay code and returns the ZIP status", async () => {
    const response = await POST(request({ psgcBarangayCode: "043404001", postalCode: "4026" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "match", postalCodes: ["4026"] });
    expect(postalService.checkPostalCodeForLocality).toHaveBeenCalledWith({
      province: "Laguna",
      locality: "Santa Rosa City",
      postalCode: "4026",
    });
  });

  it("keeps uncovered NCR localities unknown", async () => {
    vi.spyOn(psgc, "resolveBarangayChain").mockResolvedValue({
      region: { code: "1300000000", name: "National Capital Region (NCR)" },
      province: null,
      city: { code: "1339000000", name: "City of Caloocan" },
      barangay: { code: "1339000001", name: "Barangay 169" },
    });
    vi.spyOn(postalService, "checkPostalCodeForLocality").mockResolvedValue({
      status: "unknown",
      postalCodes: [],
    });

    const response = await POST(request({ psgcBarangayCode: "1339000001", postalCode: "4122" }));

    expect(await response.json()).toEqual({ status: "unknown", postalCodes: [] });
  });

  it("does not query the directory without a valid selection and four digits", async () => {
    const response = await POST(request({ psgcBarangayCode: "bad", postalCode: "402" }));
    expect(response.status).toBe(400);
    expect(postalService.checkPostalCodeForLocality).not.toHaveBeenCalled();
  });
});
