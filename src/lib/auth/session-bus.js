/**
 * FleetOps cross-tab and client-side session communication bus.
 * Coordinates session expiration, idle warnings, and multi-tab state sync.
 */

const listeners = new Set();
let broadcastChannel = null;

if (typeof window !== "undefined" && "BroadcastChannel" in window) {
  try {
    broadcastChannel = new BroadcastChannel("fleetops_session_bus");
    broadcastChannel.onmessage = (event) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      listeners.forEach((fn) => {
        try {
          fn(data, true /* fromOtherTab */);
        } catch (err) {
          console.error("Session bus listener error:", err);
        }
      });
    };
  } catch (err) {
    console.warn("BroadcastChannel initialization failed:", err);
  }
}

/**
 * Subscribes a listener to session events.
 * @param {Function} callback (event, fromOtherTab) => void
 * @returns {Function} unsubscribe
 */
export function subscribeSessionEvents(callback) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/**
 * Dispatches an auth failure event locally and across other open tabs.
 */
export function dispatchSessionAuthError(code = "SESSION_EXPIRED", message = "") {
  const event = {
    type: "AUTH_FAILURE",
    code,
    message: message || "Your session has expired.",
    timestamp: Date.now(),
  };

  // Broadcast to other tabs
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage(event);
    } catch {
      // Ignore serialization or channel closing errors
    }
  }

  // Notify local subscribers
  listeners.forEach((fn) => {
    try {
      fn(event, false);
    } catch (err) {
      console.error("Session bus listener error:", err);
    }
  });
}

/**
 * Broadcasts a successful session extension or reset to other tabs.
 */
export function broadcastSessionExtended(idleExpiresAt) {
  const event = {
    type: "SESSION_EXTENDED",
    idleExpiresAt,
    timestamp: Date.now(),
  };

  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage(event);
    } catch {}
  }

  listeners.forEach((fn) => {
    try {
      fn(event, false);
    } catch {}
  });
}

/**
 * Broadcasts explicit user logout to other tabs so they sign out immediately.
 */
export function broadcastSessionLogout() {
  const event = {
    type: "SESSION_LOGOUT",
    timestamp: Date.now(),
  };

  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage(event);
    } catch {}
  }

  listeners.forEach((fn) => {
    try {
      fn(event, false);
    } catch {}
  });
}
