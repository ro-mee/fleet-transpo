import { afterEach, describe, expect, it, vi } from "vitest";
import * as db from "@/lib/db";
import { checkPostalCodeForLocality, getPostalCodesForLocality } from "./postal-code.service";

afterEach(() => vi.restoreAllMocks());

describe("PHLPost postal lookup", () => {
  it("uses normalized province and locality keys with a parameterized query", async () => {
    const query = vi.spyOn(db, "query").mockResolvedValue({ rows: [{ postal_code: "4026" }] });

    await expect(getPostalCodesForLocality({ province: "Laguna", locality: "City of Santa Rosa City" }))
      .resolves.toEqual([{ postalCode: "4026" }]);
    expect(query.mock.calls[0][0]).toContain("FROM phlpost_postal_codes");
    expect(query.mock.calls[0][1]).toEqual(["laguna", "santarosa"]);
  });

  it("marks an uncovered locality unknown instead of treating absence as a mismatch", async () => {
    vi.spyOn(db, "query").mockResolvedValue({ rows: [] });
    await expect(checkPostalCodeForLocality({
      province: "Metro Manila",
      locality: "City of Caloocan",
      postalCode: "4122",
    })).resolves.toEqual({ status: "unknown", postalCodes: [] });
  });
});
