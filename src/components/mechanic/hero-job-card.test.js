import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { summaryJob } from "./test-fixtures";

vi.mock("next/link", () => ({ default: ({ children }) => children }));

vi.stubGlobal("React", React);
const { HeroJobCard } = await import("./hero-job-card");
const { DESKTOP_ONLY_TITLE } = await import("./mechanic-actions");

beforeEach(() => {
  vi.stubGlobal("React", React);
});
afterEach(() => vi.unstubAllGlobals());

function render(props) {
  return renderToStaticMarkup(React.createElement(HeroJobCard, props));
}

describe("hero-job-card actions", () => {
  it("Scheduled job shows Start only", () => {
    const html = render({ job: summaryJob({ status: "Scheduled" }), desktop: true });
    expect(html).toContain("Start");
    expect(html).not.toContain("Mark Ready");
    expect(html).not.toContain("Approve");
    expect(html).not.toContain("Complete");
  });

  it("In Progress job shows Mark Ready (+ Continue), never Approve/Complete", () => {
    const html = render({ job: summaryJob({ status: "In Progress" }), desktop: true });
    expect(html).toContain("Mark Ready");
    expect(html).toContain("Continue");
    expect(html).toContain("/mechanic/work-orders/7");
    expect(html).not.toContain("Approve");
    // "Complete" as an action label must never render for role mechanic.
    // ("Evidence completeness" copy lives below — scope the check to buttons.)
    const buttons = html.match(/<button[\s\S]*?<\/button>/g) || [];
    expect(buttons.join(" ")).not.toContain("Complete");
  });

  it("small-screen mutating buttons render disabled with the desktop reason", () => {
    const html = render({ job: summaryJob({ status: "Scheduled" }), desktop: false });
    expect(html).toContain("disabled");
    expect(html).toContain(DESKTOP_ONLY_TITLE);
  });
});
