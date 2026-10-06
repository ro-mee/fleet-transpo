import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ locations: [] }));

vi.mock("next/link", async () => {
  const ReactModule = await import("react");
  return { default: ({ href, children, ...props }) => ReactModule.createElement("a", { href, ...props }, children) };
});

vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQuery: () => ({ data: state.locations, isError: false, isLoading: false, refetch: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/components/tables/data-table", async () => {
  const ReactModule = await import("react");
  return {
    DataTable: ({ columns, data, description }) => ReactModule.createElement(
      "section",
      null,
      ReactModule.createElement("p", null, description),
      ...data.map((row) => ReactModule.createElement(
        "article",
        { key: row.location_id },
        ...columns.map((column) => ReactModule.createElement(
          "div",
          { key: column.key },
          column.render ? column.render(row[column.key], row) : row[column.key]
        ))
      ))
    ),
  };
});

vi.mock("@/components/ui/hero-header", async () => {
  const ReactModule = await import("react");
  return {
    HeroHeader: ({ description, actions }) => ReactModule.createElement("header", null, description, actions),
    heroButtonOutlineClass: "",
    heroButtonPrimaryClass: "",
  };
});

vi.mock("@/components/ui/button", async () => {
  const ReactModule = await import("react");
  return {
    Button: ({ asChild, children, ...props }) => asChild
      ? children
      : ReactModule.createElement("button", props, children),
  };
});

vi.mock("@/components/ui/badge", async () => {
  const ReactModule = await import("react");
  return { Badge: ({ children }) => ReactModule.createElement("span", null, children) };
});

vi.mock("@/components/ui/empty-state", () => ({ EmptyState: () => null }));
vi.mock("@/components/ui/input", async () => {
  const ReactModule = await import("react");
  return { Input: (props) => ReactModule.createElement("input", props) };
});
vi.mock("@/components/ui/label", async () => {
  const ReactModule = await import("react");
  return { Label: ({ children, ...props }) => ReactModule.createElement("label", props, children) };
});
vi.mock("@/components/ui/dialog", async () => {
  const ReactModule = await import("react");
  return {
    Dialog: ({ open, children }) => open ? ReactModule.createElement("div", null, children) : null,
    DialogContent: ({ children }) => ReactModule.createElement("div", null, children),
    DialogDescription: ({ children }) => ReactModule.createElement("p", null, children),
    DialogFooter: ({ children }) => ReactModule.createElement("footer", null, children),
    DialogHeader: ({ children }) => ReactModule.createElement("div", null, children),
    DialogTitle: ({ children }) => ReactModule.createElement("h2", null, children),
  };
});

vi.mock("@/components/ui/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/role-guard", () => ({ can: () => true, useRequireRole: () => ({ authorized: true }) }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ employee: { role: "admin" } }) }));
vi.mock("@/lib/validation/useFormValidation", () => ({
  useFormValidation: () => ({
    validate: () => true,
    fieldError: () => ({ invalid: false, error: null }),
    registerField: () => undefined,
    resetValidation: vi.fn(),
  }),
}));
vi.mock("@/components/address/address-form-dialog", () => ({ AddressFormDialog: () => null }));
vi.mock("@/hooks/use-structured-address", () => ({ useStructuredAddress: () => ({ value: null, reason: "no-address-id" }) }));
vi.mock("@/services/location.service", () => ({ createLocation: vi.fn(), getLocations: vi.fn(), updateLocation: vi.fn() }));
vi.mock("@/lib/address/structured", () => ({
  formatStructuredAddress: () => "",
  isUnchangedPick: () => false,
  PREFILL_REASON_MESSAGES: {},
  UNCHANGED_PICK_MESSAGE: "",
}));
vi.mock("@/lib/google-maps", () => ({ isGoogleMapsUrl: () => true, parseGoogleMapsCoordinates: () => null }));
vi.mock("@/lib/utils", () => ({ cn: (...values) => values.filter(Boolean).join(" ") }));

import LocationsPage from "./page";

function location(overrides = {}) {
  return {
    location_id: 17,
    location_code: "f902c1ea-6019-46e0-b56d-0b429fae0ee6",
    name: "BGC Terminal",
    address: "8572 Winding Creek Boulevard, Quezon City",
    latitude: 14.6538,
    longitude: 121.0282,
    is_active: true,
    ...overrides,
  };
}

function renderPage() {
  return renderToStaticMarkup(React.createElement(LocationsPage));
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  state.locations = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Fleet location coordinate provenance disclosure", () => {
  it("labels an active valid registry coordinate pair canonical_registry and not independently verified", () => {
    state.locations = [location({
      coordinate_provenance: "canonical_registry",
      coordinate_provenance_note: "not independently verified",
    })];

    const markup = renderPage();

    expect(markup).toContain("canonical_registry");
    expect(markup).toContain("not independently verified");
  });

  it.each([
    ["inactive", location({ is_active: false })],
    ["missing", location({ latitude: null })],
    ["invalid", location({ longitude: 181 })],
  ])("does not show the provenance label for %s location coordinates", (_description, row) => {
    state.locations = [row];

    const markup = renderPage();

    expect(markup).not.toContain("canonical_registry");
    expect(markup).not.toContain("not independently verified");
  });
});
