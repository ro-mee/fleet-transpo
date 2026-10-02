import { describe, expect, it } from "vitest";
import { getDriverDetailUnavailableMessage } from "./detail-unavailable-message";

describe("getDriverDetailUnavailableMessage", () => {
  it("explains a not-found link may point to an archived profile", () => {
    expect(getDriverDetailUnavailableMessage("Driver not found")).toContain("archived");
    expect(getDriverDetailUnavailableMessage("Driver not found")).toContain("link may be out of date");
  });

  it("preserves other request errors and provides fallback copy", () => {
    expect(getDriverDetailUnavailableMessage("Access denied")).toBe("Access denied");
    expect(getDriverDetailUnavailableMessage()).toContain("may have been archived");
  });
});
