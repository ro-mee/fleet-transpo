import { describe, expect, it } from "vitest";
import { classifyPostalCode, postalNameKey, postalProvinceName } from "./postal-reference";

describe("postalNameKey", () => {
  it("joins PSGC city labels to PHLPost locality labels", () => {
    expect(postalNameKey("City of Santa Rosa City")).toBe("santarosa");
    expect(postalNameKey("Peñarrubia")).toBe("penarrubia");
  });
});

describe("classifyPostalCode", () => {
  it("accepts any listed ZIP for a locality with multiple postal areas", () => {
    expect(classifyPostalCode([{ postalCode: "1000" }, { postalCode: "1002" }], "1002")).toEqual({
      status: "match",
      postalCodes: ["1000", "1002"],
    });
  });

  it("reports a mismatch only when the locality has reference rows", () => {
    expect(classifyPostalCode([{ postal_code: "4026" }], "4122")).toEqual({
      status: "mismatch",
      postalCodes: ["4026"],
    });
  });

  it("leaves uncovered localities unknown", () => {
    expect(classifyPostalCode([], "4122")).toEqual({ status: "unknown", postalCodes: [] });
  });
});

describe("postalProvinceName", () => {
  it("maps a province-less NCR chain to PHLPost's Metro Manila label", () => {
    expect(postalProvinceName({ region: { name: "National Capital Region (NCR)" } })).toBe("Metro Manila");
  });
});
