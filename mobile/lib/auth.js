import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { apiFetch, setSessionExpiredHandler } from "./api";
import { decodeJwtRole } from "./rbac";
import { DEMO_ENABLED } from "./config";
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
    const driver = { ...data.driver, role: decodeJwtRole(data.accessToken) || "driver" };
    await saveUser(driver);
    setUser(driver);
    return driver;
  }, []);

  const signInDriverDemo = useCallback(async () => {
    // Demo sessions only exist when the build was made with
    // EXPO_PUBLIC_ENABLE_DEMO=true; refuse otherwise so a stray caller can't
    // fabricate a session in a production build.
    if (!DEMO_ENABLED) {
      throw new Error("Demo sign-in is disabled in this build.");
    }
    const demoDriver = {
      id: "driver-demo-001",
      first_name: "John",
      last_name: "Doe",
      email: "john.driver@fleetops.com",
      phone: "+1 555-0188",
      license_number: "DL-DRIVER-8844",
      role: "driver",
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
      if (refreshToken && !(DEMO_ENABLED && refreshToken === "mock-driver-refresh-token")) {
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
      value={{ user, loading, signIn, signInDriverDemo, signOut, setUser }}
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
