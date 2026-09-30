import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQuery = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ query: mockQuery }));

import { rateLimit } from "@/lib/rate-limit";

describe("rateLimit weighted hits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [{ hit_count: 3, retry_after: 40 }] });
  });

  it("adds the supplied cost within an active window", async () => {
    const result = await rateLimit("license-view:test", { limit: 10, windowMs: 60_000, cost: 3 });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("auth_rate_limits.hit_count + $4");
    expect(params).toEqual(["license-view:test", 60_000, 10, 3]);
    expect(result.allowed).toBe(true);
  });
});
