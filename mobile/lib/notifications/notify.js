/**
 * Imperative notification API for the mobile app.
 *
 * Mirrors the AppAlert singleton pattern: a module-level emitter that the
 * NotificationHost subscribes to once at the root. Any screen can raise a
 * heads-up banner or a toast without threading props.
 *
 *   notify.toast({ message: "Fuel report submitted", tone: "success" });
 *   notify.headsUp({ title: "Trip leaves in 5 min", message: "...", category: "Trip" });
 *   notify.push({ title, body, data });   // OS-level local notification
 *
 * `notify.push` does NOT go through the host: it schedules an OS notification
 * immediately via lib/notifications/push.js, so it surfaces even when the app
 * is in the background.
 */
import { toneForInAppEvent } from "./tiers";

const listeners = new Set();

function emit(event) {
  listeners.forEach((fn) => {
    try {
      fn(event);
    } catch (e) {
      console.warn("[notify] listener error", e);
    }
  });
}

/** Host-only: register the single renderer. Returns an unsubscribe fn. */
export function subscribeNotificationHost(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const notify = {
  /**
   * In-app confirmation / informational feedback. Small, auto-dismissed,
   * bottom of the screen.
   */
  toast({ message, title, tone = "info", duration }) {
    emit({ type: "toast", payload: { message, title, tone, duration } });
  },

  /**
   * Urgent / time-sensitive in-app banner across the top of the current screen.
   * `kind` maps to a tone (sos / critical / warning / success / info); pass an
   * explicit `tone` to override. `target` is a mobile route to deep-link.
   */
  headsUp({ title, message, category, kind, tone, target, onPress, persist }) {
    emit({
      type: "headsUp",
      payload: {
        title,
        message,
        category,
        tone: tone || toneForInAppEvent(kind),
        target,
        onPress,
        persist,
      },
    });
  },

  /**
   * OS-level local notification. Fires immediately even when the app is
   * foregrounded or backgrounded. `data.reference_type` / `data.reference_id`
   * drive the deep-link on tap (mobileNotificationTarget).
   */
  push({ title, body, data = {} }) {
    // Lazy import so importing `notify` never pulls in the native module.
    import("./push").then(({ showLocalNotification }) =>
      showLocalNotification({ title, body, data })
    );
  },
};