import { describe, expect, it } from "vitest";
import { normalizeInboundEnvelope } from "@/lib/integration/source-contract";

const request = { pickup_location: "Lobby", pickup_datetime: "2026-10-05T10:00:00+08:00" };

describe("authenticated inbound source contract", () => {
  it("maps legacy PMS booking IDs without trusting a forged source", () => {
    const out = normalizeInboundEnvelope({ ...request, external_booking_id: "123", source_system: "POS" }, "PMS");
    expect(out).toMatchObject({ contract_version: 1, source_system: "PMS", external_request_id: "123", external_revision: 1, event_kind: "create" });
    expect(out.request.source_system).toBe("PMS");
    expect(out.request.external_booking_id).toBe("123");
  });

  it("keeps identical IDs from PMS and POS distinct", () => {
    const raw = { contract_version: 2, external_request_id: "123", external_revision: 2, event_id: "ev-12", event_kind: "update", request };
    expect(normalizeInboundEnvelope(raw, "PMS").source_system).toBe("PMS");
    expect(normalizeInboundEnvelope({ ...raw, source_system: "PMS" }, "POS").source_system).toBe("POS");
  });

  it("rejects unsupported versions and invalid revision IDs", () => {
    expect(() => normalizeInboundEnvelope({ contract_version: 3, external_request_id: "123", request }, "POS")).toThrow();
    expect(() => normalizeInboundEnvelope({ contract_version: 2, external_request_id: "123", external_revision: -1, event_id: "e", event_kind: "create", request }, "POS")).toThrow();
  });

  it("preserves the exact opaque ID across legacy and v2 without aliasing", () => {
    const old = normalizeInboundEnvelope({ ...request, external_booking_id: " 123 " }, "PMS");
    const newer = normalizeInboundEnvelope({ contract_version: 2, external_request_id: " 123 ", external_revision: 1, event_id: "event-1", event_kind: "create", request }, "PMS");
    expect(old.external_request_id).toBe(" 123 ");
    expect(newer.external_request_id).toBe(old.external_request_id);
    expect(newer.request.external_booking_id).toBe(" 123 ");
    expect(() => normalizeInboundEnvelope({ contract_version: 2, external_request_id: "   ", external_revision: 1, event_id: "event-2", event_kind: "create", request }, "PMS")).toThrow();
  });

  it("does not permit POS to use the legacy PMS-only envelope", () => {
    expect(() => normalizeInboundEnvelope({ ...request, external_booking_id: "123" }, "POS")).toThrow();
  });
});
