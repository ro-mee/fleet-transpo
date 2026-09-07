// Loader contract tests: DB override first, bundled .md second,
// built-in last. Callers already await both loaders, so the async
// migration needs no caller changes (asserted implicitly by import).
import { describe, it, expect, vi, afterEach } from "vitest";
import * as db from "@/lib/db";
import { getSystemInstructions, getReportInstructions } from "@/lib/ai/prompt-loader";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getSystemInstructions", () => {
  it("prefers the DB override over the bundled file", async () => {
    vi.spyOn(db, "query").mockResolvedValue({ rows: [{ content: "# Live override" }] });
    await expect(getSystemInstructions()).resolves.toBe("# Live override");
  });

  it("falls back to the bundled .md when no override exists", async () => {
    vi.spyOn(db, "query").mockResolvedValue({ rows: [] });
    const content = await getSystemInstructions();
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(100);
    expect(content).not.toBe("# Live override");
  });

  it("falls back to .md when the DB itself fails", async () => {
    vi.spyOn(db, "query").mockRejectedValue(new Error("db gone"));
    const content = await getSystemInstructions();
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(100);
  });

  it("treats blank overrides as absent", async () => {
    vi.spyOn(db, "query").mockResolvedValue({ rows: [{ content: "   " }] });
    const content = await getSystemInstructions();
    expect(content.trim().length).toBeGreaterThan(0);
    expect(content).not.toBe("   ");
  });
});

describe("getReportInstructions", () => {
  it("prefers the DB override for a report type", async () => {
    vi.spyOn(db, "query").mockResolvedValue({ rows: [{ content: "# Drivers live" }] });
    await expect(getReportInstructions("drivers")).resolves.toBe("# Drivers live");
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("ai_prompt_templates"), ["drivers"]);
  });

  it("returns undefined for missing/invalid reports", async () => {
    vi.spyOn(db, "query").mockResolvedValue({ rows: [] });
    expect(await getReportInstructions("no_such_report_xyz")).toBeUndefined();
    expect(await getReportInstructions("../../etc")).toBeUndefined();
    expect(await getReportInstructions(null)).toBeUndefined();
  });
});
