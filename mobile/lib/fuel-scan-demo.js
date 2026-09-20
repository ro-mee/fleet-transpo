export const FUEL_SCAN_DEMO_PHASES = Object.freeze([
  "idle",
  "aligning",
  "detected",
  "lifting",
  "scanning",
  "extracting",
  "review",
  "complete",
]);

const NEXT_PHASE = Object.freeze({
  idle: "aligning",
  aligning: "detected",
  detected: "lifting",
  lifting: "scanning",
  scanning: "extracting",
  extracting: "review",
  review: "complete",
  complete: null,
});

export function isFuelScanDemoPhase(value) {
  return FUEL_SCAN_DEMO_PHASES.includes(value);
}

export function nextFuelScanDemoPhase(value) {
  return NEXT_PHASE[value] ?? null;
}

export function isCorrectSampleTotal(selected, printedTotal) {
  const selectedNumber = Number(selected);
  const printedNumber = Number(printedTotal);
  return (
    Number.isFinite(selectedNumber) &&
    Number.isFinite(printedNumber) &&
    Math.abs(selectedNumber - printedNumber) < 0.005
  );
}
