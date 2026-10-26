import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/ui/dialog", () => ({ Dialog: ({ children }) => children, DialogContent: ({ children }) => children, DialogHeader: ({ children }) => children, DialogTitle: ({ children }) => children }));
vi.stubGlobal("React", React);
const { ExpenseVerificationModal } = await import("./ExpenseVerificationModal");
const record = { id: 17, status: "Pending", amount: 0, expense_date: "2026-10-26", currency: "PHP", driver: { employee: { first_name: "Test", last_name: "Driver" } } };
const render = (canReview) => renderToStaticMarkup(React.createElement(ExpenseVerificationModal, { record, canReview, onClose: vi.fn(), onReview: vi.fn() }));

describe("expense review authority", () => {
  it("keeps the pending record readable without offering unauthorized review actions", () => {
    const html = render(false);
    expect(html).toContain("read-only access");
    expect(html).not.toContain("Approve</button>");
    expect(html).not.toContain("Reject</button>");
  });
  it("offers decisions when the caller holds review permission", () => {
    expect(render(true)).toContain("Approve</button>");
  });
});
