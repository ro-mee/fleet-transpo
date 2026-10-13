import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildPickupCalendar } from "@/lib/reports/pickup-calendar";

vi.stubGlobal("React", React);
const { PickupRequestCalendarDays } = await import("./pickup-request-calendar-days");
const { TooltipProvider } = await import("@/components/ui/tooltip");

function render(requests, props = {}) {
  return renderToStaticMarkup(React.createElement(TooltipProvider, null,
    React.createElement(PickupRequestCalendarDays, { calendar: buildPickupCalendar(requests, "2026-10-09"), ...props })));
}

describe("pickup calendar accessibility", () => {
  it("exposes only populated days as native buttons with date and count labels", () => {
    const html = render([
      { request_id: 1, created_at: "2026-10-02" },
      { request_id: 2, created_at: "2026-10-02" },
      { request_id: 3, created_at: "2026-10-04" },
    ]);
    expect(html.match(/<button\b/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Friday, October 2, 2026. 2 requests created. View request details."');
    expect(html).toContain('aria-label="Sunday, October 4, 2026. 1 request created. View request details."');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('role="group"');
    expect(html).not.toContain('role="img"');
  });

  it("keeps empty days and adjacent-month padding out of the tab sequence", () => {
    const html = render([]);
    expect(html).not.toContain("<button");
    expect(html).toContain("Friday, October 9, 2026, today. No requests created.");
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("View request details.");
  });

  it("does not present cached counts as actionable when data is unavailable", () => {
    const html = render([{ request_id: 1, created_at: "2026-10-02" }], { available: false });
    expect(html).not.toContain("<button");
    expect(html).toContain("Request data unavailable.");
    expect(html).not.toContain("No requests created.");
  });
});
