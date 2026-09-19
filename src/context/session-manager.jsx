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
  IDLE_TIMEOUT_SECONDS,
  WEB_SESSION_TTL_SECONDS,
  IDLE_WARNING_SECONDS,
  ABSOLUTE_WARNING_SECONDS,
  ACTIVITY_HEARTBEAT_INTERVAL_SECONDS,
  ACTIVITY_HEARTBEAT_MIN_GAP_SECONDS,
} from "@/lib/auth/session-policy";
import {
  subscribeSessionEvents,
  dispatchSessionAuthError,
  broadcastSessionExtended,
  broadcastSessionLogout,
} from "@/lib/auth/session-bus";
import { SessionTimeoutDialog } from "@/components/auth/session-timeout-dialog";

// Derived from the shared policy module, never hand-written here. These used to
// be independent 5-minute literals, which silently collided once the idle
// timeout itself was reduced to 5 minutes: the warning window became the entire
// timeout window and the modal never dismissed.
const IDLE_WARNING_MS = IDLE_WARNING_SECONDS * 1000;
const ABSOLUTE_WARNING_MS = ABSOLUTE_WARNING_SECONDS * 1000;
const ACTIVITY_HEARTBEAT_INTERVAL_MS = ACTIVITY_HEARTBEAT_INTERVAL_SECONDS * 1000;
const ACTIVITY_HEARTBEAT_MIN_GAP_MS = ACTIVITY_HEARTBEAT_MIN_GAP_SECONDS * 1000;

const SessionManagerContext = createContext({
  modalState: null,
  idleExpiresAt: null,
  absoluteExpiresAt: null,
  staySignedIn: async () => {},
});

function isAppApiRequest(input) {
  try {
    let urlStr = "";
    if (typeof input === "string") {
      urlStr = input;
    } else if (input instanceof URL) {
      urlStr = input.href;
    } else if (input && typeof input === "object" && "url" in input) {
      urlStr = input.url;
    }
    if (!urlStr) return false;
    // Exclude Next.js internals and auth flow endpoints (except user profile)
    if (
      urlStr.includes("/_next/") ||
      (urlStr.includes("/api/auth/") && !urlStr.includes("/api/auth/profile"))
    ) {
      return false;
    }
    // Match relative or same-origin API routes
    if (urlStr.startsWith("/api/")) return true;
    if (typeof window !== "undefined" && urlStr.startsWith(window.location.origin + "/api/")) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

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
  // Serializes heartbeat POSTs and enforces the minimum spacing between them.
  const inFlightRef = useRef(false);
  const lastSlideRef = useRef(0);

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

  /**
   * Reads the authoritative deadlines without touching them.
   *
   * A 401 here means the session is already gone — surface it as the expired
   * modal instead of waiting for the next background poll to fail. With a
   * short idle timeout this path fires often (a tab returning from a long
   * hide), and silently swallowing it would strand the user on a dead page.
   */
  const syncSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/heartbeat", { cache: "no-store" });
      if (res.status === 401) {
        const data = await res.json().catch(() => ({}));
        triggerExpired(data?.code || "SESSION_EXPIRED");
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      if (data?.expiresAt && data?.idleExpiresAt) {
        setAbsoluteExpiresAt(new Date(data.expiresAt).getTime());
        setIdleExpiresAt(new Date(data.idleExpiresAt).getTime());
      }
    } catch {
      // Network blip; the next tick or visibility change will re-sync.
    }
  }, [triggerExpired]);

  /**
   * Slides the idle deadline. This is the ONLY thing that may move
   * `last_seen_at` — the server no longer auto-slides on arbitrary API
   * traffic, so a session stays alive exactly as long as someone is at the
   * keyboard or clicks "Stay signed in".
   *
   * `force` bypasses the minimum-gap throttle for an explicit user action.
   * Returns true when the deadline actually moved.
   */
  const extendSession = useCallback(async ({ force = false } = {}) => {
    if (inFlightRef.current) return false;
    if (!force && Date.now() - lastSlideRef.current < ACTIVITY_HEARTBEAT_MIN_GAP_MS) {
      return false;
    }
    inFlightRef.current = true;
    try {
      const res = await fetch("/api/auth/heartbeat", { method: "POST", cache: "no-store" });
      if (res.status === 401) {
        const data = await res.json().catch(() => ({}));
        triggerExpired(data?.code || "SESSION_EXPIRED");
        return false;
      }
      if (!res.ok) return false;
      const data = await res.json();
      lastSlideRef.current = Date.now();
      hasUserBeenActiveRef.current = false;
      if (data?.idleExpiresAt) {
        setIdleExpiresAt(new Date(data.idleExpiresAt).getTime());
        setModalState((cur) =>
          cur === "idle_warning" ||
          cur === "warning" ||
          cur === "critical" ||
          cur === "extension-error" ||
          cur === "extending"
            ? null
            : cur
        );
        setSuppressAuthToasts(false);
        broadcastSessionExtended(data.idleExpiresAt);
      }
      return true;
    } catch {
      // Network blip; will retry on the next activity or tick.
      return false;
    } finally {
      inFlightRef.current = false;
    }
  }, [triggerExpired]);

  // 1. Global window.fetch 401 interceptor (scoped to app API routes)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const originalFetch = window.fetch;

    if (window.__fleetops_fetch_intercepted) return;
    window.__fleetops_fetch_intercepted = true;

    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this || window, args);
      if (response.status === 401 && isAppApiRequest(args[0])) {
        // Intercept 401 without consuming response body stream for the original caller
        try {
          const cloned = response.clone();
          cloned
            .text()
            .then((text) => {
              if (!text || !text.trim()) {
                dispatchSessionAuthError("SESSION_INVALID", "Unauthorized");
                return;
              }
              let data = null;
              try {
                data = JSON.parse(text);
              } catch {}
              dispatchSessionAuthError(data?.code || "SESSION_INVALID", data?.error || "Unauthorized");
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
      delete window.__fleetops_fetch_intercepted;
    };
  }, []);

  // 2. Track human interactions (mouse clicks, keyboard typing, touch) and slide
  // the deadline promptly. Background polling (React Query, dispatch intervals)
  // does NOT trigger these — so polling can no longer keep a session alive.
  // extendSession() applies the minimum-gap throttle, so this is one write per
  // window no matter how fast the user types.
  useEffect(() => {
    if (!user || typeof window === "undefined") return;

    const onHumanActivity = () => {
      hasUserBeenActiveRef.current = true;
      void extendSession();
    };

    const events = ["click", "keydown", "touchstart", "pointerdown"];
    events.forEach((evt) => window.addEventListener(evt, onHumanActivity, { passive: true }));

    return () => {
      events.forEach((evt) => window.removeEventListener(evt, onHumanActivity));
    };
  }, [user, extendSession]);

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
          // If this tab was in warning/critical, dismiss it now that user confirmed in another tab
          setModalState((cur) =>
            cur === "idle_warning" ||
            cur === "warning" ||
            cur === "critical" ||
            cur === "extension-error" ||
            cur === "extending"
              ? null
              : cur
          );
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
    if (!user) return;
    // The set-state-in-effect rule assumes a synchronous setState, but
    // syncSession's first statement is `await fetch("/api/auth/heartbeat")` and
    // every setState in it runs after that round trip — nothing here renders
    // synchronously, so there is no cascade to protect against. Effects 5 and 6
    // call the same function from a handler and an interval and are not flagged,
    // which is the same reasoning. Kept in the effect body so the mount sync is
    // immediate rather than deferred a tick.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void syncSession();
  }, [user, syncSession]);

  // 5. Sync on tab visibility change (waking up or switching back to this tab)
  useEffect(() => {
    if (!user || typeof document === "undefined") return;
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void syncSession();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [user, syncSession]);

  // 6. Periodic heartbeat backstop, for the case where DOM activity events are
  // missed entirely. Activity itself slides immediately (effect 2), so this
  // normally finds the flag already cleared and does nothing.
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(() => {
      if (!hasUserBeenActiveRef.current) return;
      void extendSession();
    }, ACTIVITY_HEARTBEAT_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [user, extendSession]);

  // 7. Real-time countdown timer tick (1-second resolution)
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
        const remainingSec = Math.ceil(remainingIdle / 1000);
        setCountdownSeconds(remainingSec);
        setSuppressAuthToasts(true);
        setModalState((cur) => {
          if (cur === "extending" || cur === "extension-error") return cur;
          return remainingSec <= 60 ? "critical" : "warning";
        });
        return;
      }

      // Both timers healthy
      if (
        modalState === "idle_warning" ||
        modalState === "warning" ||
        modalState === "critical" ||
        modalState === "extension-error" ||
        modalState === "extending" ||
        modalState === "absolute_warning"
      ) {
        setModalState(null);
        setSuppressAuthToasts(false);
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [user, idleExpiresAt, absoluteExpiresAt, modalState, triggerExpired]);

  // 8. "Stay signed in" Action Handler. `force` because the user explicitly
  // asked — an explicit click should never be throttled away.
  const handleStaySignedIn = async () => {
    setLoading(true);
    setModalState("extending");
    try {
      const extended = await extendSession({ force: true });
      if (extended) {
        setModalState(null);
        setSuppressAuthToasts(false);
        toast.success("Session extended");
      } else {
        setModalState("extension-error");
      }
    } catch {
      setModalState("extension-error");
    } finally {
      setLoading(false);
    }
  };

  // 9. Sign out action
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

  // 10. Sign in again action (after expired or 12h warning)
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

      <SessionTimeoutDialog
        state={modalState === null ? "hidden" : modalState}
        remainingSeconds={countdownSeconds}
        idleExtensionMinutes={Math.round(IDLE_TIMEOUT_SECONDS / 60)}
        absoluteSessionLimitHours={Math.round(WEB_SESSION_TTL_SECONDS / 3600)}
        errorCode={errorCode}
        isAbsoluteWarning={modalState === "absolute_warning"}
        onExtendSession={handleStaySignedIn}
        onSignOut={handleSignOut}
        onSignInAgain={handleSignInAgain}
        onClose={modalState === "expired" ? undefined : handleStaySignedIn}
      />
    </SessionManagerContext.Provider>
  );
}

export function useSessionManager() {
  return useContext(SessionManagerContext);
}
