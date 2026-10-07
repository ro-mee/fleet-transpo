import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The reported symptom: "Vehicle edit category and license class are blank".
//
// Diagnosis (read-only, against live on 2026-10-01): 16 of 21 non-deleted
// vehicles store a NULL `category_id` and 20 of 21 store a NULL
// `required_license_class`. The GET selects both columns and the reset assigns
// exactly what the row holds, so there was no prefill bug to fix — the controls
// were truthfully showing a column the system had never recorded. What was
// wrong is that an empty control is indistinguishable from a failed prefill, so
// the form now SAYS which one it is. These tests pin that, plus the rule that a
// stored value is still prefilled unchanged.
const state = vi.hoisted(() => ({ queries: {}, mutations: [] }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }) =>
    state.queries[queryKey[0]] || { data: undefined, isLoading: false, isError: false, refetch: vi.fn() },
  useMutation: (options) => {
    state.mutations.push(options);
    return { mutate: vi.fn(), isPending: false, reset: vi.fn(), error: null };
  },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
}));
vi.mock("@/lib/auth/role-guard", () => ({
  useRequireRole: () => ({ authorized: true, role: "admin", loading: false, missingRole: false }),
}));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn(), toggleTheme: vi.fn() }),
}));
vi.mock("@/services/vehicle.service", () => ({
  createVehicle: vi.fn(),
  updateVehicle: vi.fn(),
  getVehicle: vi.fn(),
  getVehicleCategories: vi.fn(),
}));
vi.mock("@/services/ai.service", () => ({ scanDocumentWithAi: vi.fn() }));
// page-entrance (framer-motion) attaches document listeners as soon as it can
// see a window; the static render replaces it with a passthrough.
vi.mock("framer-motion", () => ({
  motion: new Proxy({}, { get: () => ({ children }) => children }),
  MotionConfig: ({ children }) => children,
  AnimatePresence: ({ children }) => children,
  animate: () => ({ stop: () => {} }),
}));

vi.stubGlobal("React", React);
const { default: VehicleFormPage } = await import("./page");

const CATEGORIES = [
  { category_id: 3, category_name: "Guest Transportation" },
  { category_id: 4, category_name: "Hotel Operations" },
];

function render(vehicle) {
  state.queries["vehicle"] = { data: vehicle, isLoading: false, isError: false, refetch: vi.fn() };
  state.queries["vehicle-categories"] = { data: CATEGORIES, isLoading: false, isError: false, refetch: vi.fn() };
  return renderToStaticMarkup(React.createElement(VehicleFormPage, { params: { id: "37" } }));
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  state.queries = {};
  state.mutations = [];
});
afterEach(() => vi.unstubAllGlobals());

describe("Vehicle edit form — category and license class", () => {
  it("says a missing category was never recorded, and does not claim to prefill one", () => {
    const html = render({ vehicle_id: 37, plate_number: "ABC-1234", vehicle_name: "SUV", category_id: null, required_license_class: null });
    expect(html).toContain("Not recorded — select a category");
    expect(html).toContain("No category is stored on this vehicle");
    // It must not pretend a value that was never stored now exists.
    expect(html).not.toContain("Guest Transportation");
  });

  it("says a missing license class was never recorded and must be chosen", () => {
    const html = render({ vehicle_id: 37, plate_number: "ABC-1234", vehicle_name: "SUV", category_id: null, required_license_class: null });
    expect(html).toContain("Not recorded — choose the code on the registration");
    expect(html).toContain("No LTO code is stored on this vehicle");
  });

  it("shows no missing-value notice for a vehicle whose columns are populated", () => {
    // The notice is driven by the loaded row, not applied blanket — so a vehicle
    // WITH a recorded category and LTO code must not be accused of lacking them.
    // (The prefilled values themselves land via `form.reset` in an effect, which
    // a static render does not run; what is assertable here is that the form
    // does not report a value as missing when the record has one.)
    const html = render({ vehicle_id: 37, plate_number: "ABC-1234", vehicle_name: "SUV", category_id: 3, required_license_class: "b1" });
    expect(html).not.toContain("Not recorded");
    expect(html).not.toContain("No category is stored");
    expect(html).not.toContain("No LTO code is stored");
  });

  it("flags each missing column independently", () => {
    // Category present, license class never recorded: only the license control
    // should be marked missing.
    const html = render({ vehicle_id: 37, plate_number: "ABC-1234", vehicle_name: "SUV", category_id: 3, required_license_class: null });
    expect(html).toContain("Not recorded — choose the code on the registration");
    expect(html).toContain("No LTO code is stored on this vehicle");
    expect(html).not.toContain("Not recorded — select a category");
    expect(html).not.toContain("No category is stored");
  });

  it("does not accuse a vehicle that is still loading of missing values", () => {
    state.queries["vehicle"] = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
    state.queries["vehicle-categories"] = { data: CATEGORIES, isLoading: false, isError: false, refetch: vi.fn() };
    const html = renderToStaticMarkup(React.createElement(VehicleFormPage, { params: { id: "37" } }));
    expect(html).not.toContain("Not recorded");
  });
});

describe("Vehicle form — operational use and capacity", () => {
  it('offers explicit saved-document commissioning on the admin edit form with honest pending-plate copy',()=>{
    const html=render({vehicle_id:37,plate_number:null,fleet_asset_code:'FLT-037',documents:[]});
    expect(html).toContain('Verify documents and commission');
    expect(html).toContain('official plate is pending');
    expect(html).toContain('OR/CR Registration Expiry');
  });
  it("shows seats for unclassified stock and offers the cargo branch", () => {
    // Static render never runs the reset effect, so the form sits at its
    // defaults (operational_use ""): legacy rows keep the passenger layout.
    const html = render({ vehicle_id: 37, plate_number: "ABC-1234", vehicle_name: "SUV", category_id: null, required_license_class: null });
    expect(html).toContain("Operational Use");
    expect(html).toContain("Fleet Asset Code");
    expect(html).toContain("Passenger Capacity");
    expect(html).toContain("Unclassified stock keeps the passenger layout until inventoried.");
    // The kilograms field appears only after Cargo is chosen (client state a
    // static render cannot simulate), never alongside seats.
    expect(html).not.toContain("Cargo Capacity (kg)");
  });
});
