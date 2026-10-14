import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ role: "admin", search: "", queries: {}, enabled: {} }));
vi.mock("react", async importOriginal => ({ ...await importOriginal(), useSyncExternalStore: () => state.search }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ employee: { roles: { role_name: state.role } } }) }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ theme: "light" }) }));
vi.mock("@/lib/auth/role-guard", () => ({ useRequireRole: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: options => { state.enabled[options.queryKey[0]] = options.enabled; return state.queries[options.queryKey[0]] ?? { data: {}, isSuccess: true, refetch: vi.fn() }; },
  useMutation: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.stubGlobal("React", React);
const { default: SourcePage } = await import("./page");

const SHIPMENTS = [
  { supply_shipment_id: "b8a20842-3056-41fb-9cf2-cfe37a0af9e3", external_request_id: "SOURCE-A", current_manifest_revision: 1, source_organization_id: "sandbox:demo", pickup_site_id: "WH-A", delivery_site_id: "DEST-A" },
  { supply_shipment_id: "c1c5f839-d1da-4abc-8e8e-632e1fbf9ff8", external_request_id: "SOURCE-B", current_manifest_revision: 2, source_organization_id: "sandbox:demo", pickup_site_id: "WH-B", delivery_site_id: "DEST-B" },
];
beforeEach(() => {
  vi.stubGlobal("React", React);
  state.role = "admin";
  state.search = "";
  state.enabled = {};
  state.queries = { "supply-shipments": { data: { shipments: SHIPMENTS }, isSuccess: true }, "supply-cargo-profiles": { data: { profiles: [] }, isSuccess: true }, "supply-site-mappings": { data: { mappings: [], locations: [] }, isSuccess: true } };
});
afterEach(() => vi.unstubAllGlobals());

describe("retained Supply source view", () => {
  it("preserves exact local shipment links and removes the duplicate profile writer", () => {
    state.search = `?shipmentId=${SHIPMENTS[1].supply_shipment_id}`;
    const html = renderToStaticMarkup(React.createElement(SourcePage));
    expect(html).toContain("Supply source history");
    expect(html).not.toContain("Linked shipment unavailable");
    expect(html.match(/<button[^>]*aria-pressed="true"[\s\S]*?<\/button>/)?.[0]).toContain("SOURCE-B");
    expect(html).not.toContain("Save cargo profile");
    expect(html).not.toContain("Enable supply delivery");
    expect(html).toContain('href="/fleet/vehicles"');
    expect(html).toContain("Import sandbox event");
  });

  it("keeps sandbox importer and mapping writes hidden from dispatchers", () => {
    state.role = "dispatcher";
    const html = renderToStaticMarkup(React.createElement(SourcePage));
    expect(state.enabled["supply-site-mappings"]).toBe(false);
    expect(html).not.toContain("Import sandbox event");
    expect(html).not.toContain("Save site mapping");
    expect(html).not.toContain('href="/fleet/vehicles"');
    expect(html).toContain("SOURCE-A");
  });

  it("keeps malformed or foreign shipment links visibly unavailable", () => {
    state.search = "?shipmentId=external-order-123";
    const html = renderToStaticMarkup(React.createElement(SourcePage));
    expect(html).toContain("Linked shipment unavailable");
    expect(html.match(/<button[^>]*aria-pressed="true"[\s\S]*?<\/button>/)?.[0]).toContain("SOURCE-A");
  });
});
