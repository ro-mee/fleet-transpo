import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CargoFeedbackStatus } from "./cargo-feedback-status";

it("describes partner acknowledgement as message delivery, never quantity approval", () => {
  const markup = renderToStaticMarkup(React.createElement(CargoFeedbackStatus, {
    feedback: { state: "ACKNOWLEDGED" },
  }));

  expect(markup).toContain("Message received");
  expect(markup).toContain("does not approve cargo quantities");
  expect(markup).not.toContain("Approval recorded");
  expect(markup).not.toContain("Approved");
});

it("renders retry only when the server grants the retry capability", () => {
  const denied = renderToStaticMarkup(React.createElement(CargoFeedbackStatus, {
    feedback: { state: "FAILED", last_error_code: "GATEWAY_TIMEOUT" },
    canRetry: false,
    onRetry: () => {},
  }));
  const allowed = renderToStaticMarkup(React.createElement(CargoFeedbackStatus, {
    feedback: { state: "FAILED", last_error_code: "GATEWAY_TIMEOUT" },
    canRetry: true,
    onRetry: () => {},
  }));

  expect(denied).not.toContain("Retry delivery");
  expect(allowed).toContain("Retry delivery");
});
