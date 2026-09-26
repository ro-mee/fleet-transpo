"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { useSession, signOut as nextAuthSignOut } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

function mapSessionToEmployee(session, profile) {
  if (!session?.user) return null;
  const u = session.user;
  const photoUrl = profile?.face_image_url || profile?.avatar_url || u.avatarUrl || u.image || null;
  return {
    employee_id: u.employeeId,
    user_id: u.employeeId,
    first_name: profile?.first_name || u.firstName,
    last_name: profile?.last_name || u.lastName,
    email: profile?.email || u.email,
    position: profile?.position || u.position,
    status: profile?.status || u.status || "Active",
    driver_status: profile?.driver_status || u.driverStatus || null,
    avatar_url: photoUrl,
    image_url: photoUrl,
    photo_url: photoUrl,
    role_id: null,
    roles: { role_id: null, role_name: profile?.role || u.role, description: "" },
  };
}

const AuthContext = createContext({
  user: null,
  employee: null,
  loading: true,
  signOut: async () => {},
  refreshEmployee: async () => {},
});

export function AuthProvider({ children }) {
  const { data: session, status, update } = useSession();
  const queryClient = useQueryClient();

  const { data: profile } = useQuery({
    queryKey: ["auth-profile", session?.user?.employeeId],
    queryFn: async () => {
      const res = await fetch("/api/auth/profile");
      if (!res.ok) return null;
      const json = await res.json();
      return json?.data || json;
    },
    enabled: Boolean(session?.user?.employeeId),
    staleTime: 60 * 1000,
  });

  const liveUser = session?.user || null;
  const liveEmployee = useMemo(
    () => mapSessionToEmployee(session, profile),
    [session, profile]
  );
  const loading = status === "loading";

  // A FAILED session fetch is not a logout, but next-auth records it as one.
  // `getSession()` resolves to `null` on any fetch failure — an offline blip, a
  // dropped pooler connection, a dev-server recompile answering with an HTML
  // page instead of JSON — and `SessionProvider` writes that null straight into
  // state (`next-auth/react/index.js`: `setSession(await getSession())`). From
  // here the two are indistinguishable.
  //
  // The cost of believing it was not a blank screen. `employee` going null
  // unmounts the whole authenticated tree (`layout/dashboard-layout.jsx` ->
  // `RouteGuard`'s `if (!employee) return null`) and `useRequireRole` then calls
  // `saveReturnTo()` and redirects to /login. In-progress work died with it.
  //
  // Written 2026-09-27 while tracing a dropped address pin, and it originally
  // named that pin as its consequence. The attribution was **wrong** — the pin
  // was lost to a form-submit bug in `AddressFormDialog` (see Bugs.md,
  // 2026-09-27), not to an unmount — so only the mechanism above is claimed.
  //
  // So the last identity actually seen is kept while the session reads null.
  // Adjusted DURING RENDER rather than in an effect, for the same reason
  // `AddressFormDialog` re-seeds that way: an effect would paint one frame of
  // the logged-out tree before correcting itself, which is the precise unmount
  // this exists to prevent.
  //
  // This bridges the UI, it does not grant access. Every route re-checks the
  // session server-side with `requirePermission`, so a genuinely dead session
  // still gets 401s — and `SessionManagerProvider`'s `syncSession` ->
  // `/api/auth/heartbeat` (mount, tab focus, and its own interval) turns those
  // into the expiry modal, which is where a real logout is supposed to be
  // handled. It is deliberately not cleared by an explicit sign-out: both
  // sign-out paths navigate away, so this provider unmounts with the state.
  const [lastSeen, setLastSeen] = useState(null);
  if (liveEmployee && liveEmployee !== lastSeen?.employee) {
    setLastSeen({ employee: liveEmployee, user: liveUser });
  }

  const user = liveUser ?? lastSeen?.user ?? null;
  const employee = liveEmployee ?? lastSeen?.employee ?? null;

  const handleSignOut = async () => {
    try {
      if (typeof window !== "undefined") {
        localStorage.clear();
        sessionStorage.clear();
      }
      await nextAuthSignOut({ callbackUrl: "/login", redirect: true });
    } catch (e) {
      console.error("Signout error:", e);
    } finally {
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
    }
  };

  const refreshEmployee = async () => {
    await Promise.all([
      update(),
      queryClient.invalidateQueries({ queryKey: ["auth-profile"] }),
      queryClient.invalidateQueries({ queryKey: ["driver-me"] }),
    ]);
  };

  return (
    <AuthContext.Provider value={{ user, employee, loading, signOut: handleSignOut, refreshEmployee }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
