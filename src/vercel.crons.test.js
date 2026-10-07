import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// vercel.json cron schedules were REMOVED 2026-10-03: Vercel Hobby only allows
// one cron run per day, so "* * * * *" / "*/5 * * * *" failed deployment. The
// real caller is .github/workflows/cron-sync.yml (*/5 min + 5x60s loop).
// This file pins that contract: no vercel.json crons may come back on a Hobby
// plan, and the routes the workflow hits must stay on disk.
const REQUIRED_PATHS = ["/api/cron/sync", "/api/cron/reconcile"];

const root = fileURLToPath(new URL("..", import.meta.url));

function routeFileFor(cronPath) {
  return `${root}/src/app${cronPath}/route.js`;
}

describe("cron wiring", () => {
  it("declares no vercel.json crons (Vercel Hobby caps at one run per day)", () => {
    const file = `${root}/vercel.json`;
    if (!existsSync(file)) return;
    const config = JSON.parse(readFileSync(file, "utf8"));
    expect(config.crons ?? []).toEqual([]);
  });

  it.each(REQUIRED_PATHS)("cron path %s has a route handler on disk", (cronPath) => {
    const file = routeFileFor(cronPath);
    expect(existsSync(file), `missing route for cron path ${cronPath}: ${file}`).toBe(true);
  });

  it("GitHub Actions workflow drives both cron endpoints", () => {
    const yml = readFileSync(`${root}/.github/workflows/cron-sync.yml`, "utf8");
    expect(yml).toContain('cron: "*/5 * * * *"');
    for (const p of REQUIRED_PATHS) expect(yml).toContain(p);
  });
});
