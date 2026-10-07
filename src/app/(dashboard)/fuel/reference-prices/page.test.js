import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const view = vi.hoisted(() => ({ canEdit: true, query: { data: { rows: [], region: "NCR" } } }));
vi.mock("@/hooks/use-role-access", () => ({ useRequireRole: () => ({ authorized: true }), useRoleAccess: () => ({ loading: false, can: (_resource, action) => action === "read" || view.canEdit }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => view.query, useQueryClient: () => ({ invalidateQueries: () => {} }), useMutation: () => ({ mutate: () => {}, isPending: false }) }));
vi.stubGlobal("React", React);
const { default: ReferencePricesPage, ReferencePriceHistory, manualSnapshotBody } = await import("./page");
beforeEach(() => { view.canEdit = true; view.query = { data: { rows: [], region: "NCR" } }; });
describe("reference-price review surface", () => {
  it("renders the manager workflow and hides write controls from observers", () => {
    let markup = renderToStaticMarkup(<ReferencePricesPage />);
    expect(markup).toContain("Record verified price"); expect(markup).toContain('id="effective-at"'); expect(markup).toContain("Save region");
    view.canEdit = false; markup = renderToStaticMarkup(<ReferencePricesPage />);
    expect(markup).not.toContain("Record verified price"); expect(markup).not.toContain("Save region"); expect(markup).toContain("Verified history");
  });
  it("shows schema failures and loading without exposing a working write form", () => {
    view.query = { error: new Error("Fuel migrations are pending"), refetch: () => {} };
    let markup = renderToStaticMarkup(<ReferencePricesPage />); expect(markup).toContain("Fuel migrations are pending"); expect(markup).not.toContain("Record verified price");
    view.query = { isLoading: true }; markup = renderToStaticMarkup(<ReferencePricesPage />); expect(markup).toContain("Loading verified history");
  });
  it("shows source, effectivity, verifier and lifecycle rather than disguising an estimate as a receipt", () => {
    const markup = renderToStaticMarkup(<ReferencePriceHistory rows={[{ snapshot_id: 4, fuel_product: "Diesel", region: "NCR", reference_price: 62.7, source_url: "https://official.example/prices", effective_at: "2026-10-01T00:00:00+08:00", verification_method: "Manual", verified_by: 3, lifecycle: "Historical" }]} />);
    expect(markup).toContain("official.example"); expect(markup).toContain("Historical"); expect(markup).toContain("Manual"); expect(markup).toContain("Verifier 3"); expect(markup).toContain("Effectivity");
  });
  it("turns Manila form timestamps into explicit instants without client verification authority", () => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ fuel_product: "Diesel", region: "NCR", reference_price: "62.70", effective_at: "2026-10-01T00:00", source_url: "https://official.example/prices", verified_by: "999" })) form.set(key, value);
    expect(manualSnapshotBody(form)).toEqual({ fuel_product: "Diesel", region: "NCR", reference_price: "62.70", prior_price: null, announced_at: null, effective_at: "2026-10-01T00:00:00+08:00", source_url: "https://official.example/prices" });
  });
});
