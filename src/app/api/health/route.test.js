// GET /api/health — platform liveness probe. Must stay a fixed 200 with no
// auth, no database, and no env reads: a probe that depends on any of those
// turns a first deploy (migrations not yet run, secrets not yet wired) into
// an infrastructure-looking failure.
import { describe, it, expect } from "vitest";
import { GET } from "./route";

describe("GET /api/health", () => {
  it("answers a fixed healthy payload", async () => {
    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "fleetops-web" });
  });

  it("touches neither the database nor the environment", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./route.js", import.meta.url), "utf8")
    );
    expect(source).not.toMatch(/@\/lib\/db|process\.env|requireAuth|requirePermission/);
  });
});
