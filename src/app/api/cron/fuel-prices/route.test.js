import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api/utils", () => ({
  ok: (body, status = 200) => Response.json(body, { status }),
  err: (message, status) => Response.json({ error: message }, { status }),
  handleError: (e) => Response.json({ error: e.message }, { status: e.status ?? 500 }),
}));
vi.mock("@/lib/api/service-auth", () => ({ verifyServiceToken: vi.fn() }));
vi.mock("@/lib/fuel/providers/official-reference", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchReferencePrice: vi.fn(),
}));

import { verifyServiceToken } from "@/lib/api/service-auth";
import { fetchReferencePrice } from "@/lib/fuel/providers/official-reference";
import { GET } from "./route";

const authed = () => verifyServiceToken.mockReturnValue({ ok: true });
const call = () => GET(new Request("http://localhost/api/cron/fuel-prices"));

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.FUEL_PRICE_PROVIDER_ENABLED;
  delete process.env.FUEL_PRICE_SOURCE_ID;
  delete process.env.FUEL_PRICE_SOURCE_URL;
});

describe("GET /api/cron/fuel-prices", () => {
  it("rejects callers without the cron secret", async () => {
    verifyServiceToken.mockReturnValue({ ok: false, message: "Forbidden", status: 401 });
    const res = await call();
    expect(res.status).toBe(401);
    expect(fetchReferencePrice).not.toHaveBeenCalled();
  });

  it("stays disabled until an official source is activated, pointing at manual snapshots", async () => {
    authed();
    const res = await call();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/not activated/i);
    expect(body.manual).toMatch(/manual verified snapshots/i);
    expect(fetchReferencePrice).not.toHaveBeenCalled();
  });

  it("validates a fetched announcement into a Pending payload without persisting", async () => {
    authed();
    process.env.FUEL_PRICE_PROVIDER_ENABLED = "1";
    process.env.FUEL_PRICE_SOURCE_ID = "DOE_PH";
    process.env.FUEL_PRICE_SOURCE_URL = "https://example.ph/doe";
    fetchReferencePrice.mockResolvedValue({
      ok: true,
      data: {
        fuel_product: "Diesel",
        region: "NCR",
        reference_price: 62.7,
        prior_price: 61.9,
        announced_at: "2026-09-28T09:00:00+08:00",
        effective_at: "2026-10-01T00:00:00+08:00",
        source_url: "https://example.ph/doe/diesel-ncr",
      },
    });
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcome).toBe("validated-pending");
    expect(body.snapshot).toMatchObject({ lifecycle: "Pending", verification_method: "Automatic" });
    expect(body.persisted).toBe(false);
  });

  it("retains the last verified snapshot on fetch failure or implausible data", async () => {
    authed();
    process.env.FUEL_PRICE_PROVIDER_ENABLED = "1";
    process.env.FUEL_PRICE_SOURCE_ID = "DOE_PH";
    process.env.FUEL_PRICE_SOURCE_URL = "https://example.ph/doe";

    fetchReferencePrice.mockResolvedValue({ ok: false, reason: "Provider fetch failed (status 429): retaining the last verified snapshot." });
    let res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("retained");

    fetchReferencePrice.mockResolvedValue({
      ok: true,
      data: {
        fuel_product: "Diesel",
        region: "NCR",
        reference_price: "sixty",
        effective_at: "2026-10-01T00:00:00+08:00",
        source_url: "https://example.ph/doe/diesel-ncr",
      },
    });
    res = await call();
    expect((await res.json()).outcome).toBe("retained");
  });
});
