import { describe, expect, it } from "vitest";
import { deriveCargoState } from "../../src/lib/cargo/execution-state";
import { buildCargoDemoFixtures, CARGO_DEMO_NAMESPACE } from "./fixtures.mjs";

const fixtures = buildCargoDemoFixtures();
const byId = Object.fromEntries(fixtures.map(fixture => [fixture.id, fixture]));
const state = fixture => deriveCargoState(fixture.execution);

describe("cargo demo fixtures", () => {
  it("uses one explicit demo namespace and marks every record simulated", () => {
    expect(fixtures.length).toBeGreaterThan(0);
    for (const fixture of fixtures) {
      expect(fixture.namespace).toBe(CARGO_DEMO_NAMESPACE);
      expect(fixture.simulated).toBe(true);
    }
  });

  it("covers passenger and the shared restaurant and hotel cargo services", () => {
    expect(byId["guest-transport"].service_code).toBe("GUEST_TRANSPORT");
    const cargoServices = new Set(fixtures.filter(fixture => fixture.load_type === "CARGO").map(fixture => fixture.service_code));
    expect(cargoServices).toEqual(new Set([
      "RESTAURANT_SUPPLY_PICKUP",
      "RESTAURANT_FOOD_DELIVERY",
      "HOTEL_SUPPLY_TRANSFER",
    ]));
  });

  it("keeps source thumbnails optional and fixture receipts free of uploaded evidence", () => {
    for (const fixture of fixtures.filter(item => item.load_type === "CARGO")) {
      expect(fixture.execution.manifest.lines.every(line => line.reference_image_ref === null)).toBe(true);
      for (const receipt of [fixture.execution.pickup, fixture.execution.delivery, ...(fixture.timeline ?? []).flatMap(step => [
        step.execution?.pickup,
        step.execution?.delivery,
      ])].filter(Boolean)) {
        expect(receipt.payload.lines.every(line => line.evidence_ids.length === 0)).toBe(true);
      }
    }
  });

  it("demonstrates a clean cargo trip that can depart and complete", () => {
    expect(state(byId["clean-pickup"])).toMatchObject({
      pickup_state: "READY",
      delivery_state: "CONFIRMED",
      can_depart: true,
      can_complete: true,
    });
  });

  it("uses explicit simulated staff acknowledgments only for cargo receipts", () => {
    expect(byId["guest-transport"].execution).toBeNull();
    for (const fixture of fixtures.filter(item => item.load_type === "CARGO")) {
      for (const receipt of [fixture.execution.pickup, fixture.execution.delivery].filter(Boolean)) {
        expect(receipt.payload.handover).toMatchObject({
          version: 1,
          signer_name: receipt.payload.stage === "PICKUP" ? "Demo releasing staff" : "Demo receiving staff",
          acknowledgment: "CARGO_HANDOVER_V1",
          location: null,
        });
      }
    }
  });

  it("preserves the accepted shortage when all collected boxes arrive", () => {
    const result = state(byId["accepted-shortage"]);
    expect(result).toMatchObject({ pickup_state: "READY", delivery_state: "CONFIRMED", can_depart: true, can_complete: true });
    expect(result.lines[0]).toMatchObject({
      expected_quantity: "10",
      pickup_quantity: "9",
      delivery_quantity: "9",
      order_shortage: "1",
      delivery_shortage: "0",
    });
  });

  it("keeps a WAIT decision blocked, then allows a fresh clean recount after securement", () => {
    const steps = byId["wait-and-recount"].timeline;
    expect(steps[1].execution.manifest.manifest_ref).toEqual(steps[0].execution.manifest.manifest_ref);
    expect(steps[1].execution.pickup.execution_id).toBe(steps[0].execution.pickup.execution_id);
    expect(steps[1].execution.pickup.receipt_id).not.toBe(steps[0].execution.pickup.receipt_id);
    expect(deriveCargoState(steps[0].execution)).toMatchObject({ pickup_state: "WAITING", can_depart: false });
    expect(deriveCargoState(steps[1].execution)).toMatchObject({ pickup_state: "READY", can_depart: true });
  });

  it("holds a rejected shortage", () => {
    expect(state(byId["rejected-shortage"])).toMatchObject({ pickup_state: "REJECTED", can_depart: false });
  });

  it("keeps a delivery discrepancy under review even with receiver proof", () => {
    expect(state(byId["delivery-discrepancy"])).toMatchObject({
      delivery_state: "AWAITING_REVIEW",
      can_complete: false,
      lines: [expect.objectContaining({ pickup_quantity: "9", delivery_quantity: "8", delivery_shortage: "1" })],
    });
  });

  it("labels a partner timeout as simulated feedback failure", () => {
    expect(byId["partner-timeout"].feedback).toMatchObject({
      simulated: true,
      state: "FAILED",
      last_error_code: "GATEWAY_TIMEOUT",
    });
  });
});
