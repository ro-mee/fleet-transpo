"use client";

import { useCallback, useState } from "react";
import { ArrowBigUp } from "lucide-react";
import { cn } from "@/lib/utils";

// Tracks Caps Lock state for a single password input. Browsers only expose
// the state through keyboard events, so detection starts on the first
// keystroke — spread `bind` onto the <Input> and render <CapsLockHint />
// beneath the field:
//
//   const { capsOn, bind } = useCapsLock();
//   <Input type="password" {...bind} ... />
//   <CapsLockHint on={capsOn} />
//
// Hint only, never a validation error — it must not block submit.
export function useCapsLock() {
  const [capsOn, setCapsOn] = useState(false);

  const update = useCallback((e) => {
    try {
      setCapsOn(!!e?.getModifierState?.("CapsLock"));
    } catch {
      setCapsOn(false);
    }
  }, []);

  return { capsOn, bind: { onKeyDown: update, onKeyUp: update } };
}

// Premium inline warning: a physical keycap carrying the caps glyph, a
// warning-tinted pill, and a 220ms rise-and-settle entrance (transform and
// opacity only; disabled under reduced motion). Decorative parts are hidden
// from assistive tech; the message itself is a polite live region.
export function CapsLockHint({ on, className }) {
  if (!on) return null;
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        "caps-hint-enter inline-flex max-w-full items-center gap-2 rounded-lg border border-warning/25 bg-warning-bg/70 px-2.5 py-1.5 text-xs",
        className
      )}
    >
      <span
        aria-hidden="true"
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border bg-surface shadow-xs"
      >
        <ArrowBigUp className="h-3 w-3 text-foreground" strokeWidth={2.25} />
      </span>
      <span className="font-semibold leading-snug text-warning-700">Caps Lock is on</span>
    </p>
  );
}
