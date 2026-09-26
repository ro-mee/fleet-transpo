// Today's Pre-Shift status for this driver — local calendar day, from the
// newest-first feed.
//
// WHY A HOOK AND NOT INLINE: three surfaces need the same answer (Home banner,
// trip detail gate, trips list) and each would otherwise fetch the same
// endpoint on every focus. One shape keeps "passed" meaning the same thing.
//
// Server remains the trip-start authority; this only drives UI flow.
//
// `loaded` means "we have a trustworthy answer", NOT "a request has finished".
// The difference is load-bearing and is where this departs from the obvious
// implementation: on a transport failure this leaves `loaded` false rather than
// flipping it true with a null status. A null status is indistinguishable from
// "no row today", so flipping it would tell an offline driver their baseline is
// outstanding — for a check they may have completed ten minutes ago — and the
// Home banner would instruct them to redo it. Unknown must stay expressible.
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { api } from "./api";

export function usePreShift() {
  const [state, setState] = useState({ status: null, inspectedAt: null, loaded: false });

  const refresh = useCallback(async () => {
    try {
      const rows = await api.get("/api/mobile/driver/inspections?inspection_type=Pre-Shift");
      const list = Array.isArray(rows) ? rows : [];
      // A Pre-Shift row carries trip_id NULL — that is what makes it shift-wide.
      // The server filters by type, so per-trip Pre-Trip rows cannot arrive
      // here and be mistaken for a baseline.
      const today = new Date().toDateString();
      const row = list.find((r) => r?.created_at && new Date(r.created_at).toDateString() === today);
      setState({ status: row?.status ?? null, inspectedAt: row?.created_at ?? null, loaded: true });
    } catch {
      // Swallowed on purpose, and `loaded` is deliberately NOT set. See header.
    }
  }, []);

  // Refresh on focus, not on mount alone: the driver completes the baseline on
  // another screen and comes back, and this hook must not keep serving them the
  // pre-check answer.
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  return {
    ...state,
    passed: state.status === "Passed",
    failed: state.status === "Failed",
    refresh,
  };
}
