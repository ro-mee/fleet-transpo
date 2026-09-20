import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  FUEL_SCAN_DEMO_PHASES,
  isCorrectSampleTotal,
  isFuelScanDemoPhase,
  nextFuelScanDemoPhase,
} from "./fuel-scan-demo";
import {
  SAMPLE_FUEL_RECEIPT,
  formatSampleCurrency,
} from "../components/coachmarks/simulation/demos/sample-receipt-fixture";

describe("Fuel receipt coach-mark micro-simulation", () => {
  it("defines the bounded Learn demo phase order", () => {
    expect(FUEL_SCAN_DEMO_PHASES).toEqual([
      "idle",
      "aligning",
      "detected",
      "lifting",
      "scanning",
      "extracting",
      "review",
      "complete",
    ]);

    for (const phase of FUEL_SCAN_DEMO_PHASES) {
      expect(isFuelScanDemoPhase(phase)).toBe(true);
    }
    expect(isFuelScanDemoPhase("submitting")).toBe(false);
  });

  it("advances only through the declared sequence", () => {
    expect(nextFuelScanDemoPhase("idle")).toBe("aligning");
    expect(nextFuelScanDemoPhase("aligning")).toBe("detected");
    expect(nextFuelScanDemoPhase("detected")).toBe("lifting");
    expect(nextFuelScanDemoPhase("lifting")).toBe("scanning");
    expect(nextFuelScanDemoPhase("scanning")).toBe("extracting");
    expect(nextFuelScanDemoPhase("extracting")).toBe("review");
    expect(nextFuelScanDemoPhase("review")).toBe("complete");
    expect(nextFuelScanDemoPhase("complete")).toBeNull();
    expect(nextFuelScanDemoPhase("unknown")).toBeNull();
  });

  it("teaches verification with a deliberately imperfect OCR total", () => {
    expect(SAMPLE_FUEL_RECEIPT.printedTotal).toBe("2911.25");
    expect(SAMPLE_FUEL_RECEIPT.simulatedOcrTotal).toBe("2911.75");
    expect(
      isCorrectSampleTotal(
        SAMPLE_FUEL_RECEIPT.simulatedOcrTotal,
        SAMPLE_FUEL_RECEIPT.printedTotal
      )
    ).toBe(false);
    expect(
      isCorrectSampleTotal(
        SAMPLE_FUEL_RECEIPT.printedTotal,
        SAMPLE_FUEL_RECEIPT.printedTotal
      )
    ).toBe(true);
    expect(formatSampleCurrency(SAMPLE_FUEL_RECEIPT.printedTotal)).toContain(
      "2,911.25"
    );
  });

  it("keeps the demo isolated from production network and emergency actions", () => {
    const demo = readFileSync(
      new URL(
        "../components/coachmarks/simulation/demos/FuelReceiptScanDemo.jsx",
        import.meta.url
      ),
      "utf8"
    );
    expect(demo).not.toContain('from "../../../../lib/api"');
    expect(demo).not.toContain("api.post(");
    expect(demo).not.toContain("api.put(");
    expect(demo).not.toContain("api.delete(");
    expect(demo).not.toContain("openReceiptCamera(");
    expect(demo).not.toContain("triggerDriverSos(");
  });

  it("supports timer cleanup, replay, reduced motion, and accessible alignment fallback", () => {
    const demo = readFileSync(
      new URL(
        "../components/coachmarks/simulation/demos/FuelReceiptScanDemo.jsx",
        import.meta.url
      ),
      "utf8"
    );
    expect(demo).toContain("clearTimers");
    expect(demo).toContain("AccessibilityInfo.isReduceMotionEnabled");
    expect(demo).toContain("Align sample");
    expect(demo).toContain("Replay");
    expect(demo).toContain("PanResponder.create");
  });

  it("wires the overlay simulation to a real-target handoff instead of automatic production action", () => {
    const overlay = readFileSync(
      new URL(
        "../components/coachmarks/CoachMarkOverlay.jsx",
        import.meta.url
      ),
      "utf8"
    );
    const screen = readFileSync(
      new URL("../app/(app)/fuel-report.js", import.meta.url),
      "utf8"
    );

    expect(overlay).toContain('step.presentation === "simulation"');
    expect(overlay).toContain("setInSimulationHandoff(true)");
    expect(overlay).toContain("Now scan your receipt");

    expect(screen).toContain('targetId="fuel.scan_entry"');
    expect(screen).toContain(
      'notifyInteraction?.("fuel.scan_entry", { action: "open_real_scanner" })'
    );
    expect(screen).toContain('openReceiptCamera("scan")');
  });

  it("keeps real OCR phases driven by the production scan path", () => {
    const screen = readFileSync(
      new URL("../app/(app)/fuel-report.js", import.meta.url),
      "utf8"
    );
    expect(screen).toContain('setScanVisualPhase("preparing")');
    expect(screen).toContain('setScanVisualPhase("uploading")');
    expect(screen).toContain('setScanVisualPhase("reading")');
    expect(screen).toContain('setScanVisualPhase("review_ready")');
    expect(screen).toContain('setScanVisualPhase("failed")');
  });
});
