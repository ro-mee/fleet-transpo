"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentEmployee, signOut as authSignOut } from "@/services/auth.service";

const AuthContext = createContext({
  user: null,
  employee: null,
  loading: true,
  signOut: async () => {},
  refreshEmployee: async () => {},
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        const emp = await getCurrentEmployee();
        setEmployee(emp);
      } else {
        setEmployee(null);
      }
      setLoading(false);
    });

    supabase.auth.getUser().then(async ({ data: { user } }) => {
      setUser(user ?? null);
      if (user) {
        const emp = await getCurrentEmployee();
        setEmployee(emp);
      }
      setLoading(false);
    });

    return () => listener?.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await authSignOut();
    setUser(null);
    setEmployee(null);
  };

  const refreshEmployee = async () => {
    const emp = await getCurrentEmployee();
    setEmployee(emp);
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
