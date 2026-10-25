import { describe, expect, it } from "vitest";
import { DEMO_CASES, verifyDemoReport } from "./run.mjs";

const report = () => ({
  success: true,
  testResults: DEMO_CASES.map(scenario => ({
    name: scenario.file,
    assertionResults: [{ title: scenario.test, status: "passed" }],
  })),
});
describe("six-scenario maintenance demo evidence", () => {
  it("accepts all six named real workflow cases", () => {
    expect(verifyDemoReport(report())).toEqual(DEMO_CASES.map(scenario => scenario.label));
  });
  it("refuses a missing case even when Vitest reports success", () => {
    const result = report(); result.testResults.pop();
    expect(() => verifyDemoReport(result)).toThrow(/Isolated service completion/);
  });
  it.each(["pending", "skipped", "failed", "todo"])("refuses a %s case", status => {
    const result = report(); result.testResults[0].assertionResults[0].status = status;
    expect(() => verifyDemoReport(result)).toThrow(/Overdue without trips/);
  });
  it("refuses an unrelated test with the same title in another file", () => {
    const result = report(); result.testResults[0].name = "other.test.js";
    expect(() => verifyDemoReport(result)).toThrow(/Overdue without trips/);
  });
  it("refuses an unsuccessful run even if all six assertions are listed as passed", () => {
    expect(() => verifyDemoReport({ ...report(), success: false })).toThrow(/did not succeed/);
  });
});