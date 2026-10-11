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

it("states plainly when no partner message has been queued", () => {
  const markup = renderToStaticMarkup(React.createElement(CargoFeedbackStatus, {
    feedback: { state: "NOT_QUEUED" },
  }));

  expect(markup).toContain("Not queued");
  expect(markup).toContain("No partner message is currently queued.");
  expect(markup).not.toContain("Waiting to send");
});

it("shows queued partner messages as waiting to send", () => {
  const markup = renderToStaticMarkup(React.createElement(CargoFeedbackStatus, {
    feedback: { state: "PENDING" },
  }));

  expect(markup).toContain("Waiting to send");
  expect(markup).toContain("The partner message is waiting to send.");
});

it("uses a neutral unavailable status for unknown partner delivery states", () => {
  const markup = renderToStaticMarkup(React.createElement(CargoFeedbackStatus, {
    feedback: { state: "FUTURE_STATE" },
  }));

  expect(markup).toContain("Delivery status unavailable");
  expect(markup).toContain("The partner delivery state is not available.");
  expect(markup).not.toContain("Waiting to send");
});
