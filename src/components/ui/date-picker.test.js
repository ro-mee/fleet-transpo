import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CalendarHeaderSelect } from "./date-picker";

describe("CalendarHeaderSelect", () => {
  const options = [
    { value: 0, label: "January" },
    { value: 1, label: "February" },
    { value: 2, label: "March" },
  ];

  it("renders closed trigger with selected option label and chevron", () => {
    const html = renderToStaticMarkup(
      React.createElement(CalendarHeaderSelect, {
        value: 1,
        onChange: vi.fn(),
        options,
      })
    );

    expect(html).toContain("February");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="listbox"');
  });

  it("matches custom className and default trigger styling", () => {
    const html = renderToStaticMarkup(
      React.createElement(CalendarHeaderSelect, {
        value: 0,
        onChange: vi.fn(),
        options,
        className: "w-auto",
      })
    );

    expect(html).toContain("January");
    expect(html).toContain("w-auto");
    expect(html).toContain("border-border/80");
  });
});
