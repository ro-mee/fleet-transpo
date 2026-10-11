import { describe, expect, it } from "vitest";
import { buildCargoViewModel, blankCargoCounts, validateCargoCounts, buildCargoReceipt, cargoMapAction, resolveCargoMapGate } from "./cargo-view-model";
const manifest = { manifest_ref: { kind: "REQUEST", id: "b8da95aa-6670-4dd5-a0b0-367cab368017", revision: 1, hash: "a".repeat(64) }, source_ref: { system: "POS", organization_id: "restaurant", external_request_id: "order-12" }, service_code: "RESTAURANT_SUPPLY_PICKUP", lines: [{ line_id: "boxes", name: "Fresh produce", expected_quantity: "10", unit: "boxes", quantity_basis: "TRANSPORT_PACKAGE", handling: ["SECURE_LOAD"], reference_image_ref: null }] };
export const execution = { manifest, pickup_state: "NOT_RECORDED", delivery_state: "NOT_RECORDED", can_depart: false, can_complete: false, capabilities: { observe: true }, blockers: [{ code: "CARGO_PICKUP_REQUIRED", message: "Verify cargo at pickup." }], lines: [{ line_id: "boxes", expected_quantity: "10", pickup_quantity: null, delivery_quantity: null, order_shortage: null, delivery_shortage: null }], feedback: { state: "NOT_QUEUED" } };
describe("driver cargo view model", () => {
  it.each(["RESTAURANT_SUPPLY_PICKUP", "RESTAURANT_FOOD_DELIVERY", "HOTEL_SUPPLY_TRANSFER"])("keeps %s in the shared pickup structure even for a dual-qualified driver", service_code => {
    const view = buildCargoViewModel({ ...execution, driver_group: "BOTH", manifest: { ...manifest, service_code } }, { tripStatus: "At Pickup" });
    expect(view.stage).toBe("PICKUP"); expect(view.primaryAction).toBe("Record pickup"); expect(view.summary.serviceLabel).toMatch(/Restaurant|Hotel/); expect(view.canSubmit).toBe(true);
  });
  it("starts travel before cargo pickup is required", () => { expect(cargoMapAction({ load_type: "Cargo", trip_status: "Driver Accepted" })).toBe(null); expect(cargoMapAction({ load_type: "Cargo", trip_status: "Trip Started" })).toBe(null); expect(cargoMapAction({ load_type: "Cargo", trip_status: "At Pickup" })).toBe("cargo-pickup"); expect(cargoMapAction({ load_type: "Passenger", trip_status: "At Pickup" })).toBe(null); });
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
    for (const options of [{ offline: true }, { fresh: false }, { syncState: { state: "DEVICE_SAVED" } }, { syncState: { state: "STALE_REVIEW" } }]) expect(buildCargoViewModel(ready, options).stage).not.toBe("READY");
    expect(buildCargoViewModel({ ...execution, pickup_state: "AWAITING_DECISION", feedback: { state: "ACKNOWLEDGED" } }).stage).toBe("AWAITING_DECISION");
  });
  it("blocks an unavailable or malformed manifest instead of fabricating empty counts", () => { for (const value of [null, {}, { manifest: { lines: [] } }]) { const view = buildCargoViewModel(value); expect(view.stage).toBe("UNAVAILABLE"); expect(view.canSubmit).toBe(false); } });
  it("blocks delivery confirmation without server receiver authority", () => {
    const view = buildCargoViewModel({ ...execution, pickup_state: "READY", can_depart: true, securement_confirmed: true }, { tripStatus: "Drop-off" });
    expect(view.stage).toBe("DELIVERY"); expect(view.canSubmit).toBe(true); expect(view.canConfirmDelivery).toBe(false); expect(buildCargoViewModel(execution, { tripStatus: "Arrived" }).canSubmit).toBe(true); expect(buildCargoViewModel(execution, { tripStatus: "En Route" }).canSubmit).toBe(false); expect(view.blockers.some(row => row.code === "CARGO_RECEIVER_CONFIRMATION_REQUIRED")).toBe(true);
    expect(() => buildCargoReceipt(execution, { stage: "DELIVERY", counts: { boxes: "9" }, issues: {}, confirm: true })).toThrow(/receiver/i);
  });
  it.each(["WAITING", "AWAITING_DECISION", "REJECTED"])("renders current %s distinctly", pickup_state => expect(buildCargoViewModel({ ...execution, pickup_state }).stage).toBe(pickup_state));
});

describe("existing map cargo transition guards", () => {
  it("leaves passenger, Start Trip and arrival-to-pickup behavior unchanged", async () => { for (const trip of [{ load_type: "Passenger", trip_status: "At Pickup" }, { load_type: "Cargo", trip_status: "Driver Accepted" }, { load_type: "Cargo", trip_status: "Trip Started" }]) expect(await resolveCargoMapGate(trip, {})).toEqual({ allowed: true }); });
  it("refuses pickup departure without a fresh server view and securement", async () => {
    const trip = { load_type: "Cargo", trip_status: "At Pickup" };
    for (const options of [{ offline: true }, { readExecution: async () => { throw new Error("Disabled"); } }, { readExecution: async () => ({ ...execution, pickup_state: "READY", can_depart: true, securement_confirmed: false }) }]) expect((await resolveCargoMapGate(trip, options)).allowed).toBe(false);
    expect((await resolveCargoMapGate(trip, { readExecution: async () => ({ ...execution, pickup_state: "READY", can_depart: true, securement_confirmed: true }), readSyncState: async () => ({ state: "NONE" }) })).allowed).toBe(true);
  });
  it("opens delivery verification until the server confirms completion", async () => {
    const trip = { load_type: "Cargo", trip_status: "Drop-off" };
    expect((await resolveCargoMapGate(trip, { readExecution: async () => execution })).route).toBe("cargo-delivery");
    expect((await resolveCargoMapGate(trip, { readExecution: async () => ({ ...execution, delivery_state: "CONFIRMED", can_complete: true, receiver_confirmed: true }) })).allowed).toBe(true);
  });
  it("detects decimal shortages that floating point would round away", () => {
    const decimal = { ...execution, manifest: { ...manifest, lines: [{ ...manifest.lines[0], expected_quantity: "999999999999999.999", quantity_basis: "UNIT", unit: "kg" }] } };
    expect(buildCargoReceipt(decimal, { stage: "PICKUP", counts: { boxes: "999999999999999.998" }, issues: { boxes: { remarks: "One thousandth missing" } } }).lines[0].issue_code).toBe("SHORTAGE");
  });
});
