import React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ cells: [], cursor: 0, queries: {}, queryFns: {}, mutations: [], params: "" }));
vi.mock("react", async (original) => ({ ...await original(),
  useState: initial => {
    const i = state.cursor++;
    if (!(i in state.cells)) state.cells[i] = typeof initial === "function" ? initial() : initial;
    return [state.cells[i], next => { state.cells[i] = typeof next === "function" ? next(state.cells[i]) : next; }];
  },
  useMemo: fn => fn(), useEffect: () => {},
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(state.params) }));
vi.mock("next/link", () => ({ default: ({ children, href, ...props }) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/lib/auth/role-guard", () => ({ useRequireRole: () => ({ role: "fleet_manager" }) }));
vi.mock("@/lib/validation/useFormValidation", () => ({ useFormValidation: () => ({ validate: () => true, fieldError: () => ({}), registerField: () => ({}), resetValidation: () => {} }) }));
vi.mock("@/lib/api/client", async original => ({ ...await original(), apiFetch: vi.fn(async () => ({})) }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ theme: "light" }) }));
vi.mock("framer-motion", () => ({ motion: new Proxy({}, { get: () => ({ children }) => children }), MotionConfig: ({ children }) => children, AnimatePresence: ({ children }) => children, animate: () => ({ stop() {} }) }));
vi.mock("@/components/ui/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tanstack/react-query", () => ({
  keepPreviousData: data => data,
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: ({ queryKey, queryFn }) => { state.queryFns[queryKey[0]] = queryFn; return state.queries[queryKey[0]] ?? { data: [] }; },
  useMutation: () => ({ mutate: body => state.mutations.push(body), isPending: false }),
}));
import { apiFetch } from "@/lib/api/client";
import MaintenancePage from "@/app/(dashboard)/maintenance/page";
import ProblemsPage from "@/app/(dashboard)/maintenance/problems/page";

function find(node, predicate) {
  if (predicate(node)) return node;
  return React.Children.toArray(node?.props?.children).map(child => find(child, predicate)).find(Boolean);
}
function page(Component) { state.cursor = 0; return Component(); }
function edit(record) {
  const table = find(page(MaintenancePage), node => node?.type?.name === "DataTable");
  const actions = table.props.columns.find(column => column.id === "actions").cell({ row: { original: record } });
  const tooltip = find(actions, node => node?.props?.content === "Edit Record");
  tooltip.props.children.props.onClick();
  return page(MaintenancePage);
}
beforeEach(() => {
  vi.stubGlobal("React", React); vi.clearAllMocks();
  state.cells = []; state.cursor = 0; state.queries = {}; state.queryFns = {}; state.mutations = []; state.params = "";
});
afterEach(() => vi.unstubAllGlobals());

it("sends a return-for-repair reason from the actual staff register form", () => {
  const record = { maintenance_id: 44, vehicle_id: 12, status: "Pending Inspection", maintenance_date: "2026-10-20" };
  find(edit(record), node => node?.props?.id === "status").props.onValueChange("In Progress");
  const reason = find(page(MaintenancePage), node => node?.props?.id === "rejection_reason");
  expect(reason).toBeDefined();
  const submit = tree => find(tree, node => node?.type === "form").props.onSubmit({ preventDefault() {} });
  submit(page(MaintenancePage));
  expect(state.mutations).toEqual([]);
  reason.props.onChange({ target: { value: "Brakes still fail the road test" } });
  submit(page(MaintenancePage));
  expect(state.mutations[0]).toMatchObject({ id: 44, data: { status: "In Progress", rejection_reason: "Brakes still fail the road test" } });
});

it("follows the exact work order from a problem queue link", async () => {
  state.params = "work_order_id=44";
  page(MaintenancePage);
  await state.queryFns.maintenance();
  expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining("maintenance_id=44"));
});

it("opens a queue link from the first register page even after earlier pagination", async () => {
  const table = find(page(MaintenancePage), node => node?.type?.name === "DataTable");
  table.props.onPageChange(3);
  state.params = "work_order_id=44";
  page(MaintenancePage);
  await state.queryFns.maintenance();
  const requested = new URL(apiFetch.mock.calls.at(-1)[0], "http://test");
  expect(requested.searchParams.get("page")).toBe("1");
});

it("lets the reviewing staff see saved diagnosis, parts and labor before deciding", () => {
  const record = { maintenance_id: 44, vehicle_id: 12, status: "Pending Inspection", diagnosis: "Brake pads worn", parts_replaced: [{ name: "Brake pads", qty: 2 }], labor_hours: "1.5", remarks: "Road tested" };
  const panel = find(edit(record), node => node?.type?.name === "RepairEvidence");
  expect(panel).toBeDefined();
  const html = renderToStaticMarkup(panel);
  expect(html).toContain("Brake pads worn");
  expect(html).toContain("Brake pads");
  expect(html).toContain("1.5");
  expect(html).toContain("Road tested");
});

it("paginates the actual queue query so problems beyond the first page are reachable", async () => {
  state.queries["vehicle-problems"] = { data: { items: [], total: 120, counts: { reportedUntracked: 4, failedUntracked: 9, tracked: 107 } } };
  const tree = page(ProblemsPage);
  const next = find(tree, node => node?.props?.["aria-label"] === "Next page");
  expect(next).toBeDefined();
  next.props.onClick();
  page(ProblemsPage);
  await state.queryFns["vehicle-problems"]();
  expect(apiFetch).toHaveBeenLastCalledWith(expect.stringContaining("offset=25"));
});

it("shows accountable repair follow-up, not notification-as-resolution wording", () => {
  state.queries["vehicle-problems"] = { data: { items: [{ inspectionId: 9, vehicleId: 12, bucket: "tracked", inspectionType: "Pre-Trip", inspectionDate: "2026-10-20", severityLabel: "High", workOrderId: 44, workOrderStatus: "Pending Inspection", assignedMechanicId: 77, assignedMechanicName: "Rosa Diaz", report: { kind: "free_text", text: "Brakes" } }], total: 1, counts: { reportedUntracked: 0, failedUntracked: 0, tracked: 1 } } };
  const html = renderToStaticMarkup(page(ProblemsPage));
  expect(html).toContain("Rosa Diaz");
  expect(html).toContain("work_order_id=44");
  expect(html).toContain("Fleet Manager review");
  expect(html).not.toContain("already answered by the office notification");
});
