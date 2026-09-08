// Tests for the PR #4 driver banner derivation — the ONE minimal, calm banner
// the driver sees from the ingest-side monitor payload.
//
// Contract:
// - copy is driving-appropriate: no risk-level jargon (NORMAL/ACTION never
//   appear), no dispatcher-style next-trip panic;
// - priority: deviation > traffic > GPS delay;
// - traffic only from 5 min up (matches the WATCH threshold); null/0 traffic
//   is silence, never Number(null)===0 laundering "unknown" into a warning;
// - a non-live/absent payload is silence — no fabricated warnings.
import { describe, it, expect } from "vitest";
import { monitorBannerFor } from "./monitor-banner";

describe("monitorBannerFor", () => {
  it("returns nothing for null, non-live, or healthy payloads", () => {
    expect(monitorBannerFor(null)).toBeNull();
    expect(monitorBannerFor(undefined)).toBeNull();
    expect(monitorBannerFor({ tripId: 1, live: false })).toBeNull();
    expect(monitorBannerFor({
      live: true,
      risk: "NORMAL",
      gpsHealth: "fresh",
      trafficDelayMin: 0,
      offRoute: { state: "on_route" },
    })).toBeNull();
  });

  it("an unknown traffic delay is silence, never a fabricated warning", () => {
    expect(monitorBannerFor({ live: true, trafficDelayMin: null, offRoute: { state: "unknown" } })).toBeNull();
    expect(monitorBannerFor({ live: true, trafficDelayMin: undefined })).toBeNull();
    expect(monitorBannerFor({ live: true, trafficDelayMin: 4 })).toBeNull();
  });

  it("traffic ≥ 5 min renders the calm heavy-traffic banner with the rounded delay", () => {
    expect(monitorBannerFor({ live: true, trafficDelayMin: 8, offRoute: { state: "on_route" } }))
      .toEqual({
        key: "traffic",
        title: "Heavy traffic ahead",
        subtitle: "Arrival may be delayed by about 8 min.",
      });
    expect(monitorBannerFor({ live: true, trafficDelayMin: "7.4" }).subtitle)
      .toBe("Arrival may be delayed by about 7 min.");
  });

  it("a confirmed deviation beats traffic, with check-navigation copy", () => {
    expect(monitorBannerFor({
      live: true,
      trafficDelayMin: 12,
      offRoute: { state: "off_route", distanceM: 400 },
    })).toEqual({
      key: "off_route",
      title: "Route deviation detected",
      subtitle: "Check your navigation when safe.",
    });
    // A single unconfirmed observation never warns.
    expect(monitorBannerFor({ live: true, offRoute: { state: "unknown" }, trafficDelayMin: null })).toBeNull();
  });

  it("delayed GPS renders the keep-location-enabled banner", () => {
    expect(monitorBannerFor({ live: true, gpsHealth: "delayed", offRoute: { state: "on_route" }, trafficDelayMin: null }))
      .toEqual({
        key: "gps",
        title: "GPS updates delayed",
        subtitle: "Keep location access enabled.",
      });
  });
});
