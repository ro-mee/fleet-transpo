import { describe, expect, it } from "vitest";
import { normalizeInboundEnvelope } from "@/lib/integration/source-contract";

const request = { pickup_location: "Lobby", pickup_datetime: "2026-10-05T10:00:00+08:00" };
const typedRequest = { ...request, load_type: "Passenger", service_code: "GUEST_TRANSPORT", passenger_count: 1 };
const v2Create = (value) => normalizeInboundEnvelope({
  contract_version: 2,
  external_request_id: "location-request",
  external_revision: 1,
  event_id: "location-event",
  event_kind: "create",
  request: value,
}, "PMS").request;

describe("authenticated inbound source contract", () => {
  it("maps legacy PMS booking IDs without trusting a forged source", () => {
    const out = normalizeInboundEnvelope({ ...request, external_booking_id: "123", source_system: "POS" }, "PMS");
    expect(out).toMatchObject({ contract_version: 1, source_system: "PMS", external_request_id: "123", external_revision: 1, event_kind: "create" });
    expect(out.request.source_system).toBe("PMS");
    expect(out.request.external_booking_id).toBe("123");
  });

  it("keeps identical IDs from PMS and POS distinct", () => {
    const raw = { contract_version: 2, external_request_id: "123", external_revision: 2, event_id: "ev-12", event_kind: "update", request: typedRequest };
    expect(normalizeInboundEnvelope(raw, "PMS").source_system).toBe("PMS");
    expect(normalizeInboundEnvelope({ ...raw, source_system: "PMS" }, "POS").source_system).toBe("POS");
  });

  it("rejects unsupported versions and invalid revision IDs", () => {
    expect(() => normalizeInboundEnvelope({ contract_version: 3, external_request_id: "123", request }, "POS")).toThrow();
    expect(() => normalizeInboundEnvelope({ contract_version: 2, external_request_id: "123", external_revision: -1, event_id: "e", event_kind: "create", request }, "POS")).toThrow();
  });

  it("preserves the exact opaque ID across legacy and v2 without aliasing", () => {
    const old = normalizeInboundEnvelope({ ...request, external_booking_id: " 123 " }, "PMS");
    const newer = normalizeInboundEnvelope({ contract_version: 2, external_request_id: " 123 ", external_revision: 1, event_id: "event-1", event_kind: "create", request: typedRequest }, "PMS");
    expect(old.external_request_id).toBe(" 123 ");
    expect(newer.external_request_id).toBe(old.external_request_id);
    expect(newer.request.external_booking_id).toBe(" 123 ");
    expect(() => normalizeInboundEnvelope({ contract_version: 2, external_request_id: "   ", external_revision: 1, event_id: "event-2", event_kind: "create", request }, "PMS")).toThrow();
  });

  it("requires explicit typed service and a positive passenger count for v2", () => {
    const envelope = { contract_version: 2, external_request_id: "p4", external_revision: 1, event_id: "evt-p4", event_kind: "create" };
    const passenger = { ...request, load_type: "Passenger", service_code: "GUEST_TRANSPORT", passenger_count: 4 };
    expect(normalizeInboundEnvelope({ ...envelope, request: passenger }, "PMS").request).toMatchObject({ passenger_count: 4, service_code: "GUEST_TRANSPORT", load_type: "Passenger" });
    for (const count of [0, undefined, -1, 2147483648]) {
      expect(() => normalizeInboundEnvelope({ ...envelope, request: { ...passenger, passenger_count: count } }, "PMS")).toThrow();
    }
  });

  it("accepts cargo without phantom passengers and rejects invalid weights or mismatched services", () => {
    const envelope = { contract_version: 2, external_request_id: "c650", external_revision: 1, event_id: "evt-c650", event_kind: "create" };
    const cargo = { ...request, load_type: "Cargo", service_code: "RESTAURANT_SUPPLY_PICKUP", cargo_weight_kg: 650, cargo_description: "Vegetables" };
    expect(normalizeInboundEnvelope({ ...envelope, request: cargo }, "POS").request).toMatchObject({ passenger_count: null, cargo_weight_kg: 650, load_type: "Cargo" });
    expect(normalizeInboundEnvelope({ ...envelope, request: { ...cargo, passenger_count: 0 } }, "POS").request.passenger_count).toBeNull();
    for (const weight of [0, -1, "NaN", NaN, Infinity, 0.0001, 999999999.9999, 1000000000]) {
      expect(() => normalizeInboundEnvelope({ ...envelope, request: { ...cargo, cargo_weight_kg: weight } }, "POS")).toThrow();
    }
    expect(() => normalizeInboundEnvelope({ ...envelope, request: { ...cargo, service_code: "GUEST_TRANSPORT" } }, "POS")).toThrow();
    expect(() => normalizeInboundEnvelope({ ...envelope, request: { ...cargo, passenger_count: 2 } }, "POS")).toThrow();
    expect(() => normalizeInboundEnvelope({ ...envelope, request: { ...cargo, cargo_description: "" } }, "POS")).toThrow();
    expect(() => normalizeInboundEnvelope({ ...envelope, request: { ...cargo, cargo_description: "x".repeat(2001) } }, "POS")).toThrow();
    expect(() => normalizeInboundEnvelope({ ...envelope, request: { ...cargo, source_department: "x".repeat(101) } }, "POS")).toThrow();
  });

  it("keeps legacy PMS missing passenger count default at one", () => {
    expect(normalizeInboundEnvelope({ ...request, external_booking_id: "old" }, "PMS").request.passenger_count).toBe(1);
  });

  it("does not permit POS to use the legacy PMS-only envelope", () => {
    expect(() => normalizeInboundEnvelope({ ...request, external_booking_id: "123" }, "POS")).toThrow();
  });

  it("accepts proposals and codes without changing partner location text", () => {
    const normalized = v2Create({
      ...typedRequest,
      pickup_location: "Original pickup label",
      dropoff_location: "Original drop-off label",
      pickup_location_code: "74dd0286-7124-4123-ae99-6896c82348cb",
      dropoff_location_code: "36394b69-57e6-4518-aaca-a755c1754f84",
      pickup_location_proposal: { address: "Hotel driveway", latitude: 14.5524, longitude: 121.0198 },
      dropoff_location_proposal: { address: "Terminal curb", latitude: 14.5086, longitude: 121.0194 },
    });

    expect(normalized).toMatchObject({
      pickup_location: "Original pickup label",
      dropoff_location: "Original drop-off label",
      pickup_location_code: "74dd0286-7124-4123-ae99-6896c82348cb",
      dropoff_location_code: "36394b69-57e6-4518-aaca-a755c1754f84",
      pickup_location_proposal: { address: "Hotel driveway", latitude: 14.5524, longitude: 121.0198 },
      dropoff_location_proposal: { address: "Terminal curb", latitude: 14.5086, longitude: 121.0194 },
    });
  });

  it("accepts a nonempty address-only proposal", () => {
    expect(v2Create({ ...typedRequest, pickup_location_proposal: { address: "Terminal door 3" } }))
      .toMatchObject({ pickup_location_proposal: { address: "Terminal door 3" } });
  });

  it("accepts a complete coordinate-only proposal", () => {
    expect(v2Create({ ...typedRequest, pickup_location_proposal: { latitude: -90, longitude: 180 } }))
      .toMatchObject({ pickup_location_proposal: { latitude: -90, longitude: 180 } });
  });

  it("rejects a partial proposal coordinate pair", () => {
    expect(() => v2Create({ ...typedRequest, pickup_location_proposal: { latitude: 14.5 } })).toThrow();
  });

  it.each([
    { latitude: 90.01, longitude: 121 },
    { latitude: 14, longitude: -180.01 },
    { latitude: NaN, longitude: 121 },
  ])("rejects out-of-range or non-finite proposal coordinates: %o", (coordinates) => {
    expect(() => v2Create({ ...typedRequest, pickup_location_proposal: coordinates })).toThrow();
  });

  it("rejects an oversized proposal address", () => {
    expect(() => v2Create({ ...typedRequest, pickup_location_proposal: { address: "x".repeat(2001) } })).toThrow();
    expect(() => v2Create({ ...typedRequest, pickup_location_proposal: { address: `${" ".repeat(2000)}x` } })).toThrow();
  });

  it("rejects blank addresses and unknown proposal keys", () => {
    expect(() => v2Create({ ...typedRequest, pickup_location_proposal: { address: "   " } })).toThrow();
    expect(() => v2Create({ ...typedRequest, pickup_location_proposal: { address: "Gate", source: "partner" } })).toThrow();
  });

  it("accepts only UUID-shaped v2 location codes", () => {
    expect(v2Create({
      ...typedRequest,
      pickup_location_code: "74dd0286-7124-4123-ae99-6896c82348cb",
    }).pickup_location_code).toBe("74dd0286-7124-4123-ae99-6896c82348cb");
    expect(() => v2Create({ ...typedRequest, dropoff_location_code: "not-a-uuid" })).toThrow();
  });
});
