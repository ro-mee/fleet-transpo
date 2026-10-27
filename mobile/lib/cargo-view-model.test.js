import { describe, expect, it } from "vitest";
import { buildCargoViewModel, blankCargoCounts, validateCargoCounts, buildCargoReceipt, cargoMapAction, resolveCargoMapGate, cargoFormHasIssue, readCargoScreenSources } from "./cargo-view-model";

it("binds a normalized signature to exactly the reviewed receipt and rejects malformed drawings", () => {
  const handover = { version: 1, signer_name: "Alex Santos", signer_role_or_dept: "Receiving", acknowledgment: "CARGO_HANDOVER_V1", captured_at: "2026-10-20T02:00:00.000Z", signature: { width: 600, height: 240, strokes: [[[20, 30], [60, 80], [100, 40]]] }, location: null };
  expect(buildCargoReceipt(execution, { stage: "PICKUP", counts: { boxes: "10" }, handover }).handover).toEqual(handover);
  expect(() => buildCargoReceipt(execution, { stage: "PICKUP", counts: { boxes: "10" }, handover: { ...handover, signature: { ...handover.signature, strokes: [] } } })).toThrow();
});
const cargoTrip = { trip_id: 701, vehicle_id: 3, operational_use: "Cargo", load_type: "Cargo", trip_status: "At Pickup" };

describe("internal Cargo manager status wording", () => {
  const internal = () => ({ ...execution, manifest: { ...manifest, source_ref: { system: "INTERNAL", external_request_id: "private-internal-uuid" } }, feedback: { state: "INTERNAL_RECORDED" } });
  it("names FleetOps and manager reviews without partner or internal identifier jargon", () => {
    const view = buildCargoViewModel(internal(), { driverType: "Cargo", trip: cargoTrip });
    expect(view.summary.sourceLabel).toBe("FleetOps delivery");
    expect(view.summary.feedbackLabel).toBe("Internal job — no partner message required");
    expect(view.summary.sourceDecisionLabel).toContain("manager");
    expect(view.summary.clearanceLabel).toContain("Manager");
    expect(view.summary.securementLabel).toContain("Manager");
    expect(view.summary.receiverLabel).toContain("Manager");
    expect(view.summary.syncLabel).toBe("No observation saved");
    expect(view.canDepart).toBe(false);
  });
  it("reports saved and accepted manager decisions only from server records", () => {
    const current = { ...internal(), pickup_receipt: { receipt_id: "saved" }, pickup_state: "READY", source_decision: { action: "ACCEPT_OBSERVED" }, can_depart: true, securement_confirmed: true, receiver_confirmed: true };
    const view = buildCargoViewModel(current, { driverType: "Cargo", trip: cargoTrip });
    expect(view.summary.syncLabel).toBe("Saved to Fleet");
    expect(view.summary.sourceDecisionLabel).toBe("Manager accepted the observed pickup count");
    expect(view.summary.clearanceLabel).toBe("Manager departure clearance confirmed");
    expect(view.summary.securementLabel).toBe("Manager confirmed safe loading");
    expect(view.summary.receiverLabel).toBe("Manager confirmed receiving");
    expect(buildCargoViewModel(current, { driverType: "Cargo", trip: cargoTrip, offline: true }).canDepart).toBe(false);
  });
  it("keeps external source and partner wording unchanged", () => {
    const view = buildCargoViewModel(execution, { driverType: "Cargo", trip: cargoTrip });
    expect(view.summary.sourceLabel).toBe(`${manifest.source_ref.system} · ${manifest.source_ref.external_request_id}`);
    expect(view.summary.feedbackLabel).toBe("Partner receipt not queued");
    expect(view.summary.receiverLabel).toBe("Receiver authority unavailable");
  });
  it("explains internal source holds as manager review without changing readiness", async () => {
    const current = { ...internal(), pickup_state: "AWAITING_DECISION", blockers: [{ code: "CARGO_SOURCE_DECISION_REQUIRED", message: "Source acceptance is required for this observation." }] };
    const view = buildCargoViewModel(current, { driverType: "Cargo", trip: cargoTrip });
    expect(view.statusTitle).toBe("Awaiting manager pickup review");
    expect(view.blockers[0].message).toBe("A Fleet Manager must accept the current pickup count before departure review.");
    const gate = await resolveCargoMapGate(cargoTrip, { driverType: "Cargo", readExecution: async () => current });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain("manager acceptance");
  });
});
const manifest = { manifest_ref: { kind: "REQUEST", id: "b8da95aa-6670-4dd5-a0b0-367cab368017", revision: 1, hash: "a".repeat(64) }, source_ref: { system: "POS", organization_id: "restaurant", external_request_id: "order-12" }, service_code: "RESTAURANT_SUPPLY_PICKUP", lines: [{ line_id: "boxes", name: "Fresh produce", expected_quantity: "10", unit: "boxes", quantity_basis: "TRANSPORT_PACKAGE", handling: ["SECURE_LOAD"], reference_image_ref: null }] };
export const execution = { manifest, pickup_state: "NOT_RECORDED", delivery_state: "NOT_RECORDED", can_depart: false, can_complete: false, capabilities: { observe: true }, blockers: [{ code: "CARGO_PICKUP_REQUIRED", message: "Verify cargo at pickup." }], lines: [{ line_id: "boxes", expected_quantity: "10", pickup_quantity: null, delivery_quantity: null, order_shortage: null, delivery_shortage: null }], feedback: { state: "NOT_QUEUED" } };
describe("driver cargo view model", () => {
  it.each(["RESTAURANT_SUPPLY_PICKUP", "RESTAURANT_FOOD_DELIVERY", "HOTEL_SUPPLY_TRANSFER"])("keeps %s in the shared pickup structure even for a dual-qualified driver", service_code => {
    const view = buildCargoViewModel({ ...execution, driver_group: "BOTH", manifest: { ...manifest, service_code } }, { driverType: "Cargo", trip: { ...cargoTrip, trip_status: "At Pickup" } });
    expect(view.stage).toBe("PICKUP"); expect(view.primaryAction).toBe("Record pickup"); expect(view.summary.serviceLabel).toMatch(/Restaurant|Hotel/); expect(view.canSubmit).toBe(true);
  });
  it("starts travel before cargo pickup is required", () => { expect(cargoMapAction({ vehicle_id: 3, operational_use: "Cargo", load_type: "Cargo", trip_status: "Driver Accepted" }, "Cargo")).toBe(null); expect(cargoMapAction({ vehicle_id: 3, operational_use: "Cargo", load_type: "Cargo", trip_status: "Trip Started" }, "Cargo")).toBe(null); expect(cargoMapAction({ vehicle_id: 3, operational_use: "Cargo", load_type: "Cargo", trip_status: "At Pickup" }, "Cargo")).toBe("cargo-pickup"); expect(cargoMapAction({ vehicle_id: 3, operational_use: "Passenger", load_type: "Passenger", trip_status: "At Pickup" }, "Cargo")).toBe(null); });
  it("starts counts blank, validates integer package counts and preserves explicit zero", () => {
    expect(blankCargoCounts(manifest)).toEqual({ boxes: "" });
    for (const value of ["", "-1", "1.5", "ten", "1e3", "1,000"]) expect(validateCargoCounts(manifest, { boxes: value }).valid).toBe(false);
    expect(validateCargoCounts(manifest, { boxes: "0" }).valid).toBe(true);
    expect(validateCargoCounts({ ...manifest, lines: [{ ...manifest.lines[0], quantity_basis: "UNIT", unit: "kg" }] }, { boxes: "1.250" }).valid).toBe(true);
  });
  it("builds an observation of ten expected and nine counted without inventing authority", () => {
    const receipt = buildCargoReceipt(execution, { stage: "PICKUP", counts: { boxes: "9" }, issues: { boxes: { remarks: "One box missing", evidence: [{ uri: "file://photo.jpg" }] } }, observedAt: "2026-10-12T01:00:00Z" });
    expect(receipt.lines[0]).toMatchObject({ line_id: "boxes", observed_quantity: "9", condition: "INTACT", issue_code: "SHORTAGE", remarks: "One box missing" }); expect(receipt.receiver_confirmation_ref).toBe(null); expect(receipt.manifest_ref).toEqual(manifest.manifest_ref);
    expect(() => buildCargoReceipt(execution, { stage: "PICKUP", counts: { boxes: "9" }, issues: {} })).toThrow(/reason/i);
  });
  it("never converts offline, failed refresh, device drafts or partner ACK into ready", () => {
    const ready = { ...execution, pickup_state: "READY", can_depart: true, securement_confirmed: true };
    for (const options of [{ offline: true }, { fresh: false }, { syncState: { state: "DEVICE_SAVED" } }, { syncState: { state: "STALE_REVIEW" } }]) expect(buildCargoViewModel(ready, { driverType: "Cargo", trip: cargoTrip, ...options }).stage).not.toBe("READY");
    expect(buildCargoViewModel({ ...execution, pickup_state: "AWAITING_DECISION", feedback: { state: "ACKNOWLEDGED" } }, { driverType: "Cargo", trip: cargoTrip }).stage).toBe("AWAITING_DECISION");
  });
  it("blocks an unavailable or malformed manifest instead of fabricating empty counts", () => { for (const value of [null, {}, { manifest: { lines: [] } }]) { const view = buildCargoViewModel(value, { driverType: "Cargo", trip: cargoTrip }); expect(view.stage).toBe("UNAVAILABLE"); expect(view.canSubmit).toBe(false); } });
  it("blocks delivery confirmation without server receiver authority", () => {
    const view = buildCargoViewModel({ ...execution, pickup_state: "READY", can_depart: true, securement_confirmed: true }, { driverType: "Cargo", trip: { ...cargoTrip, trip_status: "Drop-off" } });
    expect(view.stage).toBe("DELIVERY"); expect(view.canSubmit).toBe(true); expect(view.canConfirmDelivery).toBe(false); expect(buildCargoViewModel(execution, { driverType: "Cargo", trip: { ...cargoTrip, trip_status: "Arrived" } }).canSubmit).toBe(true); expect(buildCargoViewModel(execution, { driverType: "Cargo", trip: { ...cargoTrip, trip_status: "En Route" } }).canSubmit).toBe(false); expect(view.blockers.some(row => row.code === "CARGO_RECEIVER_CONFIRMATION_REQUIRED")).toBe(true);
    expect(() => buildCargoReceipt(execution, { stage: "DELIVERY", counts: { boxes: "9" }, issues: {}, confirm: true })).toThrow(/receiver/i);
  });
  it.each(["WAITING", "AWAITING_DECISION", "REJECTED"])("renders current %s distinctly", pickup_state => expect(buildCargoViewModel({ ...execution, pickup_state }, { driverType: "Cargo", trip: cargoTrip }).stage).toBe(pickup_state));
});

describe("existing map cargo transition guards", () => {
  it("leaves passenger, Start Trip and arrival-to-pickup behavior unchanged", async () => { for (const trip of [{ vehicle_id: 3, operational_use: "Passenger", load_type: "Passenger", trip_status: "At Pickup" }, { vehicle_id: 3, operational_use: "Cargo", load_type: "Cargo", trip_status: "Driver Accepted" }, { vehicle_id: 3, operational_use: "Cargo", load_type: "Cargo", trip_status: "Trip Started" }]) expect(await resolveCargoMapGate(trip, { driverType: trip.operational_use })).toEqual({ allowed: true }); });
  it("refuses pickup departure without a fresh server view and securement", async () => {
    const trip = { vehicle_id: 3, operational_use: "Cargo", load_type: "Cargo", trip_status: "At Pickup" };
    for (const options of [{ offline: true }, { readExecution: async () => { throw new Error("Disabled"); } }, { readExecution: async () => ({ ...execution, pickup_state: "READY", can_depart: true, securement_confirmed: false }) }]) expect((await resolveCargoMapGate(trip, { driverType: trip.operational_use, ...options })).allowed).toBe(false);
    expect((await resolveCargoMapGate(trip, { driverType: trip.operational_use, readExecution: async () => ({ ...execution, pickup_state: "READY", can_depart: true, securement_confirmed: true }), readSyncState: async () => ({ state: "NONE" }) })).allowed).toBe(true);
  });
  it("opens delivery verification until the server confirms completion", async () => {
    const trip = { vehicle_id: 3, operational_use: "Cargo", load_type: "Cargo", trip_status: "Drop-off" };
    expect((await resolveCargoMapGate(trip, { driverType: trip.operational_use, readExecution: async () => execution })).route).toBe("cargo-delivery");
    expect((await resolveCargoMapGate(trip, { driverType: trip.operational_use, readExecution: async () => ({ ...execution, delivery_state: "CONFIRMED", can_complete: true, receiver_confirmed: true }) })).allowed).toBe(true);
  });
  it("detects decimal shortages that floating point would round away", () => {
    const decimal = { ...execution, manifest: { ...manifest, lines: [{ ...manifest.lines[0], expected_quantity: "999999999999999.999", quantity_basis: "UNIT", unit: "kg" }] } };
    expect(buildCargoReceipt(decimal, { stage: "PICKUP", counts: { boxes: "999999999999999.998" }, issues: { boxes: { remarks: "One thousandth missing" } } }).lines[0].issue_code).toBe("SHORTAGE");
  });
});

describe("reviewed cargo issue classification", () => {
  it("keeps an equal-count remark clean and rejects it as a reported issue", () => {
    const form = { counts: { boxes: "10" }, issues: { boxes: { reported: true, remarks: "Packaging checked" } } };
    expect(cargoFormHasIssue(execution, form)).toBe(false);
    expect(buildCargoReceipt(execution, { stage: "PICKUP", ...form }).lines[0].issue_code).toBe(null);
    expect(() => buildCargoReceipt(execution, { stage: "PICKUP", ...form, reportIssue: true })).toThrow(/shortage|excess|damage/i);
  });
  it.each([["9", false, "SHORTAGE"], ["11", false, "EXCESS"], ["10", true, "DAMAGE"]])("retains the supported code for count %s and damage %s", (count, damaged, code) => {
    const form = { counts: { boxes: count }, issues: { boxes: { reported: true, damaged, remarks: "Observed discrepancy" } } };
    expect(buildCargoReceipt(execution, { stage: "PICKUP", ...form, reportIssue: true }).lines[0].issue_code).toBe(code);
    expect(() => buildCargoReceipt(execution, { stage: "PICKUP", ...form, issues: { boxes: { damaged } }, reportIssue: true })).toThrow(/reason/i);
  });
});
describe("legacy cargo receipt hold", () => {
  it("explains the hold with and without an execution manifest", () => {
    for (const input of [execution, null]) {
      const view = buildCargoViewModel(input, { driverType: "Cargo", trip: { ...cargoTrip, trip_status: "In Progress" } });
      expect(view.legacyHold).toMatch(/In Progress/); expect(view.legacyHold).toMatch(/Drop-off.*Arrived/); expect(view.legacyHold).toMatch(/Fleet/);
      expect(view.canSubmit).toBe(false); expect(view.canConfirmDelivery).toBe(false);
    }
  });
  it("routes legacy completion to the explained hold until the server verifies delivery", async () => {
    const trip = { vehicle_id: 3, operational_use: "Cargo", load_type: "Cargo", trip_status: "In Progress" };
    const gate = await resolveCargoMapGate(trip, { driverType: trip.operational_use, readExecution: async () => execution });
    expect(gate.allowed).toBe(false); expect(gate.route).toBe("cargo"); expect(gate.reason).toMatch(/In Progress.*Fleet/);
    const confirmed = { ...execution, can_complete: true, receiver_confirmed: true, delivery_state: "CONFIRMED" };
    expect((await resolveCargoMapGate(trip, { driverType: trip.operational_use, readExecution: async () => confirmed })).allowed).toBe(true);
    expect(buildCargoViewModel(confirmed, { driverType: "Cargo", trip: { ...cargoTrip, trip_status: "In Progress" } }).legacyHold).toBe(null);
  });
});

it("retains legacy trip status when the execution provider is unavailable", async () => {
  const unavailable = Object.assign(new Error("Disabled"), { status: 503 });
  const sources = await readCargoScreenSources("701", { driverType: "Cargo", readExecution: async () => { throw unavailable; }, readTrips: async () => [{ ...cargoTrip, trip_status: "In Progress" }] });
  expect(sources.trip.trip_status).toBe("In Progress"); expect(sources.executionError).toBe(unavailable);
  expect(buildCargoViewModel(sources.execution, { driverType: "Cargo", trip: sources.trip }).legacyHold).toMatch(/Fleet/);
});

describe("vehicle compatibility guards", () => {
  it.each([["Cargo", "Passenger"], ["Passenger", "Cargo"]])("blocks %s vehicle with %s trip before reads", async (operational_use, load_type) => {
    const trip = { trip_id: 701, vehicle_id: 3, operational_use, load_type, trip_status: "At Pickup" };
    const gate = await resolveCargoMapGate(trip, { driverType: trip.operational_use, readExecution: () => { throw new Error("must not read"); } });
    expect(gate.allowed).toBe(false); expect(gate.reason).toMatch(/saved trip type.*vehicle/i); expect(gate.route).toBeNull(); expect(cargoMapAction(trip, "Cargo")).toBeNull();
  });
  it.each(["Passenger", "Cargo"])("direct cargo route blocks %s vehicle with Passenger load", async operational_use => {
    const sources = await readCargoScreenSources(701, { driverType: operational_use, readExecution: async () => execution, readTrips: async () => [{ trip_id: 701, vehicle_id: 3, operational_use, load_type: "Passenger" }] });
    expect(sources.cargoAllowed).toBe(false); expect(sources.execution).toBeNull(); expect(sources.workspace.mode).toBe(operational_use.toLowerCase());
  });
  it("requires the exact trip even with a manifest", async () => {
    const sources = await readCargoScreenSources(701, { driverType: "Cargo", readExecution: async () => execution, readTrips: async () => [] });
    expect(sources.cargoAllowed).toBe(false); expect(sources.execution).toBeNull();
  });
  it("retains valid cargo pickup and delivery", () => {
    const trip = { vehicle_id: 3, operational_use: "Cargo", load_type: "Cargo" };
    expect(cargoMapAction({ ...trip, trip_status: "At Pickup" }, "Cargo")).toBe("cargo-pickup"); expect(cargoMapAction({ ...trip, trip_status: "Drop-off" }, "Cargo")).toBe("cargo-delivery");
  });
});

it.each([["Cargo", "Passenger"], ["Passenger", "Cargo"], [null, "Cargo"]])("cargo view cannot grant actions for vehicle %s and load %s", (operational_use, load_type) => {
  const trip = { vehicle_id: 3, operational_use, load_type, trip_status: "At Pickup" };
  const view = buildCargoViewModel({ ...execution, pickup_state: "READY", can_depart: true, securement_confirmed: true }, { driverType: "Cargo", trip });
  expect(view.canSubmit).toBe(false); expect(view.canDepart).toBe(false); expect(view.canConfirmDelivery).toBe(false);
  expect(view.blockers[0].message).toMatch(/vehicle|trip type/i);
});


describe("authenticated driver type is required for cargo actions", () => {
  const trip = { trip_id: 701, vehicle_id: 3, operational_use: "Cargo", load_type: "Cargo", trip_status: "At Pickup" };
  it.each([null, "Passenger", "Unknown"])("refuses type %s even with a Cargo vehicle and ready manifest", async driverType => {
    const view = buildCargoViewModel({ ...execution, pickup_state: "READY", can_depart: true, securement_confirmed: true }, { driverType, trip });
    expect(view.canDepart).toBe(false); expect(view.canSubmit).toBe(false);
    expect(cargoMapAction(trip, driverType)).toBeNull();
    expect((await resolveCargoMapGate(trip, { driverType, readExecution: async () => execution })).allowed).toBe(false);
    const source = await readCargoScreenSources(701, { driverType, readExecution: async () => execution, readTrips: async () => [trip] });
    expect(source.cargoAllowed).toBe(false); expect(source.execution).toBeNull();
  });
  it("never grants cargo authority when the exact trip is omitted", () => {
    expect(buildCargoViewModel({ ...execution, pickup_state: "READY", can_depart: true, securement_confirmed: true }, { driverType: "Cargo" }).canDepart).toBe(false);
  });
});
