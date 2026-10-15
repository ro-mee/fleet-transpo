import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MaintenanceVehicleSelect from "./maintenance-vehicle-select";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());

it("matches the selected vehicle with a string-valued dropdown option", () => {
  const tree = MaintenanceVehicleSelect({
    vehicles: [{ vehicle_id: 42, plate_number: "XYZ 1234", vehicle_name: "Service Van", model: "Transit" }],
    value: 42,
    onValueChange: vi.fn(),
  });
  const option = React.Children.toArray(tree.props.children)[0];

  expect(tree.props.value).toBe("42");
  expect(option.props.value).toBe("42");
  expect(React.Children.toArray(option.props.children).join("")).toBe("XYZ 1234 — Service Van (Transit)");
});
