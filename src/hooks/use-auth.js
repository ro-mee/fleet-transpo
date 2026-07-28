"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentEmployee, signOut as authSignOut } from "@/services/auth.service";

const AuthContext = createContext({
  user: null,
  employee: null,
  loading: true,
  signOut: async () => {},
  refreshEmployee: async () => {},
});

const MOCK_USER = {
  id: "dev-admin-id",
  email: "admin@fleetops.com",
  user_metadata: { first_name: "System", last_name: "Admin" },
};

const MOCK_EMPLOYEE = {
  employee_id: 1,
  user_id: "dev-admin-id",
  first_name: "System",
  last_name: "Admin",
  email: "admin@fleetops.com",
  position: "System Administrator",
  status: "Active",
  role_id: 1,
  roles: { role_id: 1, role_name: "system_admin", description: "Full system access" },
  branches: { branch_id: 1, branch_name: "Main Office" },
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(MOCK_USER);
  const [employee, setEmployee] = useState(MOCK_EMPLOYEE);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        setUser(session.user);
        const emp = await getCurrentEmployee();
        setEmployee(emp || MOCK_EMPLOYEE);
      } else {
        setUser(MOCK_USER);
        setEmployee(MOCK_EMPLOYEE);
      }
      setLoading(false);
    });

    supabase.auth.getUser().then(async ({ data: { user: currentUser } }) => {
      if (currentUser) {
        setUser(currentUser);
        const emp = await getCurrentEmployee();
        setEmployee(emp || MOCK_EMPLOYEE);
      } else {
        setUser(MOCK_USER);
        setEmployee(MOCK_EMPLOYEE);
      }
      setLoading(false);
    }).catch(() => {
      setUser(MOCK_USER);
      setEmployee(MOCK_EMPLOYEE);
      setLoading(false);
    });

    return () => listener?.subscription.unsubscribe();
  }, [supabase]);

  const signOut = async () => {
    try {
      await authSignOut();
    } catch {
      // ignore
    }
    setUser(MOCK_USER);
    setEmployee(MOCK_EMPLOYEE);
  };

  const refreshEmployee = async () => {
    const emp = await getCurrentEmployee();
    setEmployee(emp || MOCK_EMPLOYEE);
  };

  return (
    <AuthContext.Provider value={{ user, employee, loading, signOut, refreshEmployee }}>
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
