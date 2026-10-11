import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CargoQuantityTable } from "./cargo-quantity-table";

const manifest = {
  manifest_ref: { kind: "REQUEST", id: "revision-1", revision: 1, hash: "a".repeat(64) },
  source_ref: { system: "POS", organization_id: "restaurant-1", external_request_id: "ticket-1" },
  service_code: "RESTAURANT_SUPPLY_PICKUP",
  lines: [{
    line_id: "oil",
    name: "Cooking oil",
    quantity_basis: "TRANSPORT_PACKAGE",
    expected_quantity: "10",
    unit: "box",
    reference_image_ref: null,
    handling: [],
  }],
};

it("keeps expected, pickup, and delivery counts separate and labels each shortage", () => {
  const markup = renderToStaticMarkup(
    React.createElement(CargoQuantityTable, {
      manifest,
      pickup: { lines: [{ line_id: "oil", observed_quantity: "9" }] },
      delivery: { lines: [{ line_id: "oil", observed_quantity: "9" }] },
    })
  );

  expect(markup).toContain("Expected");
  expect(markup).toContain("Picked up");
  expect(markup).toContain("Delivered");
  expect(markup).toContain("Order shortage");
  expect(markup).toContain(">1</span>");
  expect(markup).toContain("Delivery shortage");
  expect(markup).toContain(">0</span>");
  expect(markup).toContain("box");
});
