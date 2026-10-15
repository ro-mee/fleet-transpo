import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { apiFetch, setSessionExpiredHandler } from "./api";
import {
  getUser,
  getAccessToken,
  getRefreshToken,
  clearAll,
  clearLegacyBiometricEnrollment,
} from "./storage";
import { clearOfflineCache, resolveDriverId } from "./offline-cache";
import { registerDeviceTokenIfAuthorized, unregisterDeviceToken } from "./notifications/device-token";
import { setCargoSessionActor, syncCargoDrafts } from "./cargo-sync";
import { cargoApi } from "./cargo-api";
import { completeSignIn, getRestorableSignedInUser } from "./auth-session";
import { hideTripBubble } from './trip-bubble';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore the session from secure storage on cold start.
  useEffect(() => {
    clearLegacyBiometricEnrollment().catch(() => {});
    (async () => {
      try {
        const stored = await getRestorableSignedInUser();
        if (stored) {
          setCargoSessionActor(stored.employeeId ?? null);
          setUser(stored);
          if (!stored.mustChangePassword) registerDeviceTokenIfAuthorized();
        }
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
    setSessionExpiredHandler(() => {
      void hideTripBubble();
      setCargoSessionActor(null);
      setUser(null);
    });
  }, []);

  useEffect(() => {
    const sync = (actorId) => {
      if (actorId != null && AppState.currentState === "active") {
        syncCargoDrafts({ actorId: String(actorId), api: cargoApi }).catch(() => {});
      }
    };
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") sync(user?.employeeId);
    });
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) sync(user?.employeeId);
    });
    if (user?.employeeId != null) sync(user.employeeId);
    return () => {
      appState.remove();
      unsubscribe();
    };
  }, [user?.employeeId]);

  // `otpCode` is the six-digit code emailed to the account, or one of its
  // recovery codes. The second factor is mandatory: the first call for a phone
  // comes back 401 MFA_REQUIRED after the code has been sent, and the caller
  // re-invokes this with the code. Re-invoking with an empty code is also the
  // resend — the server refuses a second send inside its own cooldown.
  const signIn = useCallback(async (email, password, { otpCode = "" } = {}) => {
    void hideTripBubble();
    const data = await apiFetch("/api/mobile/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, otpCode }),
      skipAuth: true,
    });

    const driver = await completeSignIn(data, setUser);
    // Non-prompting push registration — only registers if permission was already granted previously.
    if (!driver.mustChangePassword) registerDeviceTokenIfAuthorized();
    return driver;
  }, []);

  const signOut = useCallback(async ({ allDevices = false } = {}) => {
    void hideTripBubble();
    // Fence cargo work before awaiting logout so no in-flight account A request
    // can update saved state or continue into a later account B session.
    setCargoSessionActor(null);
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
    // Offline Read Mode: remember WHO is signing out first (stored user —
    // the state closure here is stale by design of useCallback([])), wipe
    // their cached reads, then delete auth storage — driver B on a shared
    // phone must never see driver A's cached trips.
    const stored = await getUser().catch(() => null);
    await clearOfflineCache(resolveDriverId(stored));
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
