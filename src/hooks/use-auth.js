"use client";

import { createContext, useContext } from "react";
import { useSession, signOut as nextAuthSignOut } from "next-auth/react";

function mapSessionToEmployee(session) {
  if (!session?.user) return null;
  const u = session.user;
  return {
    employee_id: u.employeeId,
    user_id: u.employeeId,
    first_name: u.firstName,
    last_name: u.lastName,
    email: u.email,
    position: u.position,
    status: "Active",
    role_id: null,
    roles: { role_id: null, role_name: u.role, description: "" },
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

  const user = session?.user || null;
  const employee = mapSessionToEmployee(session);
  const loading = status === "loading";

  const handleSignOut = async () => {
    await nextAuthSignOut({ callbackUrl: "/login" });
  };

  const refreshEmployee = async () => {
    await update();
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
