import React from "react";
import FuelReceiptScanDemo from "./demos/FuelReceiptScanDemo";

const DEMOS = Object.freeze({
  fuel_receipt_scan: FuelReceiptScanDemo,
});

export const APPROVED_COACH_MARK_DEMOS = Object.freeze(Object.keys(DEMOS));

export default function CoachMarkDemoHost({
  demoKey,
  onComplete,
  onSkip,
}) {
  const Demo = DEMOS[demoKey];
  if (!Demo) return null;
  return <Demo onComplete={onComplete} onSkip={onSkip} />;
}
