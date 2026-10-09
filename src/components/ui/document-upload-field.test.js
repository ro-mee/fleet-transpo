import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { DocumentUploadField } from "./document-upload-field";
import { DocumentPreview } from "./document-preview";
globalThis.React = React;
const file = { name: "long-document-name.pdf", size: 1048576, type: "application/pdf" };
function render(status, extra = {}) {
  return renderToStaticMarkup(React.createElement(DocumentUploadField, { kind: "OR_CR", destination: "Vehicle ABC-1234 / OR/CR", upload: { status, file, percent: 70, bytes: 734003, ...extra } }));
}
describe("upload state feedback", () => {
  it("exposes measured progress and a keyboard browse affordance", () => {
    const html = render("uploading");
    expect(html).toContain('type="button"'); expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="70"'); expect(html).toContain("70%");
    expect(html).toContain("Vehicle ABC-1234 / OR/CR");
  });
  it("does not claim transfer completion is storage or record completion", () => {
    expect(render("storing")).toContain("Storing file");
    expect(render("storing")).not.toContain("aria-valuenow");
    const stored = render("uploaded");
    expect(stored).toContain("Uploaded — awaiting Save");
    expect(stored).not.toContain("Saved attachment");
  });
  it("gives an inline failure and retry action", () => {
    const html = render("failed", { error: "Connection lost" });
    expect(html).toContain('role="alert"'); expect(html).toContain("Connection lost"); expect(html).toContain("Retry");
  });
  it("does not call a cancelled new draft a saved document", () => {
    const html = render("cancelled", { file: null });
    expect(html).toContain("No file attached");
    expect(html).not.toContain("Current saved document");
  });
  it("renders a PDF tile and opens a viewer without a broken image or blocked object embed", () => {
    const html = renderToStaticMarkup(React.createElement(DocumentPreview, { url: "https://fleet.test/doc.pdf?token=short", expanded: true }));
    expect(html).toContain("Open PDF in new tab"); expect(html).not.toContain("<img"); expect(html).not.toContain("<object");
  });
});
