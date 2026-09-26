"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "next-auth/react";
import { AuthProvider } from "@/hooks/use-auth";
import { ThemeProvider } from "@/hooks/use-theme";
import { SidebarProvider } from "@/hooks/use-sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toast";
import { SessionManagerProvider } from "@/context/session-manager";
import { useState } from "react";

export function Providers({ children }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            retry: (failureCount, error) => {
              if (
                error?.status === 401 ||
                error?.status === 403 ||
                error?.code?.startsWith("SESSION_") ||
                error?.message?.includes("401") ||
                error?.message?.includes("Unauthorized")
              ) {
                return false;
              }
              return failureCount < 1;
            },
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {/* `refetchOnWindowFocus` defaults to true in next-auth v4, and its
          `_getSession` runs on every `visibilitychange` -> visible — i.e. every
          time the operator tabs away and back. That refetch is not just
          redundant here, it is destructive: `getSession()` resolves to `null`
          on ANY fetch failure, and the provider writes that null straight into
          state (`next-auth/react/index.js`, `setSession(await getSession())`),
          which is indistinguishable from a real logout. The app then unmounts
          the whole authenticated tree (`dashboard-layout.jsx` -> `RouteGuard`'s
          `if (!employee) return null`) and `useRequireRole` redirects to
          /login.

          The unmount is what costs work rather than time: whatever a form was
          holding at that moment goes with it. A dev-server recompile returning
          HTML for the in-flight session fetch is enough to trigger it, and so is
          a dropped connection.

          Written 2026-09-27 while tracing a dropped address pin, and it named
          that pin as its consequence. The attribution was **wrong**: the pin was
          lost to a form-submit bug in `AddressFormDialog` (see Bugs.md,
          2026-09-27), not to an unmount. Only the mechanism above is claimed —
          the change is kept on that, not on the story it was written with.

          Nothing is lost by turning it off: the session is re-checked on tab
          focus anyway by `SessionManagerProvider`'s `syncSession` ->
          `/api/auth/heartbeat`, which is the better path — it reports *why* the
          session ended (`SESSION_IDLE_TIMEOUT`, `SESSION_REVOKED`) and raises
          the expiry modal instead of silently blanking the page. */}
      <SessionProvider refetchOnWindowFocus={false}>
        <ThemeProvider>
          <SidebarProvider>
            <AuthProvider>
              <SessionManagerProvider>
                <TooltipProvider>
                  {children}
                  <Toaster />
                </TooltipProvider>
              </SessionManagerProvider>
            </AuthProvider>
          </SidebarProvider>
        </ThemeProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
