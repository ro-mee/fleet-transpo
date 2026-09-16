import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(),
  peekRateLimit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { rateLimit, peekRateLimit } from "@/lib/rate-limit";
import { query } from "@/lib/db";
import {
  LOCKOUT_LIMIT,
  LOCKOUT_WINDOW_MS,
  lockoutKey,
  checkAccountLockout,
  recordFailedAttempt,
  clearAccountLockout,
} from "./account-lockout";

beforeEach(() => vi.clearAllMocks());

describe("account lockout", () => {
  it("uses a 10-attempt, 15-minute budget", () => {
    expect(LOCKOUT_LIMIT).toBe(10);
    expect(LOCKOUT_WINDOW_MS).toBe(15 * 60_000);
  });

  it("keys buckets by normalized email", () => {
    expect(lockoutKey("  Admin@FleetOps.com ")).toBe("lockout:account:admin@fleetops.com");
  });

  it("checks without consuming", async () => {
    peekRateLimit.mockResolvedValue({ allowed: true, remaining: 7, retryAfter: 0 });
    const result = await checkAccountLockout("a@b.com");
    expect(peekRateLimit).toHaveBeenCalledWith("lockout:account:a@b.com", { limit: 10, windowMs: 900_000 });
    expect(rateLimit).not.toHaveBeenCalled();
    expect(result.allowed).toBe(true);
  });

  it("records a failure by consuming one hit", async () => {
    rateLimit.mockResolvedValue({ allowed: true, remaining: 6, retryAfter: 0 });
    await recordFailedAttempt("a@b.com");
    expect(rateLimit).toHaveBeenCalledWith("lockout:account:a@b.com", { limit: 10, windowMs: 900_000 });
  });

  it("clears the bucket on successful login", async () => {
    await clearAccountLockout("a@b.com");
    expect(query).toHaveBeenCalledWith(
      "DELETE FROM auth_rate_limits WHERE bucket_key = $1",
      ["lockout:account:a@b.com"]
    );
  });
});
