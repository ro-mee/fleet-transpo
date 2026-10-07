import { describe, it, expect } from "vitest";
import { TRIPS_SELECT, TRIPS_JOINS } from "@/lib/api/trips-query";

// Live-map operational projection: priority/VIP/service signals ride the
// shared trips read path (projection only — no schema change). Guest PII
// stays out: the trips views need locations and identifiers only.
describe("trips-query live-map projection", () => {
  it("projects priority/VIP/emergency/service signals on the request object", () => {
    for (const field of ["is_vip", "is_emergency", "derived_priority", "service_type_id", "service_name", "priority"]) {
      expect(TRIPS_SELECT).toContain(field);
    }
  });

  it("joins service_types for the service name", () => {
    expect(TRIPS_JOINS).toContain("service_types");
    expect(TRIPS_SELECT).toContain("service_name");
  });

  it("projects typed load signals for cargo presentation copy", () => {
    // Operational consignment facts only — guest PII stays out (see below).
    // These columns exist only after migration 151: reads against a
    // pre-migration database fail, so do not deploy before it is applied.
    for (const field of ["load_type", "cargo_weight_kg", "cargo_description"]) {
      expect(TRIPS_SELECT).toContain(field);
    }
  });

  it("does not widen guest PII into the trips views", () => {
    for (const field of ["guest_name", "guest_phone", "guest_email", "booking_reference", "special_requests"]) {
      expect(TRIPS_SELECT).not.toContain(field);
    }
  });
});
