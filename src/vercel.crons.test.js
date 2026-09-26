import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Pins the vercel.json cron contract: every scheduled path must map to a real
// route handler, or deploying to Vercel would 404 on a schedule nobody notices
// until the heartbeat goes stale again (the exact failure mode this file's
// sibling workflow exists to prevent).
const REQUIRED_PATHS = ["/api/cron/sync", "/api/cron/reconcile"];

function readVercelJson() {
  const root = fileURLToPath(new URL("../vercel.json", import.meta.url));
  return JSON.parse(readFileSync(root, "utf8"));
}

function routeFileFor(cronPath) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  return `${root}/src/app${cronPath}/route.js`;
}

describe("vercel.json crons", () => {
  it("declares both cron endpoints on the schedules the routes document", () => {
    const config = readVercelJson();
    expect(Array.isArray(config.crons)).toBe(true);

    const byPath = Object.fromEntries(config.crons.map((c) => [c.path, c.schedule]));
    expect(byPath["/api/cron/sync"]).toBe("* * * * *");
    expect(byPath["/api/cron/reconcile"]).toBe("*/5 * * * *");
  });

  it.each(REQUIRED_PATHS)("cron path %s has a route handler on disk", (cronPath) => {
    const file = routeFileFor(cronPath);
    expect(existsSync(file), `missing route for cron path ${cronPath}: ${file}`).toBe(true);
  });

  it("keeps the required paths in sync with what vercel.json schedules", () => {
    const config = readVercelJson();
    const paths = config.crons.map((c) => c.path).sort();
    expect(paths).toEqual([...REQUIRED_PATHS].sort());
  });
});
