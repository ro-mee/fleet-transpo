"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { useAuth } from "@/hooks/use-auth";
import { signOut as nextAuthSignOut } from "next-auth/react";
import { setSuppressAuthToasts, toast } from "@/components/ui/toast";
import { saveReturnTo } from "@/lib/auth/return-to";
import {
  subscribeSessionEvents,
  dispatchSessionAuthError,
  broadcastSessionExtended,
  broadcastSessionLogout,
} from "@/lib/auth/session-bus";
import { SessionExpiryModal } from "@/components/auth/session-expiry-modal";

const IDLE_WARNING_MS = 5 * 60 * 1000; // 5 minutes before idle expiry
const ABSOLUTE_WARNING_MS = 5 * 60 * 1000; // 5 minutes before absolute expiry
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5-minute activity check interval

const SessionManagerContext = createContext({
  modalState: null,
  idleExpiresAt: null,
  absoluteExpiresAt: null,
  staySignedIn: async () => {},
});

export function SessionManagerProvider({ children }) {
  const { user } = useAuth();

  // Deadlines in ms epoch
  const [idleExpiresAt, setIdleExpiresAt] = useState(null);
  const [absoluteExpiresAt, setAbsoluteExpiresAt] = useState(null);

  // Modal display: null | "idle_warning" | "absolute_warning" | "expired"
  const [modalState, setModalState] = useState(null);
  const [countdownSeconds, setCountdownSeconds] = useState(0);
  const [errorCode, setErrorCode] = useState(null);
  const [loading, setLoading] = useState(false);

  // Activity tracking — pure DOM events only. No network/polling contamination!
  const hasUserBeenActiveRef = useRef(false);
  const isExpiredRef = useRef(false);

  // Sync state ref to avoid stale closures in listeners
  useEffect(() => {
    isExpiredRef.current = modalState === "expired";
  }, [modalState]);

  // Transition to expired state cleanly and suppress toasts
  const triggerExpired = useCallback((code = "SESSION_EXPIRED") => {
    if (isExpiredRef.current) return;
    isExpiredRef.current = true;
    setSuppressAuthToasts(true);
    toast.clear();
    saveReturnTo();
    setErrorCode(code);
    setModalState("expired");
  }, []);

  // 1. Global window.fetch 401 interceptor
  useEffect(() => {
    if (typeof window === "undefined") return;
    const originalFetch = window.fetch;

    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      if (response.status === 401) {
        // Intercept 401 without consuming response body stream for the original caller
        try {
          const cloned = response.clone();
          cloned
            .json()
            .then((data) => {
              dispatchSessionAuthError(data?.code || "SESSION_INVALID", data?.error);
            })
            .catch(() => {
              dispatchSessionAuthError("SESSION_INVALID", "Unauthorized");
            });
        } catch {
          dispatchSessionAuthError("SESSION_INVALID", "Unauthorized");
        }
      }
      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  // 2. Track human interactions (mouse clicks, keyboard typing, touch).
  // Background polling (React Query, dispatch intervals) does NOT trigger these!
  useEffect(() => {
    if (!user || typeof window === "undefined") return;

    const onHumanActivity = () => {
      hasUserBeenActiveRef.current = true;
    };

    const events = ["click", "keydown", "touchstart", "pointerdown"];
    events.forEach((evt) => window.addEventListener(evt, onHumanActivity, { passive: true }));

    return () => {
      events.forEach((evt) => window.removeEventListener(evt, onHumanActivity));
    };
  }, [user]);

  // 3. Subscribe to Session Bus (handles local 401s + BroadcastChannel events from other tabs)
  useEffect(() => {
    if (!user) return;

    const unsubscribe = subscribeSessionEvents((event) => {
      if (event.type === "AUTH_FAILURE") {
        triggerExpired(event.code);
      } else if (event.type === "SESSION_EXTENDED") {
        if (event.idleExpiresAt) {
          const newIdleEpoch = new Date(event.idleExpiresAt).getTime();
          setIdleExpiresAt(newIdleEpoch);
          // If this tab was in idle warning, dismiss it now that user confirmed in another tab
          setModalState((cur) => (cur === "idle_warning" ? null : cur));
          setSuppressAuthToasts(false);
        }
      } else if (event.type === "SESSION_LOGOUT") {
        // Another tab logged out; log out this tab immediately
        setSuppressAuthToasts(true);
        nextAuthSignOut({ callbackUrl: "/login" });
      }
    });

    return unsubscribe;
  }, [user, triggerExpired]);

  // 4. Initial server sync on mount (read authoritative timestamps)
  useEffect(() => {
    let active = true;
    if (!user) return;

    fetch("/api/auth/heartbeat", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return;
        if (data?.expiresAt && data?.idleExpiresAt) {
          setAbsoluteExpiresAt(new Date(data.expiresAt).getTime());
          setIdleExpiresAt(new Date(data.idleExpiresAt).getTime());
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [user]);

  // Sync on tab visibility change (waking up or switching back to this tab)
  useEffect(() => {
    if (!user || typeof document === "undefined") return;
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetch("/api/auth/heartbeat", { cache: "no-store" })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data?.expiresAt && data?.idleExpiresAt) {
              setAbsoluteExpiresAt(new Date(data.expiresAt).getTime());
              setIdleExpiresAt(new Date(data.idleExpiresAt).getTime());
            }
          })
          .catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [user]);

  // 5. Periodic Heartbeat (every 5 min): updates last_seen_at ONLY if user was human-active
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(async () => {
      if (!hasUserBeenActiveRef.current) {
        // User was away from keyboard during this 5-minute bucket; do not ping DB.
        return;
      }
      try {
        const res = await fetch("/api/auth/heartbeat", { method: "POST", cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          hasUserBeenActiveRef.current = false;
          if (data?.idleExpiresAt) {
            const newIdleEpoch = new Date(data.idleExpiresAt).getTime();
            setIdleExpiresAt(newIdleEpoch);
            broadcastSessionExtended(data.idleExpiresAt);
          }
        }
      } catch {
        // Network blip; will retry on next tick or on user action
      }
    }, HEARTBEAT_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [user]);

  // 6. Real-time countdown timer tick (1-second resolution)
  useEffect(() => {
    if (!user || !idleExpiresAt || !absoluteExpiresAt) return;

    const tick = () => {
      if (isExpiredRef.current) return;

      const now = Date.now();
      const remainingAbsolute = absoluteExpiresAt - now;
      const remainingIdle = idleExpiresAt - now;

      // Absolute expiration is the hard maximum — never bypassed
      if (remainingAbsolute <= 0) {
        triggerExpired("SESSION_EXPIRED");
        return;
      }

      // Idle expiration
      if (remainingIdle <= 0) {
        triggerExpired("SESSION_IDLE_TIMEOUT");
        return;
      }

      // Check absolute warning threshold
      if (remainingAbsolute <= ABSOLUTE_WARNING_MS) {
        setModalState("absolute_warning");
        setCountdownSeconds(Math.ceil(remainingAbsolute / 1000));
        setSuppressAuthToasts(true);
        return;
      }

      // Check idle warning threshold
      if (remainingIdle <= IDLE_WARNING_MS) {
        setModalState("idle_warning");
        setCountdownSeconds(Math.ceil(remainingIdle / 1000));
        setSuppressAuthToasts(true);
        return;
      }

      // Both timers healthy
      if (modalState === "idle_warning" || modalState === "absolute_warning") {
        setModalState(null);
        setSuppressAuthToasts(false);
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [user, idleExpiresAt, absoluteExpiresAt, modalState, triggerExpired]);

  // 7. "Stay signed in" Action Handler
  const handleStaySignedIn = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/heartbeat", { method: "POST", cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        hasUserBeenActiveRef.current = false;
        if (data?.idleExpiresAt) {
          const newIdleEpoch = new Date(data.idleExpiresAt).getTime();
          setIdleExpiresAt(newIdleEpoch);
          setModalState(null);
          setSuppressAuthToasts(false);
          broadcastSessionExtended(data.idleExpiresAt);
        }
      } else if (res.status === 401) {
        const data = await res.json().catch(() => ({}));
        triggerExpired(data?.code || "SESSION_EXPIRED");
      }
    } catch {
      // If network fails, retry or fall back
    } finally {
      setLoading(false);
    }
  };

  // 8. Sign out action
  const handleSignOut = async () => {
    setLoading(true);
    try {
      broadcastSessionLogout();
      setSuppressAuthToasts(true);
      if (typeof window !== "undefined") {
        localStorage.clear();
        sessionStorage.clear();
      }
      await nextAuthSignOut({ callbackUrl: "/login" });
    } catch {
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
    } finally {
      setLoading(false);
    }
  };

  // 9. Sign in again action (after expired or 12h warning)
  const handleSignInAgain = async () => {
    setLoading(true);
    try {
      saveReturnTo();
      setSuppressAuthToasts(true);
      await nextAuthSignOut({ redirect: false });
    } catch {
      // Proceed to login
    } finally {
      if (typeof window !== "undefined") {
        window.location.href = "/login?reason=expired";
      }
    }
  };

  return (
    <SessionManagerContext.Provider
      value={{
        modalState,
        idleExpiresAt,
        absoluteExpiresAt,
        staySignedIn: handleStaySignedIn,
      }}
    >
      {children}

      <SessionExpiryModal
        isOpen={modalState !== null}
        state={modalState}
        countdownSeconds={countdownSeconds}
        errorCode={errorCode}
        onStaySignedIn={handleStaySignedIn}
        onSignOut={handleSignOut}
        onSignInAgain={handleSignInAgain}
        loading={loading}
      />
    </SessionManagerContext.Provider>
  );
}

export function useSessionManager() {
  return useContext(SessionManagerContext);
}
