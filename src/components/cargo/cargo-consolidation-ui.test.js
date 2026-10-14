import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CargoManifestSummary } from "./cargo-request-summary";
import { CargoContentsEditor } from "./cargo-contents-editor";
import { blankCargoDraftLine } from "@/lib/cargo/cargo-draft";
import { ReservationQueueTable } from "@/components/reservations/reservation-queue-table";
import { CargoPhysicalSummary } from "@/components/reservations/copilot-option-flow";

vi.mock("next/link", () => ({ default: ({ href, children }) => React.createElement("a", { href }, children) }));
beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));

describe("shared cargo presentation", () => {
  it.each(["list", "grid"])("replaces guest and bag facts in the %s queue", viewMode => {
    const html = render(ReservationQueueTable, { viewMode, requests: [{ request_id: 12, fleet_status: "Pending", load_type: "Cargo", cargo_description: "Restaurant supplies", cargo_weight_kg: "650", guest_name: "Wrong passenger", passenger_count: 4 }] });
    expect(html).toContain("Restaurant supplies");
    expect(html).toContain("650 kg declared");
    expect(html).not.toContain("Wrong passenger");
    expect(html).not.toContain("4 guests");
    expect(html).not.toContain("bags");
  });
  it("preserves the passenger queue summary", () => {
    expect(render(ReservationQueueTable, { requests: [{ request_id: 13, fleet_status: "Pending", load_type: "Passenger", guest_name: "Maria", passenger_count: 2 }] })).toContain("2 guests");
  });
  it("displays original units, package facts and physical unknowns separately", () => {
    const manifest = { physical_contract_version: 1, manifest_ref: { revision: 3 }, lines: [{ line_id: "oil", name: "Cooking oil", expected_quantity: "100", quantity_basis: "UNIT", unit: "bottles", handling: ["FOOD_SEPARATION"], physical: { transport_package_count: 10, gross_weight_kg_per_package: "6.525", dimensions_m: { length: "0.5", width: "0.5", height: "0.2" }, package_can_rotate: false, temperature_c: null } }] };
    const html = render(CargoManifestSummary, { manifest });
    expect(html).toContain("100 bottles");
    expect(html).toContain("Ordered units");
    expect(html).toContain("6.525");
    expect(html).toContain("food separation");
    expect(html).toContain("Keep orientation");
    expect(html).toContain("No temperature control required");
    expect(render(CargoManifestSummary, { manifest: { lines: [{ line_id: "legacy", name: "Legacy item", expected_quantity: "1", unit: "box" }] } })).toContain("physical evidence unknown");
  });
  it("renders the unsaved draft and exposes transport requirements", () => {
    const html = render(CargoContentsEditor, { lines: [blankCargoDraftLine("first")], calculatedKg: null, onChange: vi.fn(), errors: { "line.0.temperature_mode": "Confirm temperature requirement" } });
    expect(html).toContain("Unsaved local draft");
    expect(html).toContain("Gross kg per package");
    expect(html).toContain("Package length (m)");
    expect(html).toContain("Confirm temperature requirement");
    expect(html).toContain("Vehicle capacity is maintained by Fleet");
  });
  it("shows authoritative physical facts as advisory measurements without certification", () => {
    const html = render(CargoPhysicalSummary, { physical: { mode: "SHADOW", status: "PASS", usable_payload_kg: "1000", remaining_payload_kg: "350", totals: { gross_weight_kg: "650", nominal_volume_m3: "2" }, checks: [] } });
    expect(html).toContain("Advisory");
    expect(html).toContain("650 kg required");
    expect(html).toContain("1000 kg usable");
    expect(html).toContain("350 kg remaining");
    expect(html).toContain("do not confirm load arrangement");
  });
});
