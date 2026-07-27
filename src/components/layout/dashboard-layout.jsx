"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar, TopNav } from "@/components/layout/app-shell";
import { ErrorBoundary } from "@/components/error-boundary";
import { cn } from "@/lib/utils";

const authRoutes = ["/login", "/register", "/forgot-password", "/reset-password"];

export function DashboardLayout({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  if (authRoutes.includes(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />
      <TopNav collapsed={collapsed} />
      <main
        className={cn(
          "pt-16 min-h-screen transition-all duration-300",
          collapsed ? "pl-[72px]" : "pl-64"
        )}
      >
        <div className="p-6">
          <ErrorBoundary>{children}</ErrorBoundary>
        </div>
      </main>
    </div>
  );
}
