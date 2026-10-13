import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ service: "GUEST_TRANSPORT", buttons: [], mutate: vi.fn() }));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, useState: initial => {
    if (initial?.external_booking_id !== undefined) initial = { ...initial, service_code: state.service, external_booking_id: "demo-1", guest_name: "Maria", pickup_location: "Hotel", pickup_datetime: "2026-10-13T10:00:00+08:00", cargo_description: "Kitchen oil", cargo_weight_kg: "65.25", passenger_count: 2 };
    if (Array.isArray(initial) && initial[0]?.line_id === "first") initial = [{ ...initial[0], name: "Oil", expected_quantity: "100", unit: "bottle", transport_package_count: "10", gross_weight_kg_per_package: "6.525", length_m: "0.5", width_m: "0.5", height_m: "0.2", package_can_rotate: false, temperature_mode: "NONE" }];
    return actual.useState(initial);
  } };
});
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [] }), useMutation: () => ({ mutate: state.mutate, isPending: false }), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ theme: "light" }) }));
vi.mock("@/components/ui/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/page-entrance", () => ({ PageEntrance: ({ children }) => children, CARD_SHADOW: "" }));
vi.mock("@/components/ui/button", async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, Button: props => { state.buttons.push(props); return React.createElement(actual.Button, props); } };
});
vi.mock("@/services/transport.service", () => ({ injectTransportRequest: vi.fn(), pullTransportRequests: vi.fn() }));
vi.mock("@/services/vehicle.service", () => ({ getVehicleCategories: vi.fn() }));
vi.mock("@/services/location.service", () => ({ getLocations: vi.fn() }));
vi.mock("@/services/settings.service", () => ({ getHotelLocationSettings: vi.fn() }));

import MockInjectorPage from "@/app/(dashboard)/reservations/new/page";

beforeEach(() => { state.service = "GUEST_TRANSPORT"; state.buttons = []; state.mutate.mockClear(); vi.stubGlobal("React", React); });
afterEach(() => vi.unstubAllGlobals());
const renderPage = () => renderToStaticMarkup(React.createElement(MockInjectorPage));
const submit = () => state.buttons.find(button => button.className?.includes("px-5 h-10")).onClick({ preventDefault: vi.fn() });

it("selects Cargo contents conditionally and never sends a weight-only request", () => {
  state.service = "HOTEL_SUPPLY_TRANSFER";
  const html = renderPage();
  expect(html).toContain("Cargo contents");
  expect(html).toContain("65.25 kg");
  expect(html).toContain("Review Cargo Draft");
  expect(html).toContain("Manifest intake is not enabled");
  expect(html).not.toContain("Guest Name");
  expect(html).not.toContain("Passenger Count");
  submit();
  expect(state.mutate).not.toHaveBeenCalled();
});

it("keeps Passenger submission on its typed PMS boundary without hidden cargo", () => {
  const html = renderPage();
  expect(html).toContain("Guest Name");
  expect(html).toContain("Passenger Count");
  expect(html).not.toContain("Cargo contents");
  submit();
  expect(state.mutate).toHaveBeenCalledOnce();
  expect(state.mutate.mock.calls[0][0].request).toMatchObject({ source_system: "PMS", service_code: "GUEST_TRANSPORT", load_type: "Passenger", passenger_count: 2 });
  expect(state.mutate.mock.calls[0][0].request).not.toHaveProperty("cargo_weight_kg");
});
