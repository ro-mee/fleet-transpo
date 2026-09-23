import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useAuth } from "./auth";
import { APP_LOCK_TIMEOUT_MS, initialLocked, noteAppStateChange, shouldLockOnResume } from "./app-lock";
import { BIOMETRIC_STATE } from "./biometric-errors";
import {
  clearEnrollmentForOtherEmployee,
  disable as disableBiometricStore,
  enable as enableBiometricStore,
  getCapability,
  getMeta,
  verifyUnlock,
} from "./biometric";

const AppLockContext = createContext(null);

/**
 * Owns the local application lock.
 *
 * Three things are deliberately kept apart here, and conflating them is the
 * mistake this provider exists to prevent:
 *
 * - **DEVICE AUTHENTICATION** — the OS prompt. We never see the result beyond
 *   a boolean; `biometric.js` holds the only interface to it.
 * - **LOCAL APPLICATION LOCK** — `locked`, owned here. It hides the
 *   authenticated UI and nothing else.
 * - **SERVER SESSION** — untouched by this file. Locking never revokes the
 *   session, never mints a token and never calls the API. `AuthProvider` in
 *   `_layout.js` keeps its own `AppState` listener for offline sync; React
 *   Native supports several, and merging them would risk the existing queue.
 *
 * Locking is OFF unless the driver turned it on, so a driver who never opts in
 * sees exactly the app they saw before.
 */
export function AppLockProvider({ children }) {
  const { user } = useAuth();

  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [veiled, setVeiled] = useState(false);
  const [capability, setCapability] = useState(null);
  const [meta, setMeta] = useState(null);

  // Mirrors `enabled` for the AppState listener, which is subscribed once and
  // would otherwise close over a stale value. Written from an effect rather
  // than during render — assigning a ref mid-render is what `react-hooks/refs`
  // flags, and it would fail `lint:ci` (`--max-warnings 0`). Every reader below
  // is an AppState callback or an event handler, so a one-commit lag is
  // invisible; nothing in render reads it.
  const enabledRef = useRef(false);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const backgroundedAt = useRef(null);
  const appState = useRef(AppState.currentState);
  const hadUser = useRef(false);

  /** Re-reads enrollment metadata and device capability. */
  const refresh = useCallback(async () => {
    const [nextMeta, nextCapability] = await Promise.all([
      getMeta().catch(() => null),
      getCapability().catch(() => null),
    ]);
    setMeta(nextMeta);
    setCapability(nextCapability);
    setEnabled(Boolean(nextMeta));
    return { meta: nextMeta, capability: nextCapability };
  }, []);

  // Cold start: a driver with the lock on must authenticate before any
  // authenticated screen is mounted. This is the gap the feature closes — the
  // session restore in auth.js trusts a locally held token with no check at all.
  useEffect(() => {
    let active = true;
    (async () => {
      const { meta: stored } = await refresh();
      if (!active) return;
      setLocked(initialLocked({ biometricEnabled: Boolean(stored) }));
      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, [refresh]);

  // Background → foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      const previousState = appState.current;
      appState.current = nextAppState;
      const now = Date.now();

      const step = noteAppStateChange({
        previousState,
        nextState: nextAppState,
        backgroundedAt: backgroundedAt.current,
        now,
      });
      backgroundedAt.current = step.backgroundedAt;

      if (nextAppState === "active") {
        setVeiled(false);
        if (step.resumedFrom !== null && enabledRef.current && shouldLockOnResume({ backgroundedAt: step.resumedFrom, now })) {
          setLocked(true);
        }
        return;
      }

      // Only hide the screen when there is a lock to hide behind; with the
      // feature off this must stay invisible, not become a new flicker.
      if (enabledRef.current) setVeiled(true);
    });

    return () => {
      subscription.remove();
    };
  }, []);

  // Sign Out clears biometric storage in auth.js; drop the in-memory state with
  // it so the next driver on a shared phone starts from a clean slate.
  useEffect(() => {
    if (user) {
      hadUser.current = true;
      return;
    }
    if (hadUser.current) {
      hadUser.current = false;
      setEnabled(false);
      setMeta(null);
      setLocked(false);
      setVeiled(false);
    }
  }, [user]);

  /** Hides the authenticated UI immediately, without touching the server session. */
  const lockNow = useCallback(() => {
    if (!enabledRef.current) return false;
    setLocked(true);
    return true;
  }, []);

  /**
   * Runs the OS prompt and, on success, releases the lock.
   *
   * A failure — cancel, mismatch, lockout — leaves the app locked. The only
   * failure that switches biometric login off is the platform telling us the
   * enrollment is gone; a network error never does, because no network call is
   * involved in this path at all.
   */
  const unlock = useCallback(async (options) => {
    const result = await verifyUnlock(options);
    if (result.ok) {
      setLocked(false);
      refresh().catch(() => {});
      return result;
    }
    if (result.state === BIOMETRIC_STATE.CREDENTIAL_INVALIDATED) {
      setEnabled(false);
      setMeta(null);
    }
    return result;
  }, [refresh]);

  /** Enables biometric login and updates lock state in one step. */
  const enable = useCallback(async (identity) => {
    const result = await enableBiometricStore(identity);
    if (result.ok) {
      setMeta(result.meta);
      setEnabled(true);
      setLocked(false);
    }
    await refresh().catch(() => {});
    return result;
  }, [refresh]);

  /** Turns biometric login off. The app stays unlocked; the session is untouched. */
  const disable = useCallback(async () => {
    const result = await disableBiometricStore();
    setMeta(null);
    setEnabled(false);
    setLocked(false);
    setVeiled(false);
    await refresh().catch(() => {});
    return result;
  }, [refresh]);

  /**
   * Drops an enrollment belonging to a different driver after a successful
   * password + OTP sign-in, so driver B is never prompted into driver A's lock.
   */
  const reconcileEnrollment = useCallback(
    async (employeeId) => {
      const cleared = await clearEnrollmentForOtherEmployee(employeeId);
      if (cleared) await refresh().catch(() => {});
      return cleared;
    },
    [refresh]
  );

  const method = meta?.method || capability?.method || null;

  return (
    <AppLockContext.Provider
      value={{
        ready,
        locked,
        veiled,
        enabled,
        meta,
        method,
        capability,
        timeoutMs: APP_LOCK_TIMEOUT_MS,
        lockNow,
        unlock,
        enable,
        disable,
        refresh,
        reconcileEnrollment,
      }}
    >
      {children}
    </AppLockContext.Provider>
  );
}

export function useAppLock() {
  const ctx = useContext(AppLockContext);
  if (!ctx) throw new Error("useAppLock must be used inside AppLockProvider");
  return ctx;
}
