"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Archive, Loader2, Trash2, Undo2 } from "lucide-react";
import { createFuseCountdown } from "./fuse-countdown";
import styles from "./fuse-button.module.css";

const ICONS = { archive: Archive, destructive: Trash2, danger: Trash2, warning: Archive };

function describeError(error) {
  if (error instanceof Error && error.message) return error.message;
  return "The result could not be confirmed. Check the record before trying again.";
}

/** A delayed, reversible-before-submit confirmation control. */
export function FuseButton({
  label,
  undoLabel = "Undo",
  workingLabel = "Working...",
  doneLabel = "Done",
  tone = "destructive",
  delay = 5000,
  disabled = false,
  icon: ActionIcon,
  onCommit,
  onSuccess,
  onExecutingChange,
  onPhaseChange,
}) {
  const [phase, setPhase] = useState("idle");
  const [remaining, setRemaining] = useState(delay);
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  const [error, setError] = useState("");
  const rootRef = useRef(null);
  const timerRef = useRef(null);
  const mountedRef = useRef(false);
  const callbacksRef = useRef({ onCommit, onSuccess, onExecutingChange });
  useLayoutEffect(() => {
    callbacksRef.current = { onCommit, onSuccess, onExecutingChange, onPhaseChange };
  }, [onCommit, onSuccess, onExecutingChange, onPhaseChange]);
  const statusId = useId();

  const isPaused = hidden || disabled;
  const Icon = ActionIcon || ICONS[tone] || Trash2;
  const progress = Math.max(0, Math.min(1, remaining / Math.max(delay, 1)));

  useEffect(() => {
    mountedRef.current = true;
    const onVisibilityChange = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      timerRef.current?.cancel();
      timerRef.current = null;
      callbacksRef.current.onExecutingChange?.(false);
    };
  }, []);

  const cancel = useCallback(() => {
    if (phase !== "armed") return;
    if (!timerRef.current?.cancel()) return;
    timerRef.current = null;
    setRemaining(delay);
    setPhase("idle");
    callbacksRef.current.onPhaseChange?.("idle");
    requestAnimationFrame(() => rootRef.current?.querySelector("button")?.focus());
  }, [delay, phase]);

  useEffect(() => {
    if (phase !== "armed") return;
    if (isPaused) timerRef.current?.pause();
    else timerRef.current?.resume();
  }, [isPaused, phase]);

  const arm = () => {
    if (disabled || phase !== "idle") return;
    setError("");
    setRemaining(delay);
    let countdown;
    countdown = createFuseCountdown({
      delay,
      onTick: setRemaining,
      onExpire: () => {
        if (timerRef.current === countdown) timerRef.current = null;
        setPhase("executing");
        callbacksRef.current.onPhaseChange?.("executing");
        callbacksRef.current.onExecutingChange?.(true);

        Promise.resolve()
          .then(() => callbacksRef.current.onCommit?.())
          .then(() => {
            if (!mountedRef.current) return;
            setPhase("settled");
            callbacksRef.current.onPhaseChange?.("settled");
            callbacksRef.current.onExecutingChange?.(false);
            callbacksRef.current.onSuccess?.();
          })
          .catch((commitError) => {
            if (!mountedRef.current) return;
            setError(describeError(commitError));
            setPhase("error");
            callbacksRef.current.onPhaseChange?.("error");
            callbacksRef.current.onExecutingChange?.(false);
          });
      },
    });
    timerRef.current = countdown;
    countdown.start();
    setPhase("armed");
    callbacksRef.current.onPhaseChange?.("armed");
  };

  const handleKeyDown = (event) => {
    if (event.key !== "Escape" || phase !== "armed") return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
  };

  return (
    <div
      ref={rootRef}
      className={styles.root}
      data-tone={tone}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        className={styles.action}
        data-phase={phase}
        disabled={disabled || phase === "executing" || phase === "settled" || phase === "error"}
        onClick={phase === "armed" ? cancel : arm}
        aria-describedby={statusId}
        style={{ "--fuse-progress": progress }}
      >
        {phase === "idle" && <Icon aria-hidden="true" className={styles.icon} />}
        {phase === "armed" && <Undo2 aria-hidden="true" className={styles.icon} />}
        {phase === "executing" && <Loader2 aria-hidden="true" className={`${styles.icon} ${styles.spinner}`} />}
        {phase === "settled" && <Icon aria-hidden="true" className={styles.icon} />}
        {phase === "error" && <Icon aria-hidden="true" className={styles.icon} />}
        <span>
          {phase === "idle" && label}
          {phase === "armed" && <>{undoLabel} <span aria-hidden="true">({Math.ceil(remaining / 1000)}s)</span></>}
          {phase === "executing" && workingLabel}
          {phase === "settled" && doneLabel}
          {phase === "error" && "Outcome unknown"}
        </span>
      </button>
      <span id={statusId} className={styles.srOnly} role="status" aria-live="polite">
        {phase === "armed" && `Action scheduled. ${Math.ceil(remaining / 1000)} seconds remain. Select Undo or press Escape to cancel. The timer pauses while this page is hidden.`}
        {phase === "executing" && workingLabel}
      </span>
      {phase === "error" && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}
