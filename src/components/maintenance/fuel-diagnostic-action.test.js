import React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ cells: [], cursor: 0 }));
vi.mock("react", async (original) => ({ ...await original(),
  useState: (initial) => {
    const i = state.cursor++;
    if (!(i in state.cells)) state.cells[i] = initial;
    return [state.cells[i], (next) => { state.cells[i] = typeof next === "function" ? next(state.cells[i]) : next; }];
  },
  useRef: (initial) => {
    const i = state.cursor++;
    return state.cells[i] ?? (state.cells[i] = { current: initial });
  },
}));
vi.mock("@/lib/api/client", () => ({ apiFetch: vi.fn(async () => ({ maintenance_id: 45 })) }));
vi.mock("@/components/ui/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { apiFetch } from "@/lib/api/client";
import { FuelDiagnosticAction } from "./fuel-diagnostic-action";
const props = {
  vehicle: { vehicle_id: 12, plate_number: "ABC 1234", estimated_kmpl: 6.4, baseline_efficiency: 8.5, trips: 18, distance: 1240, liters: 193 },
  from: "2026-09-01", to: "2026-09-30", lookup: { data: [] }, onFiled: vi.fn(),
};
function tree(extra = {}) { state.cursor = 0; return FuelDiagnosticAction({ ...props, ...extra }); }
function findButton(node, text) {
  if (node?.props?.onClick && React.Children.toArray(node.props.children).some((child) => typeof child === "string" && child.includes(text))) return node;
  return React.Children.toArray(node?.props?.children).map((child) => findButton(child, text)).find(Boolean);
}
beforeEach(() => { vi.stubGlobal("React", React); state.cells = []; state.cursor = 0; vi.clearAllMocks(); });
afterEach(() => vi.unstubAllGlobals());
it("requires an explicit confirmation before creating another open diagnostic", async () => {
  const existingDiagnostic = { maintenance_id: 44, vehicle_id: 12, status: "Scheduled" };
  const extra = { existingDiagnostic };
  await findButton(tree(extra), "Create another diagnostic").props.onClick();
  expect(apiFetch).not.toHaveBeenCalled();
  await findButton(tree(extra), "Confirm another diagnostic").props.onClick();
  expect(apiFetch).toHaveBeenCalledWith("/api/vehicle-maintenance", expect.objectContaining({ method: "POST", body: expect.objectContaining({ vehicle_id: 12, maintenance_type: "Inspection", cost: 0 }) }));
  expect(props.onFiled).toHaveBeenCalledOnce();
});
it("does not file when the lookup failed", () => {
  const extra = { lookup: { isError: true, refetch: vi.fn() } };
  expect(findButton(tree(extra), "Create diagnostic work order")).toBeUndefined();
});
it("prevents a rapid second click while the first filing is pending", async () => {
  let resolve;
  apiFetch.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const button = findButton(tree(), "Create diagnostic work order");
  const first = button.props.onClick();
  await button.props.onClick();
  expect(apiFetch).toHaveBeenCalledOnce();
  resolve({ maintenance_id: 45 }); await first;
  expect(findButton(tree(), "Create diagnostic work order")).toBeUndefined();
});
