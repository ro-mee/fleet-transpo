import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { apiFetch, setSessionExpiredHandler } from "./api";
import { decodeJwtRole } from "./rbac";
import { saveTokens, saveUser, getUser, getAccessToken, getRefreshToken, clearAll } from "./storage";
import { registerDeviceToken, unregisterDeviceToken } from "./notifications/device-token";

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
      } catch {
        // ignored
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

  const signIn = useCallback(async (email, password, { mfaCode = "" } = {}) => {
    const data = await apiFetch("/api/mobile/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, totpCode: mfaCode }),
      skipAuth: true,
    });

    await saveTokens({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    });
    const driver = { ...data.driver, role: decodeJwtRole(data.accessToken) || "driver" };
    await saveUser(driver);
    setUser(driver);
    // Best-effort push registration — never block a successful login on it.
    registerDeviceToken();
    return driver;
  }, []);

  const signOut = useCallback(async ({ allDevices = false } = {}) => {
    const refreshToken = await getRefreshToken();
    try {
      if (refreshToken) {
        await apiFetch("/api/mobile/auth/logout", {
          method: "POST",
          body: JSON.stringify({ refreshToken, allDevices }),
          skipAuth: true,
        });
      }
    } catch {
      // ignored
    }
    unregisterDeviceToken();
    await clearAll();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, signIn, signOut }}
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
