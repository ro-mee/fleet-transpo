import { describe, expect, it } from "vitest";
import { resolveShipmentDetailSelection } from "./shipment-detail-selection";

const shipments = [
  { supply_shipment_id: "b8a20842-3056-41fb-9cf2-cfe37a0af9e3" },
  { supply_shipment_id: "c1c5f839-d1da-4abc-8e8e-632e1fbf9ff8" },
];

describe("resolveShipmentDetailSelection", () => {
  it("selects a linked shipment only when it is a local UUID in the loaded list", () => {
    expect(resolveShipmentDetailSelection(shipments[1].supply_shipment_id, shipments)).toEqual({
      selectedId: shipments[1].supply_shipment_id,
      linked: true,
      unavailable: false,
    });
  });

  it("falls back safely when a linked shipment is missing or malformed", () => {
    expect(resolveShipmentDetailSelection("external-request-42", shipments)).toEqual({
      selectedId: shipments[0].supply_shipment_id,
      linked: false,
      unavailable: true,
    });
    expect(resolveShipmentDetailSelection("c1c5f839-d1da-4abc-8e8e-632e1fbf9ff7", shipments)).toEqual({
      selectedId: shipments[0].supply_shipment_id,
      linked: false,
      unavailable: true,
    });
  });

  it("uses the existing first-item selection when no link was requested", () => {
    expect(resolveShipmentDetailSelection("", shipments)).toEqual({
      selectedId: shipments[0].supply_shipment_id,
      linked: false,
      unavailable: false,
    });
  });
});
