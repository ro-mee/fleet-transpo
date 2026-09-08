/**
 * Centralized connectivity state (PR #3.1).
 *
 * Combines two independent evidences, because a device can report Wi-Fi while
 * the internet — or the FleetOps backend — is effectively unusable:
 *
 *   A. NetInfo reachability (isConnected / isInternetReachable), and
 *   B. real FleetOps API outcomes via the api.js emitter (transport failures
 *      only — 401/403/5xx never count) plus sync-queue state from sync.js.
 *
 * GPS safeguard (locked): `gpsRecording` is true only when the foreground
 * poster is genuinely feeding the CURRENT trip (activeTripId set, no poster
 * error, last post within GPS_POST_FRESH_MS). Offline + no tracking never
 * renders "GPS still recording".
 *
 * Transients (locked): "Back online" means connectivity recovered;
 * "All updates synced" fires only after the queue truly drains to zero.
 * Internet returning and server sync succeeding are different states.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { subscribeApiEvents } from "./api";
import { subscribeSync, getPendingCount, syncQueue } from "./sync";
import { usePosterStatus } from "./tracking";
import {
  createConnectivitySignal,
  recordTransportSuccess,
  recordTransportFailure,
  deriveStatus,
} from "./connectivity-state";

// A post newer than this means the poster is alive and feeding the trip.
const GPS_POST_FRESH_MS = 90 * 1000;
// "All updates synced" lingers this long before the UI goes clean.
const SYNCED_NOTICE_MS = 2500;
// "Back online" with nothing to sync lingers this long.
const RECOVERED_NOTICE_MS = 2000;

const ConnectivityContext = createContext({
  status: "online",
  phase: "steady",
  isConnected: null,
  isInternetReachable: null,
  netinfoAvailable: false,
  pendingCount: 0,
  syncActive: false,
  gpsRecording: false,
  lastSyncedAt: null,
  lastFailureAt: null,
  lastSuccessAt: null,
});

export function useConnectivity() {
  return useContext(ConnectivityContext);
}

export function ConnectivityProvider({ children }) {
  const poster = usePosterStatus();
  const [net, setNet] = useState({ isConnected: null, isInternetReachable: null });
  // Reachability availability is knowable without an effect — no setState needed.
  const [netinfoAvailable] = useState(() => {
    try {
      return !!NetInfo?.addEventListener;
    } catch {
      return false;
    }
  });
  const [signal, setSignal] = useState(() => createConnectivitySignal());
  const [pendingCount, setPendingCount] = useState(0);
  const [syncActive, setSyncActive] = useState(false);
  const [phase, setPhase] = useState("steady"); // steady | recovered | synced
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [lastFailureAt, setLastFailureAt] = useState(null);
  const [lastSuccessAt, setLastSuccessAt] = useState(null);
  const timer = useRef(null);
  const prevStatus = useRef("online");
  const phaseRef = useRef("steady");
  const hadPending = useRef(false);

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => clearTimer, []);

  const setPhaseBoth = (next) => {
    phaseRef.current = next;
    setPhase(next);
  };

  const flashPhase = useCallback((next, ms) => {
    clearTimer();
    setPhaseBoth(next);
    timer.current = setTimeout(() => {
      setPhaseBoth("steady");
      timer.current = null;
    }, ms);
  }, []);

  // ── A. Reachability ──────────────────────────────────────────────────────
  // netinfoAvailable was resolved in state init (no effect setState); here we
  // only subscribe. Without the native module the catch below leaves
  // derivation on API signals alone — never forced offline.
  useEffect(() => {
    let unsubscribe = null;
    try {
      if (!NetInfo?.addEventListener) throw new Error("NetInfo unavailable");
      unsubscribe = NetInfo.addEventListener((state) => {
        setNet({
          isConnected: state.isConnected ?? null,
          isInternetReachable: state.isInternetReachable ?? null,
        });
      });
      NetInfo.fetch()
        .then((state) => {
          setNet({
            isConnected: state.isConnected ?? null,
            isInternetReachable: state.isInternetReachable ?? null,
          });
        })
        .catch(() => {});
    } catch {
      // No reachability API (e.g. a shell without the native module):
      // derivation falls back to API signals only. Never force offline.
    }
    return () => {
      try {
        unsubscribe?.();
      } catch {}
    };
  }, []);

  // ── B. API outcomes ──────────────────────────────────────────────────────
  useEffect(() => {
    return subscribeApiEvents((event) => {
      const now = Date.now();
      if (event?.type === "success") {
        setSignal((s) => recordTransportSuccess(s, now));
        setLastSuccessAt(now);
      } else if (event?.type === "transport-failure") {
        setSignal((s) => recordTransportFailure(s, now));
        setLastFailureAt(now);
      } else if (event?.type === "queued") {
        getPendingCount()
          .then(setPendingCount)
          .catch(() => {});
      }
    });
  }, []);

  // ── C. Queue state ───────────────────────────────────────────────────────
  useEffect(() => {
    getPendingCount()
      .then((n) => {
        setPendingCount(n);
        if (n > 0) hadPending.current = true;
      })
      .catch(() => {});
    return subscribeSync((patch) => {
      if (patch == null) return;
      if (typeof patch.pendingCount === "number") {
        setPendingCount(patch.pendingCount);
        if (patch.pendingCount > 0) hadPending.current = true;
      }
      if (typeof patch.syncActive === "boolean") {
        const was = patch.syncActive;
        setSyncActive(was);
        if (!was) {
          // A drain just finished. "All updates synced" ONLY when the queue
          // truly hit zero — internet returning is not sync succeeding.
          getPendingCount()
            .then((n) => {
              setPendingCount(n);
              if (n === 0) {
                setLastSyncedAt(Date.now());
                if (hadPending.current) {
                  hadPending.current = false;
                  flashPhase("synced", SYNCED_NOTICE_MS);
                }
              }
            })
            .catch(() => {});
        }
      }
    });
  }, [flashPhase]);

  const status = deriveStatus({
    isConnected: net.isConnected,
    isInternetReachable: net.isInternetReachable,
    signal,
    syncActive,
    pendingCount,
  });

  // ── Recovery edges ───────────────────────────────────────────────────────
  const resetPhase = useCallback(() => {
    clearTimer();
    if (phaseRef.current !== "steady") setPhaseBoth("steady");
  }, []);

  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = status;
    const wasDown = prev === "offline" || prev === "unstable";
    const isUp = status === "online" || status === "syncing";
    if (wasDown && isUp && phaseRef.current === "steady") {
      // Connectivity is back. Kick one drain (apiFetch successes already do,
      // but an idle app may have nothing in flight) and show the transient.
      syncQueue().catch(() => {});
      flashPhase("recovered", RECOVERED_NOTICE_MS);
    }
    if (status === "offline" || status === "unstable") {
      resetPhase();
    }
  }, [status, flashPhase, resetPhase]);

  // Foreground reconcile: refresh reachability + queue count without polling.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      try {
        NetInfo?.fetch()
          ?.then((state) => {
            setNet({
              isConnected: state.isConnected ?? null,
              isInternetReachable: state.isInternetReachable ?? null,
            });
          })
          ?.catch(() => {});
      } catch {}
      getPendingCount()
        .then(setPendingCount)
        .catch(() => {});
    });
    return () => sub.remove();
  }, []);

  // GPS safeguard: recording only when the poster is genuinely feeding the
  // current trip right now — never inferred from merely being offline.
  // Resolved in an effect (not render) so no impure clock reads happen
  // during render; updated only when the verdict actually flips.
  const [gpsRecording, setGpsRecording] = useState(false);
  const gpsRef = useRef(false);
  useEffect(() => {
    const fresh =
      poster.lastSentAt != null &&
      Date.now() - new Date(poster.lastSentAt).getTime() < GPS_POST_FRESH_MS;
    const ok = poster.activeTripId != null && poster.error == null && fresh;
    if (gpsRef.current !== ok) {
      gpsRef.current = ok;
      setGpsRecording(ok);
    }
  }, [poster]);

  const value = useMemo(
    () => ({
      status,
      phase,
      isConnected: net.isConnected,
      isInternetReachable: net.isInternetReachable,
      netinfoAvailable,
      pendingCount,
      syncActive,
      gpsRecording,
      lastSyncedAt,
      lastFailureAt,
      lastSuccessAt,
    }),
    [status, phase, net, netinfoAvailable, pendingCount, syncActive, gpsRecording, lastSyncedAt, lastFailureAt, lastSuccessAt]
  );

  return <ConnectivityContext.Provider value={value}>{children}</ConnectivityContext.Provider>;
}
