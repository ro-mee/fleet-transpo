import { describe, expect, it } from "vitest";

// Release E Task 14 — end-to-end acceptance for the passenger/cargo + fuel
// plan (docs/superpowers/plans/2026-10-05-fleetops-passenger-cargo-integration-and-fuel.md).
//
// Executable form of the acceptance matrix. DB-backed paths (assign,
// reassignment, direct dispatch, trip start returning the SAME blocker) are
// proven where they live — recommendation-availability.test.js (commit gate),
// load-capacity.test.js (chip/gate parity), prefilter + start/inspection
// suites — and are referenced per case rather than re-mocked here. Everything
// below runs offline with no database.
import { normalizeInboundEnvelope } from "@/lib/integration/source-contract";
import { evaluateVehicleCapacity, formatCapacityBlocker } from "@/lib/scheduling/load-capacity";
import { evaluateRoadReadiness } from "@/lib/vehicles/readiness";
import { preTripItemsForLoad } from "@/lib/inspections/checklists";
import { PRE_TRIP_CARGO_CHECKLIST } from "../mobile/lib/inspection-checklist.js";
import { priceAt } from "@/lib/fuel/price-policy";
import { createPriceRepository } from "@/lib/fuel/price-repository";
import { estimateFuelCost, resolveEstimateDistance } from "@/lib/fuel/trip-estimate";
import { validateProviderUpdate } from "@/lib/fuel/providers/official-reference";
import { cargoServiceEnd, CARGO_HANDLING_DEFAULTS } from "@/lib/scheduling/cargo-schedule";
import { comparePairEvidence } from "@/lib/dispatch/recommendation-ranking";

const envelope = (request) => ({
  contract_version: 2,
  external_request_id: "same-id-123",
  external_revision: 1,
  event_id: "evt-1",
  event_kind: "create",
  request,
});
const passengerReq = {
  pickup_location: "Hotel", pickup_datetime: "2026-10-08T10:00:00+08:00",
  service_code: "GUEST_TRANSPORT", load_type: "Passenger", passenger_count: 4,
};
const cargoReq = (weight) => ({
  pickup_location: "Market", pickup_datetime: "2026-10-08T10:00:00+08:00",
  service_code: "RESTAURANT_SUPPLY_PICKUP", load_type: "Cargo",
  passenger_count: null, cargo_weight_kg: weight, cargo_description: "Vegetables",
});
const cargoVan = (capacity) => ({ vehicle_id: 12, plate_number: "TRK 9", operational_use: "Cargo", seating_capacity: null, cargo_capacity_kg: capacity });

describe("release acceptance", () => {
  it("two sources may share one external id without colliding, and callers cannot impersonate a source", () => {
    const pms = normalizeInboundEnvelope(envelope(passengerReq), "PMS");
    const pos = normalizeInboundEnvelope(envelope(cargoReq(650)), "POS");
    expect(pms.source_system).toBe("PMS");
    expect(pos.source_system).toBe("POS");
    expect(`${pms.source_system}:${pms.external_request_id}`).not.toBe(`${pos.source_system}:${pos.external_request_id}`);
    // A payload declaring PMS while arriving on the POS adapter is POS.
    const spoof = normalizeInboundEnvelope({ ...envelope(cargoReq(650)), source_system: "PMS" }, "POS");
    expect(spoof.source_system).toBe("POS");
  });

  it("cargo 650/1000 passes, 1800/1000 blocks with the same sentence everywhere, 1800/2500 passes", () => {
    expect(evaluateVehicleCapacity(cargoReq(650), cargoVan(1000)).eligible).toBe(true);
    const blocked = evaluateVehicleCapacity(cargoReq(1800), cargoVan(1000));
    expect(blocked).toMatchObject({ eligible: false, code: "OVER_CAPACITY", required: 1800, capacity: 1000 });
    expect(formatCapacityBlocker(blocked, "Vehicle TRK 9")).toBe(
      "Vehicle TRK 9 cargo capacity 1000 kg, request needs 1800 kg (over by 800 kg)."
    );
    expect(evaluateVehicleCapacity(cargoReq(1800), cargoVan(2500)).eligible).toBe(true);
  });

  it("pending commissioning, missing documents and unknown capacity all fail closed", () => {
    const docs = [
      { document_type: "OR_CR", verification_status: "Verified", verified_by: 3, verified_at: "2026-10-01T09:00:00+08:00", expiry_date: "2027-10-01", deleted_at: null },
      { document_type: "Insurance", verification_status: "Pending", verified_by: null, verified_at: null, expiry_date: "2027-06-01", deleted_at: null },
    ];
    const r = evaluateRoadReadiness(
      { plate_number: "TRK 9", commissioning_status: "Pending", maintenance_clear: true, safety_clear: true },
      docs,
      new Date("2026-10-07T08:00:00+08:00")
    );
    expect(r.ready).toBe(false);
    expect(r.blockers).toContain("COMMISSIONING_NOT_READY");
    expect(r.blockers).toContain("INSURANCE_NOT_VERIFIED");
    expect(evaluateVehicleCapacity(cargoReq(650), { operational_use: "Cargo", cargo_capacity_kg: null }).code).toBe("CAPACITY_UNKNOWN");
  });

  it("cargo inspection and lifecycle copy stay in step with the server sets", () => {
    expect(preTripItemsForLoad("Cargo")).toEqual(["brakes_tires", "cargo_secure", "cabin_ready"]);
    expect(PRE_TRIP_CARGO_CHECKLIST.map((i) => i.id)).toEqual(preTripItemsForLoad("Cargo"));
    expect(preTripItemsForLoad("Passenger")).toContain("passenger_items");
  });

  it("right-sized cargo capacity outranks excess only after safety", () => {
    const base = { feasibility: { verdict: "SAFE" }, readiness: "VERIFIED", evaluated: true, checks: [{ status: "verified" }], scheduleEvidence: { transferMinutes: 10 } };
    const van = { ...base, vehicle_id: 2, driver_id: 2, capacityValue: 1000 };
    const truck = { ...base, vehicle_id: 5, driver_id: 5, capacityValue: 2500 };
    expect(comparePairEvidence(van, truck, { load: { unit: "kg", required: 650 } }).code).toBe("CAPACITY_FIT");
  });

  it("36 km at 9 km/L and PHP 62.70/L estimates 4.00 L / PHP 250.80, receipts independent", async () => {
    const distance = resolveEstimateDistance({ odometerKm: null, tripDistanceKm: 36, gpsTrailKm: 35 });
    expect(distance).toEqual({ km: 36, provenance: "trip-distance" });
    const fuel = estimateFuelCost({ distanceKm: distance.km, efficiencyKmpl: 9, pricePerLiter: 62.7 });
    expect(fuel).toMatchObject({ liters: 4, cost: 250.8, basis: "measured" });
    // A completion stores the snapshot basis, never a link: the snapshot row
    // below is data the completion copies, and later rows cannot move it.
    const rows = [
      { snapshot_id: 4, fuel_product: "Diesel", region: "NCR", currency: "PHP", unit: "L", reference_price: "62.70", effective_at: "2026-10-01T00:00:00+08:00", verification_method: "Manual", verified_by: 3, lifecycle: "Active" },
      { snapshot_id: 5, fuel_product: "Diesel", region: "NCR", currency: "PHP", unit: "L", reference_price: "63.00", effective_at: "2026-11-01T00:00:00+08:00", verification_method: "Manual", verified_by: 3, lifecycle: "Active" },
    ];
    expect(priceAt(rows, { fuelType: "Diesel", region: "NCR", at: "2026-10-05T00:00:00+08:00" })?.snapshot_id).toBe(4);
    const tx = { query: async (sql) => ({ rows: sql.includes("SELECT * FROM fuel_price_snapshots") ? rows : [] }) };
    const repository = createPriceRepository({ query: tx.query, withTransaction: (fn) => fn(tx) });
    const applicable = await repository.applicable({ fuelType: "Diesel", region: "NCR", at: "2026-10-05T00:00:00+08:00" });
    expect(estimateFuelCost({ distanceKm: 36, efficiencyKmpl: 9, pricePerLiter: applicable.reference_price })).toMatchObject({ liters: 4, cost: 250.8 });
    // Production completion/capture/retry acceptance runs through the real
    // PUT handler, service and repository in fuel/completion-path.test.js.
  });

  it("provider failure retains the last verified snapshot with a stale warning", () => {
    const held = validateProviderUpdate({
      current: { reference_price: 62, effective_at: "2026-09-01T00:00:00+08:00" },
      candidate: { reference_price: 620, effective_at: "2026-10-01T00:00:00+08:00" },
    });
    expect(held.accept).toBe(false);
    expect(held.reason).toMatch(/retained/);
  });

  it("cargo bookings carry handling buffers and never collapse to zero length", () => {
    expect(CARGO_HANDLING_DEFAULTS.loadingMin + CARGO_HANDLING_DEFAULTS.securementMin + CARGO_HANDLING_DEFAULTS.unloadingMin + CARGO_HANDLING_DEFAULTS.turnaroundMin).toBe(90);
    const r = cargoServiceEnd({ pickup: "2026-10-08T02:00:00Z", scheduledArrival: null, driveMinutes: 60 });
    expect(r.end?.toISOString()).toBe("2026-10-08T04:30:00.000Z");
    expect(r.end.getTime()).toBeGreaterThan(new Date("2026-10-08T02:00:00Z").getTime());
  });
});
