"use client";

import React from "react";
import { SessionTimeoutDialog } from "./session-timeout-dialog";
import { IDLE_TIMEOUT_SECONDS, WEB_SESSION_TTL_SECONDS } from "@/lib/auth/session-policy";

/**
 * Backward compatibility wrapper around SessionTimeoutDialog.
 * Adapts legacy SessionExpiryModal props to the enhanced SessionTimeoutDialog state model.
 */
export function SessionExpiryModal({
  isOpen,
  state, // "idle_warning" | "absolute_warning" | "warning" | "critical" | "extending" | "extension-error" | "expired"
  countdownSeconds = 0,
  errorCode = null,
  errorDetails = null,
  onStaySignedIn,
  onSignOut,
  onSignInAgain,
  onClose,
  loading = false,
}) {
  if (!isOpen) {
    return <SessionTimeoutDialog state="hidden" />;
  }

  // Map legacy / contextual state to SessionTimeoutState
  let dialogState = "warning";
  let isAbsoluteWarning = false;

  if (state === "expired") {
    dialogState = "expired";
  } else if (loading || state === "extending") {
    dialogState = "extending";
  } else if (state === "extension-error") {
    dialogState = "extension-error";
  } else if (state === "absolute_warning") {
    isAbsoluteWarning = true;
    dialogState = "critical";
  } else if (state === "critical" || countdownSeconds <= 60) {
    dialogState = "critical";
  } else {
    dialogState = "warning";
  }

  const idleExtensionMinutes = Math.round(IDLE_TIMEOUT_SECONDS / 60);
  const absoluteSessionLimitHours = Math.round(WEB_SESSION_TTL_SECONDS / 3600);

  return (
    <SessionTimeoutDialog
      state={dialogState}
      remainingSeconds={countdownSeconds}
      idleExtensionMinutes={idleExtensionMinutes}
      absoluteSessionLimitHours={absoluteSessionLimitHours}
      errorCode={errorCode}
      errorDetails={errorDetails}
      isAbsoluteWarning={isAbsoluteWarning}
      onExtendSession={onStaySignedIn}
      onSignOut={onSignOut}
      onSignInAgain={onSignInAgain}
      onClose={onClose}
    />
  );
}

export { SessionTimeoutDialog };
