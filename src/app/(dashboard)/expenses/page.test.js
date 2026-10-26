import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "@/components/ui/tooltip";

const state = vi.hoisted(() => ({ query: {}, table: null, exportClick: null, getAll: vi.fn(), exportCSV: vi.fn((rows) => ({ count: rows.length })), role: "admin" }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => state.query, keepPreviousData: (data) => data,
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/lib/auth/role-guard", () => ({ useRequireRole: () => ({ authorized: true, role: state.role }) }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ theme: "light" }) }));
vi.mock("@/services/expenses.service", () => ({ getExpenseRecords: vi.fn(), getAllExpenseRecords: state.getAll, reviewExpenseRecord: vi.fn() }));
vi.mock("@/components/tables/data-table", () => ({ DataTable: (props) => { state.table = props; return null; } }));
vi.mock("@/lib/export", () => ({ exportToCSV: state.exportCSV }));
vi.mock("@/components/ui/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() }, isAuthToastSuppressed: () => false }));
vi.mock("@/components/ui/button", () => ({ Button: ({ children, onClick, ...props }) => {
  if (Array.isArray(children) && children.includes("Export CSV")) state.exportClick = onClick;
  return React.createElement("button", { ...props, onClick }, children);
} }));
vi.stubGlobal("React", React);
const { default: ExpensesPage } = await import("./page");
const render = () => renderToStaticMarkup(React.createElement(TooltipProvider, null, React.createElement(ExpensesPage)));

beforeEach(() => {
  state.table = null; state.exportClick = null; state.role = "admin";
  state.query = { data: { rows: [], total: 23, counts: { total: 23, pending: 23, approved: 0, rejected: 0, approvedCost: 0 } }, isLoading: false, isError: false, refetch: vi.fn() };
  state.getAll.mockResolvedValue([{ id: 1 }]);
});

describe("expense registry interactions", () => {
  it("connects the shared table to server pagination, search and sort", () => {
    render();
    expect(state.table).toMatchObject({ manualPagination: true, rowCount: 23, pageIndex: 0, searchValue: "" });
    expect(state.table.onSearchChange).toEqual(expect.any(Function));
    expect(state.table.onSortChange).toEqual(expect.any(Function));
  });
  it("collects the full filtered set for export", async () => {
    render();
    expect(state.exportClick).toEqual(expect.any(Function));
    await state.exportClick();
    expect(state.getAll).toHaveBeenCalledWith(expect.objectContaining({ status: "Pending" }));
    const columns = state.exportCSV.mock.lastCall[2];
    const currency = columns.find(column => column.label === "Currency");
    expect(currency).toBeDefined();
    expect(currency.accessor({ currency: " usd " })).toBe("USD");
    expect(currency.accessor({ currency: null })).toBe("Unknown");
  });
  it("shows a failed query instead of an empty expense register", () => {
    state.query = { isError: true, refetch: vi.fn() };
    const html = render();
    expect(html).toContain("Expenses unavailable");
    expect(html).toContain("Try again");
    expect(state.table).toBeNull();
  });
});
