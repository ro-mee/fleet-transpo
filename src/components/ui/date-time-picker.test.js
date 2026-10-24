import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DateTimePicker } from "./date-time-picker";

describe("DateTimePicker keyboard trigger", () => {
  it("renders a named native button so Tab, Enter and Space work through the popover", () => {
    const html = renderToStaticMarkup(React.createElement(DateTimePicker, {label:"Observation date and time",onChange:vi.fn()}));
    const trigger = html.match(/<button[^>]*aria-label="Observation date and time"[^>]*>/)?.[0];
    expect(trigger).toBeDefined();
    expect(trigger).toContain('type="button"');
    expect(trigger).toContain('aria-haspopup="dialog"');
    expect(trigger).toContain("focus-visible:ring-2");
  });
  it("preserves the disabled control and names its selected value", () => {
    const html = renderToStaticMarkup(React.createElement(DateTimePicker, {label:"Observation time",value:"2026-10-01T12:30",disabled:true}));
    expect(html).toMatch(/<button[^>]*aria-label="Observation time: Oct 01, 2026, 12 : 30 PM"[^>]*disabled=""/);
  });
});
