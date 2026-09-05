"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Tracks Caps Lock state for a single password input. Browsers only expose
// the state through keyboard events, so detection starts on the first
// keystroke — spread `bind` onto the <Input> and render <CapsLockHint />
// beneath the field:
//
//   const { active, bind } = useCapsLock();
//   <Input type="password" {...bind} ... />
//   <CapsLockHint on={active} />
//
// `active` is true only while the field is focused AND Caps Lock is on.
// Hint only, never a validation error — it must not block submit.
export function useCapsLock() {
  const [capsOn, setCapsOn] = useState(false);
  const [focused, setFocused] = useState(false);

  const update = useCallback((e) => {
    try {
      setCapsOn(!!e?.getModifierState?.("CapsLock"));
    } catch {
      setCapsOn(false);
    }
  }, []);

  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur = useCallback(() => setFocused(false), []);

  return {
    capsOn,
    focused,
    active: capsOn && focused,
    bind: { onKeyDown: update, onKeyUp: update, onFocus, onBlur },
  };
}

const EXIT_MS = 180;

// Contextual speech-notch hint: pale-coral surface with an upward pointer,
// a vibrant coral 'Aa' badge, and polite live region announcement.
// Enter/exit motion uses transform and opacity only (disabled under reduced motion).
// Unmounts ~180ms after hiding so the exit animation can play out.
export function CapsLockHint({ on, className }) {
  const [render, setRender] = useState(on);
  const [leaving, setLeaving] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    if (on) {
      if (timer.current) clearTimeout(timer.current);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- exit choreography: unmount is deliberately delayed so the fade-out can play
      setRender(true);
      setLeaving(false);
      return;
    }
    if (!render) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      setRender(false);
      return;
    }
    setLeaving(true);
    timer.current = setTimeout(() => {
      setRender(false);
      setLeaving(false);
    }, EXIT_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [on, render]);

  if (!render) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        leaving ? "caps-hint-exit" : "caps-hint-enter",
        "caps-hint-bubble relative mt-1.5 inline-flex max-w-full items-center gap-2 rounded-xl border p-1.5 pr-3 text-xs shadow-2xs select-none",
        className
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-1 left-[18px] h-2.5 w-2.5 rotate-45 border-l border-t border-[inherit] bg-[inherit]"
      />
      <span
        aria-hidden="true"
        className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-rose-500 text-[11px] font-bold text-white shadow-2xs select-none"
      >
        Aa
      </span>
      <span className="relative font-medium text-rose-600 dark:text-rose-400 select-none">
        Caps Lock is on
      </span>
    </div>
  );
}
