// The driver's duty state for today, in one call — the End Duty nudge and the
// Pre-Shift banner's eligibility both read from here.
//
// WHY ONE HOOK FOR TWO THINGS: they are the same question asked twice. The
// banner must not appear on a rest day or approved leave, and the nudge must not
// appear unless the driver is actually on duty and not mid-trip — and
// GET /api/mobile/driver/duty already computes both from the same row: the
// day's eligibility (`today`) and the live standby session (`checkedIn`,
// `busy`). Two hooks would fetch the same endpoint twice per focus and could
// disagree for a frame.
//
// The client does NOT re-derive eligibility. Leave windows and rest days live in
// src/lib/scheduling/day-eligibility.js and are enforced by setDuty; copying
// those rules into JS here would be a second implementation that drifts, and the
// one the driver sees would be the wrong one. So this asks, and renders the
// answer.
//
// `loaded` means "we have a trustworthy answer", NOT "a request has finished".
// On a transport failure it stays false rather than flipping true with null
// fields: null is indistinguishable from "rest day" / "not checked in", and
// rendering that as fact is the false confidence the flag exists to prevent.
// Both surfaces then render nothing — which costs nothing, because the duty
// toggle is online-only anyway (queueOnFailure: false), so nothing it gates is
// actionable offline.
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { api } from "./api";
import { endDutyWindow } from "./end-duty";

const EMPTY = {
  loaded: false,
  checkedIn: false,
  busy: false,
  preshiftRequired: false,
  today: null,
  // Present from the first render, so the shape never changes under the caller:
  // a screen that reads `duty.unreported` before load gets null, not undefined.
  unreported: null,
};

/**
 * @param {object} [options]
 * @param {number|Date} [options.nowMs] the caller's clock tick, so the nudge
 *   re-evaluates on the screen's own cadence rather than holding a hook-local
 *   interval. Omit it and the window is evaluated once per render.
 */
export function useDuty({ nowMs } = {}) {
  const [state, setState] = useState(EMPTY);
  // The fallback clock for callers that pass no tick. Captured once in a lazy
  // initializer rather than read during render: `Date.now()` in a render body is
  // impure and would make the same props render differently. It then advances on
  // every focus refresh below, which is exactly when a fresh answer matters.
  const [clockMs, setClockMs] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const data = await api.get("/api/mobile/driver/duty");
      setState({
        loaded: true,
        checkedIn: data?.checkedIn === true,
        busy: data?.busy === true,
        preshiftRequired: data?.preshiftRequired === true,
        today: data?.today ?? null,
        // A past day still owing an End Duty report. Non-null only when the
        // server found one within its lookback — see the route's
        // `unreportedDuty`. Forwarded verbatim: this hook decides nothing
        // about it, and Home renders no prompt when it is null.
        unreported: data?.unreported ?? null,
      });
      setClockMs(Date.now());
    } catch {
      // Swallowed on purpose, and `loaded` is deliberately NOT set. See header.
    }
  }, []);

  // On focus, not mount alone: the driver may have started or ended duty on
  // another screen (Profile, or a trip that made them busy) and come back.
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const window = endDutyWindow({ now: nowMs ?? clockMs, shiftEnd: state.today?.duty?.end });

  return {
    ...state,
    minsToEnd: window.minsToEnd,
    // `busy` is the reason this is not a plain clock: a driver on a live trip or
    // answering an incident is not at their out-time, whatever the roster says.
    // Everything is composed here so a screen cannot render the card from the
    // clock alone and prompt someone mid-trip.
    due: state.loaded && state.checkedIn && !state.busy && window.due,
    refresh,
  };
}
