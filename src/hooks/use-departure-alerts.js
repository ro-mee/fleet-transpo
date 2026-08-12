"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "@/components/ui/toast";
import { useRoleAccess } from "@/hooks/use-role-access";
import { getDispatchPolicy } from "@/services/settings.service";
import { DEFAULT_DISPATCH_POLICY } from "@/lib/dispatch-policy";
import {
  ALERT_TONE,
  alertMessage,
  departureAlerts,
} from "@/lib/scheduling/departure-alerts";

// Departure warnings for the dispatch board.
//
// Detection is client-side by design: the board already polls
// /api/dispatch/by-status every 30s and that payload already carries null
// vehicle_id/driver_id, so noticing "unassigned and leaving soon" costs no extra
// query and no cron. Nothing is written to the notifications table — every
// dispatcher's tab runs this independently, so persisting would mean one row per
// dispatcher per tick.
//
// The trade-off: warnings only fire while someone has the board open. That was
// the chosen scope.

// The board's own poll is the primary clock, but a quiet board still needs the
// countdown to advance — no dispatch changing for three minutes must not mean
// three minutes of silence while a departure closes in.
const TICK_MS = 60_000;

// Which toast channel each tone speaks through.
const TONE_TOAST = {
  [ALERT_TONE.notice]: toast.info,
  [ALERT_TONE.warning]: toast.warning,
  [ALERT_TONE.critical]: toast.error,
};

/**
 * @param {Array} dispatches  rows from the board query (any lane mix)
 * @returns {{alerts: Array, byId: Map, count: number, topTone: string|null, enabled: boolean}}
 */
export function useDepartureAlerts(dispatches) {
  const { can } = useRoleAccess();
  // The same verb the Assign button is gated on, so exactly the people who can
  // resolve the warning are the ones who receive it.
  const canDispatch = can("dispatch", "update");

  const { data: policy } = useQuery({
    queryKey: ["dispatch-policy"],
    queryFn: getDispatchPolicy,
    // Config, not live data — and a failure here must never silence warnings,
    // hence the defaults fallback below rather than an error path.
    staleTime: 5 * 60_000,
    enabled: canDispatch,
  });

  const tiers = policy?.departureAlertTiers ?? DEFAULT_DISPATCH_POLICY.departureAlertTiers;
  const enabled =
    canDispatch &&
    (policy?.departureAlertsEnabled ?? DEFAULT_DISPATCH_POLICY.departureAlertsEnabled);

  // Advances the clock between board polls. The value is only a recompute
  // trigger; the alert math reads the real time itself.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, [enabled]);

  const alerts = useMemo(() => {
    if (!enabled) return [];
    return departureAlerts(dispatches, { now: new Date(), tiers });
    // `tick` is intentionally a dependency: it is what re-runs this on a quiet board.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatches, tiers, enabled, tick]);

  const byId = useMemo(() => {
    const m = new Map();
    for (const { dispatch, alert } of alerts) m.set(dispatch.dispatch_id, alert);
    return m;
  }, [alerts]);

  // Toast only when a dispatch crosses into a *new* tier. Without this the 30s
  // poll would re-announce every warning twice a minute.
  const announced = useRef(new Map());
  useEffect(() => {
    if (!enabled) {
      announced.current.clear();
      return;
    }
    const seen = new Set();
    for (const { dispatch, alert } of alerts) {
      const id = dispatch.dispatch_id;
      seen.add(id);
      if (announced.current.get(id) === alert.tier) continue;
      announced.current.set(id, alert.tier);
      const label = dispatch.dispatch_number || `DSP-${id}`;
      (TONE_TOAST[alert.tone] || toast.warning)(`${label} — ${alertMessage(alert)}`);
    }
    // Forget dispatches that resolved or left the payload, so one that becomes
    // unassigned again can alert afresh.
    for (const id of announced.current.keys()) {
      if (!seen.has(id)) announced.current.delete(id);
    }
  }, [alerts, enabled]);

  return {
    alerts,
    byId,
    count: alerts.length,
    topTone: alerts.length ? alerts[0].alert.tone : null,
    enabled,
  };
}
