import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { apiFetch, setSessionExpiredHandler } from "./api";
import { saveTokens, saveUser, getUser, getAccessToken, getRefreshToken, clearAll } from "./storage";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore the session from secure storage on cold start.
  useEffect(() => {
    (async () => {
      try {
        const [token, stored] = await Promise.all([getAccessToken(), getUser()]);
        if (token && stored) setUser(stored);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // When a refresh fails there is no recovering the session; drop the user so
  // the guard in app/(app)/_layout.js redirects to login.
  useEffect(() => {
    setSessionExpiredHandler(() => setUser(null));
  }, []);

  const signIn = useCallback(async (email, password) => {
    const data = await apiFetch("/api/mobile/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
      skipAuth: true,
    });

    await saveTokens({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    });
    await saveUser(data.driver);
    setUser(data.driver);
    return data.driver;
  }, []);

  const signInGuest = useCallback(async () => {
    const guestDriver = {
      id: "guest-driver-001",
      first_name: "Guest",
      last_name: "User",
      email: "guest@fleetops.com",
      phone: "+1 555-0199",
      license_number: "DL-GUEST-2026",
      isGuest: true,
    };
    await saveTokens({
      accessToken: "mock-guest-access-token",
      refreshToken: "mock-guest-refresh-token",
    });
    await saveUser(guestDriver);
    setUser(guestDriver);
    return guestDriver;
  }, []);

  const signInDriverDemo = useCallback(async () => {
    const demoDriver = {
      id: "driver-demo-001",
      first_name: "John",
      last_name: "Doe",
      email: "john.driver@fleetops.com",
      phone: "+1 555-0188",
      license_number: "DL-DRIVER-8844",
      isGuest: false,
      isDemoDriver: true,
    };
    await saveTokens({
      accessToken: "mock-driver-access-token",
      refreshToken: "mock-driver-refresh-token",
    });
    await saveUser(demoDriver);
    setUser(demoDriver);
    return demoDriver;
  }, []);

  const signOut = useCallback(async () => {
    const refreshToken = await getRefreshToken();
    try {
      if (
        refreshToken &&
        refreshToken !== "mock-guest-refresh-token" &&
        refreshToken !== "mock-driver-refresh-token"
      ) {
        await apiFetch("/api/mobile/auth/logout", {
          method: "POST",
          body: JSON.stringify({ refreshToken }),
          skipAuth: true,
        });
      }
    } catch {
      // ignored
    }
    await clearAll();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, signIn, signInGuest, signInDriverDemo, signOut, setUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
