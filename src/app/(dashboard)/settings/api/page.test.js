import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "super_admin", authorized: true }));
vi.mock("@/lib/auth/role-guard", () => ({ useRequireRole: () => state }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ theme: "light" }) }));
vi.stubGlobal("React", React);
const { default: Page } = await import("./page");
afterEach(() => vi.unstubAllGlobals());

describe("existing integration settings discovery", () => {
  it("links the guarded current Supply records and keeps source activation honest", () => {
    vi.stubGlobal("React", React);
    state.role = "super_admin";
    state.authorized = true;
    const html = renderToStaticMarkup(React.createElement(Page));
    expect(html).toContain('href="/supply-deliveries"');
    expect(html).toContain("current shipment snapshots");
    expect(html).toContain("sandbox imports");
    expect(html).not.toContain("connected SCM");
  });

  it("does not render the privileged discovery section for an unauthorized role", () => {
    vi.stubGlobal("React", React);
    state.role = "dispatcher";
    state.authorized = false;
    const html = renderToStaticMarkup(React.createElement(Page));
    expect(html).not.toContain('href="/supply-deliveries"');
  });
});
