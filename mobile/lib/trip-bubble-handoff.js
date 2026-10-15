const OFFERED_KEY = 'fleetops-trip-bubble-offered-v1';
let workVersion = 0;
export const tripBubbleWorkVersion = () => workVersion;
export function invalidateTripBubbleWork() { return ++workVersion; }

/** Called only after the existing live-tracking readiness check succeeds. */
export async function offerTripBubble({ availability, request, storage, alert, isCurrent }) {
  try {
    const result = await availability();
    if (!isCurrent()) return false;
    if (result.available) return true;
    if (result.reason !== 'permission-denied' || await storage.getItem(OFFERED_KEY)) return false;
    // Save before presenting: Back, replacement and process death are choices too.
    await storage.setItem(OFFERED_KEY, '1');
    if (!isCurrent()) return false;
    return await new Promise(resolve => {
      let decided = false;
      const decline = () => { if (!decided) { decided = true; resolve(false); } };
      alert('Keep FleetOps within reach', 'FleetOps can show a small shortcut while you use Google Maps. Navigation and live tracking still work without it.', [
        { text: 'Not now', style: 'cancel', onPress: decline },
        { text: 'Open Android settings', onPress: async () => {
          if (decided) return;
          decided = true;
          if (!isCurrent()) { resolve(false); return; }
          try { resolve((await request()).granted === true && isCurrent()); } catch { resolve(false); }
        } },
      ], { buttonLayout: 'stacked', onDismiss: decline });
    });
  } catch { return false; }
}

/** Keep Maps ownership after Linking resolves, until the actual foreground return. */
export function createTripBubbleHandoff({ show, hide, availability, request, storage, alert }) {
  let handoff = null;
  let offerVersion = 0;
  let offerCurrent = null;
  let offered = null;
  const clear = (preservePermissionRequest = false) => {
    if (!preservePermissionRequest) ++offerVersion;
    handoff = null;
    // Native hide invalidates queued SHOW before its acknowledgement can settle.
    try { return Promise.resolve(hide({ preservePermissionRequest })).catch(() => {}); } catch { return Promise.resolve(); }
  };
  const maybeShow = token => {
    if (handoff !== token || token.version !== workVersion || !token.launched || !token.left || token.requested || !token.isCurrent()) return;
    token.requested = true;
    try { void Promise.resolve(show(token.tripId)).catch(() => {}); } catch { /* Optional shortcut. */ }
  };
  return {
    async offer(isCurrent) {
      const local = offerVersion, global = workVersion;
      offered = { local, global };
      const current = () => local === offerVersion && global === workVersion && isCurrent();
      offerCurrent = current;
      try {
        const allowed = await offerTripBubble({ availability, request, storage, alert, isCurrent: current });
        return allowed && current();
      }
      finally { if (offerCurrent === current) offerCurrent = null; }
    },
    arm(tripId, isCurrent) {
      if (offered && (offered.local !== offerVersion || offered.global !== workVersion)) return null;
      handoff = { tripId, isCurrent, version: invalidateTripBubbleWork(), launched: false, left: false, requested: false, armedAt: Date.now() };
      return handoff;
    },
    launched(token) { if (token && handoff === token) { token.launched = true; maybeShow(token); } },
    depart() {
      if (handoff && Date.now() - handoff.armedAt <= 5000) { handoff.left = true; maybeShow(handoff); }
    },
    failed(token) { return token && handoff === token ? clear() : Promise.resolve(); },
    cancel() { ++offerVersion; return handoff ? clear() : Promise.resolve(); },
    // Android Settings must finish its own permission recheck before Maps opens.
    returnToApp() { return clear(true); },
    invalidate() { return (handoff && (handoff.version !== workVersion || !handoff.isCurrent())) || (offerCurrent && !offerCurrent()) ? clear() : Promise.resolve(); },
  };
}
