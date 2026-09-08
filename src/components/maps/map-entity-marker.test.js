// Tests for the PR #4 restrained monitor-risk marker accent.
//
// Contract: the premium trip marker keeps its identity (plate, icon,
// selection); only tone/status/z-lift change with the live-monitor risk —
// and only for TRIP markers. NORMAL changes nothing (a healthy trip reads as
// its phase color), a stale-GPS marker is never overridden ("No signal" is
// already the honest telemetry verdict), and rescue/incident markers are
// untouched (their severity vocabularies are their own).
import { describe, it, expect } from "vitest";
import { resolveMarkerConfig } from "./map-entity-marker";

const TRIP = {
  trip_id: 101,
  plate_number: "ABC 1234",
  trip_status: "Passenger Onboard",
  recorded_at: new Date().toISOString(),
};

function configFor(risk, entity = TRIP, context = {}) {
  return resolveMarkerConfig(entity, { monitorRisk: risk, ...context });
}

describe("resolveMarkerConfig monitor risk accent", () => {
  it("NORMAL — and no risk at all — keeps the premium phase marker untouched", () => {
    expect(configFor(null)).toMatchObject({ status: "On trip", tone: "green", pulse: false });
    expect(configFor("NORMAL")).toMatchObject({ status: "On trip", tone: "green", pulse: false });
  });

  it("ACTION lifts the marker to rose, pulsing, on top of the stack", () => {
    expect(configFor("ACTION")).toMatchObject({
      status: "Action needed",
      tone: "rose",
      pulse: true,
      zIndexOffset: 2400,
    });
  });

  it("ATTENTION and WATCH read amber; UNKNOWN reads gray", () => {
    expect(configFor("ATTENTION")).toMatchObject({ status: "Attention", tone: "amber", zIndexOffset: 1500 });
    expect(configFor("WATCH")).toMatchObject({ status: "Watch", tone: "amber" });
    expect(configFor("UNKNOWN")).toMatchObject({ status: "Status unknown", tone: "gray" });
  });

  it("never overrides a stale-GPS marker", () => {
    const stale = { ...TRIP, recorded_at: new Date(Date.now() - 30 * 60 * 1000).toISOString() };
    expect(configFor("ACTION", stale)).toMatchObject({ status: "No signal", tone: "gray", stale: true });
  });

  it("leaves rescue and incident markers to their own severity vocabularies", () => {
    const rescue = resolveMarkerConfig(
      { incident_id: 7, responder: { name: "Unit 1" }, response_status: "Dispatched" },
      { type: "rescue", monitorRisk: "ACTION" }
    );
    expect(rescue).toMatchObject({ type: "rescue", tone: "blue" });

    const incident = resolveMarkerConfig(
      { incident_id: 9, severity: "Critical", incident_type: "Breakdown" },
      { type: "incident", monitorRisk: "ACTION" }
    );
    expect(incident).toMatchObject({ type: "incident", tone: "rose" });
  });
});
