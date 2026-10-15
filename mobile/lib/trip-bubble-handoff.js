const OFFERED_KEY = 'fleetops-trip-bubble-offered-v1';

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
  const clear = () => {
    handoff = null;
    // Native hide invalidates queued SHOW before its acknowledgement can settle.
    try { return Promise.resolve(hide()).catch(() => {}); } catch { return Promise.resolve(); }
  };
  const maybeShow = token => {
    if (handoff !== token || !token.launched || !token.left || token.requested || !token.isCurrent()) return;
    token.requested = true;
    try { void Promise.resolve(show(token.tripId)).catch(() => {}); } catch { /* Optional shortcut. */ }
  };
  return {
    offer(isCurrent) { return offerTripBubble({ availability, request, storage, alert, isCurrent }); },
    arm(tripId, isCurrent) {
      handoff = { tripId, isCurrent, launched: false, left: false, requested: false, armedAt: Date.now() };
      return handoff;
    },
    launched(token) { if (token && handoff === token) { token.launched = true; maybeShow(token); } },
    depart() {
      if (handoff && Date.now() - handoff.armedAt <= 5000) { handoff.left = true; maybeShow(handoff); }
    },
    failed(token) { return token && handoff === token ? clear() : Promise.resolve(); },
    cancel() { return handoff ? clear() : Promise.resolve(); },
    returnToApp: clear,
    invalidate() { return handoff && !handoff.isCurrent() ? clear() : Promise.resolve(); },
  };
}
