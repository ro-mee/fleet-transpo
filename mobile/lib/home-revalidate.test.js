import { describe, it, expect } from "vitest";
import { shouldRevalidateHome } from "./home-revalidate.js";

describe("shouldRevalidateHome", () => {
  it("skips refetch when synced <30s ago", () => {
    expect(shouldRevalidateHome(Date.now() - 10_000, Date.now())).toBe(false);
  });
  it("refetches when never synced or stale", () => {
    expect(shouldRevalidateHome(null, Date.now())).toBe(true);
    expect(shouldRevalidateHome(Date.now() - 120_000, Date.now())).toBe(true);
  });
});
