import { describe, expect, it } from "vitest";
import {
  parseOfficialReference,
  validateProviderUpdate,
  fetchReferencePrice,
} from "@/lib/fuel/providers/official-reference";

const SOURCE = { id: "DOE_PH", origin: "https://example.ph" };

const FIXTURE = {
  fuel_product: "Diesel",
  region: "NCR",
  reference_price: 62.7,
  prior_price: 61.9,
  announced_at: "2026-09-28T09:00:00+08:00",
  effective_at: "2026-10-01T00:00:00+08:00",
  source_url: "https://example.ph/doe/diesel-ncr",
};

describe("parseOfficialReference", () => {
  it("parses price, adjustment, source URL and effectivity from a fixture", () => {
    const parsed = parseOfficialReference(FIXTURE, SOURCE);
    expect(parsed).toMatchObject({
      fuel_product: "Diesel",
      region: "NCR",
      reference_price: 62.7,
      prior_price: 61.9,
      source_url: "https://example.ph/doe/diesel-ncr",
    });
    expect(new Date(parsed.effective_at).toISOString()).toBe("2026-09-30T16:00:00.000Z");
  });

  it("rejects format drift, untrusted origins and unsigned payloads", () => {
    expect(() => parseOfficialReference({ ...FIXTURE, reference_price: "sixty" }, SOURCE)).toThrow();
    expect(() => parseOfficialReference({ ...FIXTURE, effective_at: "soon" }, SOURCE)).toThrow();
    expect(() => parseOfficialReference({ ...FIXTURE, extra_field: 1 }, SOURCE)).toThrow(/unsupported/i);
    // Off-origin URL: data did not come from the configured source.
    expect(() => parseOfficialReference({ ...FIXTURE, source_url: "http://evil.example/p" }, SOURCE)).toThrow(/origin/i);
    // Unknown source registry entry cannot vouch for anything.
    expect(() => parseOfficialReference(FIXTURE, { id: "???", origin: "https://" })).toThrow();
    expect(() => parseOfficialReference(null, SOURCE)).toThrow();
  });
});

describe("validateProviderUpdate", () => {
  const current = { reference_price: 62, effective_at: "2026-09-01T00:00:00+08:00" };

  it("accepts a sane announcement and flags Pending until effective", () => {
    const r = validateProviderUpdate({ current, candidate: { reference_price: 62.7, effective_at: "2026-10-01T00:00:00+08:00" } });
    expect(r).toMatchObject({ accept: true, lifecycle: "Pending" });
  });

  it("rejects an extreme 620-from-62 jump as an implausible change", () => {
    const r = validateProviderUpdate({ current, candidate: { reference_price: 620, effective_at: "2026-10-01T00:00:00+08:00" } });
    expect(r.accept).toBe(false);
    expect(r.reason).toMatch(/implausible/i);
  });

  it("treats a repeated fetch as a duplicate, never a second row", () => {
    const r = validateProviderUpdate({ current, candidate: { reference_price: 62, effective_at: "2026-09-01T00:00:00+08:00" } });
    expect(r).toMatchObject({ accept: false, duplicate: true });
    const stale = validateProviderUpdate({ current, candidate: { reference_price: 61, effective_at: "2026-08-01T00:00:00+08:00" } });
    expect(stale.accept).toBe(false);
  });
});

describe("fetchReferencePrice", () => {
  it("returns parsed JSON on 200", async () => {
    const r = await fetchReferencePrice({
      sourceUrl: "https://example.ph/doe/diesel-ncr",
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => FIXTURE }),
    });
    expect(r).toMatchObject({ ok: true });
    expect(r.data).toMatchObject({ fuel_product: "Diesel" });
  });

  it("fails closed on 403/429/timeouts/malformed bodies so the last verified snapshot is retained", async () => {
    for (const fetchImpl of [
      async () => ({ ok: false, status: 403, json: async () => ({}) }),
      async () => ({ ok: false, status: 429, json: async () => ({}) }),
      async () => { throw new Error("timeout"); },
      async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } }),
    ]) {
      const r = await fetchReferencePrice({ sourceUrl: "https://example.ph/doe/diesel-ncr", fetchImpl, timeoutMs: 50 });
      expect(r.ok).toBe(false);
      expect(r.reason).toBeTruthy();
    }
  });
});
