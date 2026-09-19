"use client";

import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSessionManager } from "@/context/session-manager";
import { IDLE_TIMEOUT_SECONDS } from "@/lib/auth/session-policy";
import {
  countdownTone,
  formatCountdown,
  formatCountdownSpoken,
} from "@/lib/auth/countdown";

// Stock copy, built once from the policy constant rather than from the live
// value — the attribute must not churn every second on a node the user may be
// hovering, and the *rule* ("expires after N minutes idle") is what the tooltip
// needs to explain. The running number is already on screen beside it.
const IDLE_MINUTES = Math.round(IDLE_TIMEOUT_SECONDS / 60);
const TOOLTIP = `Session expires after ${IDLE_MINUTES} minute${IDLE_MINUTES === 1 ? "" : "s"} of inactivity. It resets when you click or type.`;

const TONES = {
  neutral: "border-border bg-background/60 text-foreground-muted",
  warning: "border-warning/30 bg-warning/10 text-warning-700",
};

/**
 * Live idle-session countdown for the top bar.
 *
 * The expiry modal already counts down, but it only opens once the warning
 * window begins — for the rest of the session there is nothing on screen to tell
 * a user whether their session is fresh or nearly gone. This drains while they
 * are idle and resets the moment they click or type, so the modal lands as
 * confirmation of something they already saw coming.
 *
 * The ticking state deliberately lives here rather than in `TopNav`: the
 * provider sits above the whole page, so a second-by-second value held higher up
 * would re-render the notification dropdown, the user menu and the theme toggle
 * once a second for no reason.
 */
export function SessionCountdown() {
  const { idleExpiresAt } = useSessionManager();
  const [secondsRemaining, setSecondsRemaining] = useState(null);

  useEffect(() => {
    if (!idleExpiresAt) return;

    // Recomputed from the deadline, never decremented: a counter drifts the
    // moment the browser throttles timers in a background tab, and would never
    // find its way back. This is the same arithmetic `session-manager.jsx`
    // effect 7 uses, so the chip and the modal agree by construction.
    const read = () => setSecondsRemaining(Math.ceil((idleExpiresAt - Date.now()) / 1000));

    // The read lands in a timer callback rather than directly in the effect
    // body: a synchronous setState here is what `react-hooks/set-state-in-effect`
    // flags, and the zero-delay first tick is what keeps the chip from showing a
    // stale second right after a click resets the deadline.
    const first = setTimeout(read, 0);
    const interval = setInterval(read, 1000);

    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [idleExpiresAt]);

  // `secondsRemaining` is null until the first heartbeat resolves; `idleExpiresAt`
  // going null again means the session is gone, and the shell is about to unmount
  // with it.
  if (!idleExpiresAt || secondsRemaining === null) return null;

  const tone = countdownTone(secondsRemaining);

  return (
    <span
      // `timer` carries an implicit aria-live of "off", so a value that changes
      // every second is not announced continuously. The digits are the visual
      // form; the label is the spoken one, because a screen reader reads "4:32"
      // as "four colon thirty-two" and not as a duration.
      role="timer"
      aria-label={`Session expires in ${formatCountdownSpoken(secondsRemaining)}`}
      title={TOOLTIP}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 select-none",
        "font-data text-xs font-semibold tabular-nums leading-none",
        TONES[tone]
      )}
    >
      <Timer aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
      <span aria-hidden="true">{formatCountdown(secondsRemaining)}</span>
    </span>
  );
}
