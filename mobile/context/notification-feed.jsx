/**
 * NotificationFeedProvider — the single live source of the driver's alerts.
 *
 * Polls /api/notifications, keeps a seen-set so historical rows are seeded
 * silently (no flood on mount), and routes each *new* row through tiers.js to
 * its delivery surface:
 *   - push tier     -> heads-up banner + OS local notification (if enabled)
 *   - heads-up tier -> heads-up banner only
 *   - silent tier   -> badge / Alerts tab update only
 *
 * The provider owns polling so the Alerts tab and the home header badge read
 * the same state without duplicate fetches.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { useRouter } from "expo-router";
import { api } from "../lib/api";
import { useSettings } from "../lib/settings-context";
import { notify } from "../lib/notifications/notify";
import { classifyNotification } from "../lib/notifications/tiers";
import { mobileNotificationTarget } from "../lib/notifications/navigation";

const POLL_MS = 30000;

const NotificationFeedContext = createContext(null);

export function NotificationFeedProvider({ children }) {
  const router = useRouter();
  const { settings } = useSettings();
  const pushEnabled = settings.pushNotifications !== false;

  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const seenRef = useRef(new Set());
  const seededRef = useRef(false);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const data = await api.get("/api/notifications");
      const list = Array.isArray(data) ? data : [];
      setNotifications(list);
      if (!seededRef.current) {
        // First load: remember every id, announce nothing.
        seededRef.current = true;
        seenRef.current = new Set(list.map((n) => n.notification_id).filter(Boolean));
        return;
      }
      // Route only genuinely-new rows.
      list.forEach((n) => {
        const id = n.notification_id;
        if (!id || seenRef.current.has(id)) return;
        seenRef.current.add(id);
        const { tier, tone } = classifyNotification(n);
        if (tier === "silent") return;
        const target = mobileNotificationTarget(n);
        const onPress = target ? () => router.push(target) : undefined;
        // With a real push enabled, the OS banner already covers push-tier
        // rows — showing the in-app heads-up too would double-notify. If the
        // server already pushed this row (pushed_at set), skip entirely; the
        // local fallback only covers rows the server could not push (e.g. no
        // device token), where the OS banner never fired.
        if (tier === "push" && pushEnabled) {
          if (n.pushed_at) return;
          notify.push({
            title: n.title,
            body: n.message,
            data: { reference_type: n.reference_type, reference_id: n.reference_id },
          });
          return;
        }
        notify.headsUp({
          title: n.title,
          message: n.message,
          category: n.type,
          tone,
          onPress,
          persist: tone === "critical",
        });
      });
    } catch {
      // Non-critical; the Alerts tab will surface a real error if needed.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router, pushEnabled]);

  // Poll + foreground refresh.
  useEffect(() => {
    // Deferred one tick: poll semantics without sync setState in the effect body.
    const first = setTimeout(() => refresh(true), 0);
    const id = setInterval(() => refresh(true), POLL_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh(true);
    });
    return () => {
      clearTimeout(first);
      clearInterval(id);
      sub.remove();
    };
  }, [refresh]);

  const markRead = useCallback(async (id) => {
    try {
      await api.put(`/api/notifications/${id}/read`);
      setNotifications((prev) =>
        prev.map((n) => (n.notification_id === id ? { ...n, is_read: true } : n))
      );
    } catch {
      /* ignore */
    }
  }, []);

  const markAllRead = useCallback(async () => {
    try {
      await api.put("/api/notifications/read-all");
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch {
      /* ignore */
    }
  }, []);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const value = {
    notifications,
    loading,
    refreshing,
    unreadCount,
    refresh,
    markRead,
    markAllRead,
  };

  return (
    <NotificationFeedContext.Provider value={value}>
      {children}
    </NotificationFeedContext.Provider>
  );
}

export function useNotificationFeed() {
  const ctx = useContext(NotificationFeedContext);
  if (!ctx) {
    throw new Error("useNotificationFeed must be used within a NotificationFeedProvider");
  }
  return ctx;
}