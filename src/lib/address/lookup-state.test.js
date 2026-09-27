import { describe, expect, it } from "vitest";
import { isCurrentAddressLookup } from "./lookup-state";

describe("isCurrentAddressLookup", () => {
  it("accepts only the active request for the current address", () => {
    const controller = {};
    expect(isCurrentAddressLookup({
      requestedQuery: "12 Main Street, Philippines",
      currentQuery: "12 Main Street, Philippines",
      requestController: controller,
      activeController: controller,
    })).toBe(true);
  });

  it("rejects a response after the address changes or a newer lookup takes over", () => {
    const oldController = {};
    const newController = {};
    expect(isCurrentAddressLookup({
      requestedQuery: "12 Main Street, Philippines",
      currentQuery: "14 Main Street, Philippines",
      requestController: oldController,
      activeController: oldController,
    })).toBe(false);
    expect(isCurrentAddressLookup({
      requestedQuery: "12 Main Street, Philippines",
      currentQuery: "12 Main Street, Philippines",
      requestController: oldController,
      activeController: newController,
    })).toBe(false);
  });
});
