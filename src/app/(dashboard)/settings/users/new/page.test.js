import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ role: "admin" }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { role: auth.role } }) }));
vi.mock("@/lib/auth/role-guard", () => ({ useRequireRole: () => ({ authorized: true }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn() }) }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ theme: "light" }) }));
vi.mock("framer-motion", () => ({
  motion: new Proxy({}, { get: () => ({ children }) => children }),
  MotionConfig: ({ children }) => children,
  AnimatePresence: ({ children }) => children,
}));

vi.stubGlobal("React", React);
const { default: AddUserPage } = await import("./page");

function renderRoles(role) {
  auth.role = role;
  vi.stubGlobal("React", React);
  const client = new QueryClient();
  try {
    const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(AddUserPage)));
    return [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map(match => match[1]);
  } finally { client.clear(); }
}
afterEach(() => vi.unstubAllGlobals());

describe("Add User role choices", () => {
  it.each(["admin", "super_admin"])("offers Mechanic with its workshop scope to %s", role => {
    const mechanic = renderRoles(role).find(button => button.includes("Mechanic"));
    expect(mechanic).toBeDefined();
    expect(mechanic).toContain("assigned repair jobs");
  });

  it("keeps privileged accounts and driver provisioning out of the Admin picker", () => {
    const buttons = renderRoles("admin").join(" ");
    expect(buttons).toContain("Fleet Manager");
    expect(buttons).not.toContain("Super Admin");
    expect(buttons).not.toContain("FleetOps Admin");
    expect(buttons).not.toContain("Driver");
  });

  it.each([undefined, "fleet_manager", "unknown"])("does not offer account roles to unauthorized actor %s", role => {
    const buttons = renderRoles(role).join(" ");
    for (const label of ["Mechanic", "Fleet Manager", "Dispatcher", "Management", "Super Admin", "FleetOps Admin"]) {
      expect(buttons).not.toContain(label);
    }
  });
});
