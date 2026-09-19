import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionTimeoutDialog } from "./session-timeout-dialog";
import { SessionExpiryModal } from "./session-expiry-modal";

describe("SessionTimeoutDialog Component", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("renders nothing when state is hidden", () => {
    const html = renderToStaticMarkup(
      React.createElement(SessionTimeoutDialog, {
        state: "hidden",
        remainingSeconds: 300,
      })
    );
    expect(html).toBe("");
  });

  it("renders Warning state with compact timer card when session is idle", () => {
    const html = renderToStaticMarkup(
      React.createElement(SessionTimeoutDialog, {
        state: "warning",
        remainingSeconds: 295, // 4:55
        idleExtensionMinutes: 5,
        absoluteSessionLimitHours: 12,
      })
    );

    expect(html).toContain("SESSION INACTIVITY");
    expect(html).toContain("Still working?");
    expect(html).toContain("Your session has been idle for a while and will automatically expire soon.");
    expect(html).toContain("4:55");
    expect(html).toContain("Selecting “Stay signed in” extends your idle session by 5 minutes.");
    expect(html).toContain("Sign out");
    expect(html).toContain("Stay signed in");
    // Verify compact card styling
    expect(html).toContain("w-[148px]");
    expect(html).toContain("h-[84px]");
  });

  it("renders Critical state with circular countdown ring during final 60s", () => {
    const html = renderToStaticMarkup(
      React.createElement(SessionTimeoutDialog, {
        state: "critical",
        remainingSeconds: 35, // 0:35
      })
    );

    expect(html).toContain("SESSION EXPIRING SOON");
    expect(html).toContain("Your session will expire soon");
    expect(html).toContain("For your security, your session will end automatically if no action is taken.");
    expect(html).toContain("0:35");
    expect(html).toContain("You will be signed out automatically when the countdown ends.");
    // Verify SVG countdown ring is rendered
    expect(html).toContain("<svg");
    expect(html).toContain("viewBox=\"0 0 120 120\"");
    expect(html).toContain("stroke-dasharray");
  });

  it("automatically uses Critical countdown ring when remainingSeconds is <= 60", () => {
    const html = renderToStaticMarkup(
      React.createElement(SessionTimeoutDialog, {
        state: "warning",
        remainingSeconds: 45,
      })
    );

    expect(html).toContain("SESSION EXPIRING SOON");
    expect(html).toContain("0:45");
    expect(html).toContain("<svg");
  });

  it("renders extending loading state", () => {
    const html = renderToStaticMarkup(
      React.createElement(SessionTimeoutDialog, {
        state: "extending",
        remainingSeconds: 30,
      })
    );

    expect(html).toContain("Refreshing…");
    expect(html).toContain("disabled=\"\"");
  });

  it("renders extension error state with inline error alert", () => {
    const html = renderToStaticMarkup(
      React.createElement(SessionTimeoutDialog, {
        state: "extension-error",
        remainingSeconds: 30,
        errorDetails: "Couldn’t extend your session. Please try again.",
      })
    );

    expect(html).toContain("role=\"alert\"");
    expect(html).toContain("Couldn’t extend your session. Please try again.");
    expect(html).toContain("Stay signed in");
    expect(html).toContain("Sign out");
  });

  it("renders Expired state without countdown and with clear recovery action", () => {
    const html = renderToStaticMarkup(
      React.createElement(SessionTimeoutDialog, {
        state: "expired",
        errorCode: "SESSION_IDLE_TIMEOUT",
        idleExtensionMinutes: 5,
      })
    );

    expect(html).toContain("SESSION EXPIRED");
    expect(html).toContain("Your session has expired");
    expect(html).toContain("For your security, you have been signed out due to 5 minutes of inactivity.");
    expect(html).toContain("Any unsaved changes may be lost. Please sign in again to continue.");
    expect(html).toContain("Go to sign in");
    // Should NOT contain countdown ring or compact timer card
    expect(html).not.toContain("stroke-dasharray");
    expect(html).not.toContain("w-[148px]");
  });

  it("renders 12-hour maximum limit warning correctly", () => {
    const html = renderToStaticMarkup(
      React.createElement(SessionTimeoutDialog, {
        state: "critical",
        isAbsoluteWarning: true,
        remainingSeconds: 300,
        absoluteSessionLimitHours: 12,
      })
    );

    expect(html).toContain("12-HOUR MAXIMUM LIMIT");
    expect(html).toContain("Session ending soon");
    expect(html).toContain("For fleet security, active sessions cannot exceed 12 continuous hours.");
    expect(html).toContain("Sign in again");
  });

  it("meets accessibility requirements (dialog role, aria-modal, polite live region)", () => {
    const html = renderToStaticMarkup(
      React.createElement(SessionTimeoutDialog, {
        state: "critical",
        remainingSeconds: 30,
      })
    );

    expect(html).toContain("role=\"dialog\"");
    expect(html).toContain("aria-modal=\"true\"");
    expect(html).toContain("aria-labelledby=\"session-modal-title\"");
    expect(html).toContain("aria-describedby=\"session-modal-desc\"");
    expect(html).toContain("aria-live=\"polite\"");
    expect(html).toContain("Your session will expire in 30 seconds.");
  });
});

describe("SessionExpiryModal Backward Compatibility", () => {
  it("forwards isOpen=false to hidden state", () => {
    const html = renderToStaticMarkup(
      React.createElement(SessionExpiryModal, {
        isOpen: false,
        state: "idle_warning",
        countdownSeconds: 50,
      })
    );
    expect(html).toBe("");
  });

  it("maps idle_warning with <=60s countdown to critical dialog", () => {
    const html = renderToStaticMarkup(
      React.createElement(SessionExpiryModal, {
        isOpen: true,
        state: "idle_warning",
        countdownSeconds: 35,
      })
    );
    expect(html).toContain("SESSION EXPIRING SOON");
    expect(html).toContain("0:35");
  });

  it("maps idle_warning with >60s countdown to warning dialog", () => {
    const html = renderToStaticMarkup(
      React.createElement(SessionExpiryModal, {
        isOpen: true,
        state: "idle_warning",
        countdownSeconds: 295,
      })
    );
    expect(html).toContain("SESSION INACTIVITY");
    expect(html).toContain("Still working?");
    expect(html).toContain("4:55");
  });

  it("maps expired state accurately", () => {
    const html = renderToStaticMarkup(
      React.createElement(SessionExpiryModal, {
        isOpen: true,
        state: "expired",
        errorCode: "SESSION_EXPIRED",
      })
    );
    expect(html).toContain("SESSION EXPIRED");
    expect(html).toContain("Go to sign in");
  });
});
