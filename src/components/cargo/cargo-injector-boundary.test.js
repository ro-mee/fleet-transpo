import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ service: "GUEST_TRANSPORT", pickupDate: '2026-10-13T10:00:00+08:00', buttons: [], selects: [], formUpdates: [], mutate: vi.fn(), cargoMutate: vi.fn() }));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, useState: initial => {
    if (initial?.external_booking_id !== undefined) initial = { ...initial, service_code: state.service, external_booking_id: "demo-1", guest_name: "Maria", pickup_location: "Hotel", pickup_location_id: 1, dropoff_location_id: 2, pickup_datetime: state.pickupDate, cargo_description: "Kitchen oil", cargo_weight_kg: "65.25", passenger_count: 2 };
    if (Array.isArray(initial) && initial[0]?.line_id === "first") initial = [{ ...initial[0], name: "Oil", expected_quantity: "100", unit: "bottle", transport_package_count: "10", gross_weight_kg_per_package: "6.525", length_m: "0.5", width_m: "0.5", height_m: "0.2", package_can_rotate: false, temperature_mode: "NONE" }];
    const [value, update] = actual.useState(initial);
    return [value, next => { if (value?.external_booking_id !== undefined) state.formUpdates.push(typeof next === 'function' ? next(value) : next); update(next); }];
  } };
});
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [] }), useMutation: options => ({ mutate: options.mutationFn.name === 'createInternalCargoReservation' ? state.cargoMutate : state.mutate, isPending: false }), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ theme: "light" }) }));
vi.mock("@/components/ui/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/page-entrance", () => ({ PageEntrance: ({ children }) => children, CARD_SHADOW: "" }));
vi.mock("@/components/ui/field", async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, FloatingSelect: props => { state.selects.push(props); return React.createElement(actual.FloatingSelect, props); } };
});
vi.mock("@/components/ui/button", async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, Button: props => { state.buttons.push(props); return React.createElement(actual.Button, props); } };
});
vi.mock("@/services/transport.service", () => ({ injectTransportRequest: vi.fn(), pullTransportRequests: vi.fn() }));
vi.mock("@/services/internal-reservation.client", () => ({ createInternalCargoReservation: function createInternalCargoReservation() {} }));
vi.mock("@/services/vehicle.service", () => ({ getVehicleCategories: vi.fn() }));
vi.mock("@/services/location.service", () => ({ getLocations: vi.fn() }));
vi.mock("@/services/settings.service", () => ({ getHotelLocationSettings: vi.fn() }));

import MockInjectorPage from "@/app/(dashboard)/reservations/new/page";

beforeEach(() => { state.service = "GUEST_TRANSPORT"; state.pickupDate = '2026-10-13T10:00:00+08:00'; state.buttons = []; state.selects = []; state.formUpdates = []; state.mutate.mockClear(); state.cargoMutate.mockClear(); vi.stubGlobal("React", React); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const renderPage = () => renderToStaticMarkup(React.createElement(MockInjectorPage));
const submit = () => state.buttons.find(button => button.className?.includes("px-5 h-10")).onClick({ preventDefault: vi.fn() });

it("saves Cargo with its complete item list through the internal boundary and canonical location IDs", () => {
  state.service = "HOTEL_SUPPLY_TRANSFER";
  const html = renderPage();
  expect(html).toContain("Cargo contents");
  expect(html).toContain("65.25 kg");
  expect(html).toContain("Save Cargo reservation");
  expect(html).toContain("Internal delivery job");
  expect(html).not.toContain("Guest Name");
  expect(html).not.toContain("Passenger Count");
  submit();
  expect(state.mutate).not.toHaveBeenCalled();
  expect(state.cargoMutate).toHaveBeenCalledOnce();
  expect(state.cargoMutate.mock.calls[0][0]).toMatchObject({ load_type: 'Cargo', pickup_location_id: 1, dropoff_location_id: 2, cargo_weight_kg: '65.25', lines: [{ name: 'Oil', expected_quantity: '100' }] });
  expect(state.cargoMutate.mock.calls[0][0]).not.toHaveProperty('source_system');
  expect(state.cargoMutate.mock.calls[0][0]).not.toHaveProperty('external_booking_id');
  expect(state.cargoMutate.mock.calls[0][0].submission_id).toMatch(/^[\da-f-]{36}$/);
});

it('interprets the Cargo picker wall time in Manila, independent of the browser timezone', () => {
  vi.stubEnv('TZ', 'UTC');
  state.service = 'HOTEL_SUPPLY_TRANSFER';
  state.pickupDate = '2026-10-28T15:00';
  renderPage();
  submit();
  expect(state.cargoMutate.mock.calls[0][0].pickup_datetime).toBe('2026-10-28T07:00:00.000Z');
});

it('retains the Cargo service when the native select emits an empty value while options change', () => {
  state.service = 'HOTEL_SUPPLY_TRANSFER';
  renderPage();
  state.selects.find(select => select.label === 'Service').onValueChange('');
  expect(state.formUpdates).toHaveLength(0);
  state.selects.find(select => select.label === 'Service').onValueChange('RESTAURANT_FOOD_DELIVERY');
  expect(state.formUpdates.at(-1).service_code).toBe('RESTAURANT_FOOD_DELIVERY');
});

it('ignores a transient empty load-type event instead of changing Cargo to Passenger', () => {
  state.service = 'HOTEL_SUPPLY_TRANSFER';
  renderPage();
  state.selects.find(select => select.label === 'Load type').onValueChange('');
  expect(state.formUpdates).toHaveLength(0);
  state.selects.find(select => select.label === 'Load type').onValueChange('Passenger');
  expect(state.formUpdates.at(-1).service_code).toBe('GUEST_TRANSPORT');
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
