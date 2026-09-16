"use client";

import { createContext, useContext, useMemo } from "react";
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

  const user = session?.user || null;
  const employee = useMemo(
    () => mapSessionToEmployee(session, profile),
    [session, profile]
  );
  const loading = status === "loading";

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
