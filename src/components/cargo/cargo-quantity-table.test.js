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

it("shows source physical package facts without converting ordered units into packages", () => {
  const markup = renderToStaticMarkup(React.createElement(CargoQuantityTable, { manifest: {
    ...manifest,
    physical_contract_version: 1,
    lines: [{ ...manifest.lines[0], expected_quantity: "100", quantity_basis: "UNIT", unit: "bottles", handling: ["FOOD_SEPARATION"], physical: {
      transport_package_count: 10, package_description: "sealed box", gross_weight_kg_per_package: "12",
      dimensions_m: { length: "0.5", width: "0.4", height: "0.3" }, package_can_rotate: false, temperature_c: { min_c: 2, max_c: 8 },
    } }],
  } }));
  expect(markup).toContain("10 packages (sealed box) · 12 kg/package");
  expect(markup).toContain("0.5 × 0.4 × 0.3 m");
  expect(markup).toContain("Rotation: not permitted");
  expect(markup).toContain("Temperature: 2 to 8 °C");
  expect(markup).toContain("food separation");
  expect(markup).toContain(">100</span>");
  expect(markup).toContain("bottles");
});

it("preserves historical quantity-only presentation without inventing physical facts", () => {
  const markup = renderToStaticMarkup(React.createElement(CargoQuantityTable, { manifest }));
  expect(markup).not.toContain("kg/package");
  expect(markup).not.toContain("Temperature:");
  expect(markup).toContain("Cooking oil");
});
