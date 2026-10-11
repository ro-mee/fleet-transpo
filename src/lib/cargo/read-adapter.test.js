import { expect, it, vi } from "vitest";
import { createCargoReadAdapter } from "./read-adapter";

function adapterFor(query) {
  const tx = { query };
  const db = { withTransaction: (work) => work(tx) };
  return createCargoReadAdapter({
    db,
    config: {},
    simulated: true,
    environment: "test",
    approvalRef: "fixture:read",
    authorizeStaffRead: async () => true,
  });
}

it("returns bounded activity fields and current feedback state without receipt or acknowledgement payloads", async () => {
  const query = vi.fn()
    .mockResolvedValueOnce({ rows: [{ event_id: "event-1", event_type: "SOURCE_DECISION_RECORDED", execution_version: 3, occurred_at: "2026-10-10T00:00:00Z", action: "WAIT" }, { event_id: "event-2" }] })
    .mockResolvedValueOnce({ rows: [{ event_id: "event-3", status: "FAILED", last_error_code: "GATEWAY_TIMEOUT" }] });

  const result = await adapterFor(query).readHistory({
    tripId: 7,
    session: { user: { role: "dispatcher" } },
    limit: 1,
    offset: 0,
  });

  expect(result).toEqual({
    rows: [{ event_id: "event-1", event_type: "SOURCE_DECISION_RECORDED", execution_version: 3, occurred_at: "2026-10-10T00:00:00Z", action: "WAIT" }],
    has_more: true,
    latest_feedback: { event_id: "event-3", status: "FAILED", last_error_code: "GATEWAY_TIMEOUT" },
  });
  expect(query.mock.calls[0][0]).not.toMatch(/payload|acknowledgement|contact|proof|provenance/i);
  expect(query.mock.calls[0][1]).toEqual([7, 2, 0]);
});

it("resolves a source link only through persisted manifest and dispatch relationships", async () => {
  const shipmentId = "22222222-2222-4222-8222-222222222222";
  const query = vi.fn().mockResolvedValue({ rows: [{ kind: "SUPPLY", local_id: shipmentId }] });

  const link = await adapterFor(query).resolveSourceLink({ tripId: 7, session: { user: { role: "dispatcher" } } });

  expect(link).toEqual({ kind: "SUPPLY", local_id: shipmentId });
  expect(query.mock.calls[0][0]).toContain("e.supply_allocation_id");
  expect(query.mock.calls[0][0]).toContain("supply_dispatch_allocations");
  expect(query.mock.calls[0][0]).toContain("request_cargo_manifest_revisions");
  expect(query.mock.calls[0][0]).not.toContain("external_request_id");
  expect(query.mock.calls[0][1]).toEqual([7]);
});

it("does not pick one destination when persisted relationships are ambiguous", async () => {
  const query = vi.fn().mockResolvedValue({ rows: [
    { kind: "REQUEST", local_id: "41" },
    { kind: "SUPPLY", local_id: "22222222-2222-4222-8222-222222222222" },
  ] });

  await expect(adapterFor(query).resolveSourceLink({ tripId: 7, session: { user: { role: "dispatcher" } } })).resolves.toBeNull();
});
