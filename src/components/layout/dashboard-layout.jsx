"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar, TopNav } from "@/components/layout/app-shell";
import { ErrorBoundary } from "@/components/error-boundary";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2, CheckCircle, XCircle, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { CommandPalette } from "@/components/ui/command-palette";
import { useRequireRole } from "@/hooks/use-role-access";
import { useSidebar } from "@/hooks/use-sidebar";
import { getRequiredRolesForPath } from "@/lib/auth/role-guard";

const authRoutes = ["/login", "/register", "/forgot-password", "/reset-password"];

function isRestrictedRoute(pathname) {
  const roles = getRequiredRolesForPath(pathname);
  return !roles.includes("*");
}

function RoleNotConfiguredCard({ email, router }) {
  const [fixing, setFixing] = useState(false);
  const [result, setResult] = useState(null);

  const handleFix = async () => {
    setFixing(true);
    setResult(null);
    try {
      const res = await fetch("/api/auth/fix-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ ok: true, message: data.message });
      } else {
        setResult({ ok: false, message: data.error || "Something went wrong" });
      }
    } catch {
      setResult({ ok: false, message: "Network error — check your connection" });
    } finally {
      setFixing(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Card className="border-0 shadow-sm max-w-md w-full">
        <CardContent className="py-12 text-center">
          {result?.ok ? (
            <CheckCircle className="w-12 h-12 mx-auto mb-4 text-success" />
          ) : (
            <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-warning" />
          )}
          <h2 className="text-lg font-semibold text-foreground mb-2">
            {result?.ok ? "Account Fixed" : "Role Not Configured"}
          </h2>
          <p className="text-sm text-foreground-secondary mb-6">
            {result?.ok
              ? result.message
              : "Your account is linked to an employee profile, but no role has been assigned."}
          </p>
          {result?.ok ? (
            <Button onClick={() => { window.location.href = "/login"; }}>
              Log in Again
            </Button>
          ) : (
            <div className="flex flex-col gap-3">
              {result && !result.ok && (
                <p className="text-xs text-error">{result.message}</p>
              )}
              <Button onClick={handleFix} disabled={fixing}>
                {fixing ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Fixing...</>
                ) : (
                  "Fix My Account"
                )}
              </Button>
              <Button variant="outline" onClick={() => router.replace("/login")}>
                Return to Login
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AccessRestrictedPanel() {
  const router = useRouter();
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Card className="border-0 shadow-sm max-w-md w-full">
        <CardContent className="py-12 text-center">
          <ShieldAlert className="w-12 h-12 mx-auto mb-4 text-warning" />
          <h2 className="text-lg font-semibold text-foreground mb-2">Access restricted</h2>
          <p className="text-sm text-foreground-secondary mb-6">
            Your role doesn&apos;t have permission to view this page.
            {` `}Taking you back to the dashboard…
          </p>
          <Button variant="outline" onClick={() => router.replace("/dashboard")}>
            Go to Dashboard now
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function RouteGuard({ pathname, children }) {
  const requiredRoles = getRequiredRolesForPath(pathname);
  const { authorized, loading } = useRequireRole();

  // Open paths render immediately — no blank flash while the session loads.
  if (requiredRoles.includes("*")) return <>{children}</>;
  if (loading) return null;
  // Explain a denial instead of rendering a silent void while the redirect
  // in useRequireRole fires.
  if (!authorized) return <AccessRestrictedPanel />;
  return <>{children}</>;
}

export function DashboardLayout({ children }) {
  const { collapsed, peek } = useSidebar();
  const pathname = usePathname();

  if (authRoutes.includes(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <TopNav />
      {/* Sidebar carries `peer`, so the collapsed rail's hover-peek shifts this
          padding in CSS — no hover state in React, no re-render on mouse move.
          Without it the expanded rail (z-40, fixed) paints over the content. */}
      <main
        className={cn(
          "pt-16 min-h-screen transition-all duration-300",
          collapsed ? "pl-[72px]" : "pl-60",
          collapsed && peek && "peer-hover:pl-60"
        )}
      >
        <div className="p-6">
          <ErrorBoundary>
            <RouteGuard pathname={pathname}>{children}</RouteGuard>
          </ErrorBoundary>
        </div>
      </main>
      <CommandPalette />
    </div>
  );
}
