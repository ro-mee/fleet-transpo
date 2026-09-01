import { afterEach, describe, expect, it, vi } from "vitest";

// The signing key is cached per module instance, so every case re-imports the
// module under its own env via vi.resetModules().
describe("mobile token signing secret (audit S6)", () => {
  const saved = {};
  const KEYS = ["MOBILE_JWT_SECRET", "NEXTAUTH_SECRET", "NODE_ENV"];

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.resetModules();
    vi.restoreAllMocks();
  });

  function stashEnv() {
    for (const k of KEYS) saved[k] = process.env[k];
  }

  it("signs and verifies with a dedicated MOBILE_JWT_SECRET", async () => {
    stashEnv();
    process.env.MOBILE_JWT_SECRET = "mobile-only-secret";
    process.env.NEXTAUTH_SECRET = "web-secret";
    const mt = await import("./mobile-token");

    const token = await mt.signAccessToken({ employeeId: 7, role: "driver", driverId: 3, authVersion: 2 });
    expect(await mt.verifyAccessToken(token)).toMatchObject({
      employeeId: 7,
      role: "driver",
      driverId: 3,
      authVersion: 2,
    });
  });

  it("rejects tokens signed under a different mobile secret", async () => {
    stashEnv();
    process.env.MOBILE_JWT_SECRET = "key-a";
    let mt = await import("./mobile-token");
    const token = await mt.signAccessToken({ employeeId: 1, role: "driver", driverId: null });

    process.env.MOBILE_JWT_SECRET = "key-b";
    vi.resetModules();
    mt = await import("./mobile-token");
    expect(await mt.verifyAccessToken(token)).toBeNull();
  });

  it("falls back to NEXTAUTH_SECRET when MOBILE_JWT_SECRET is unset, with a warning", async () => {
    stashEnv();
    delete process.env.MOBILE_JWT_SECRET;
    process.env.NEXTAUTH_SECRET = "fallback-secret";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mt = await import("./mobile-token");

    const token = await mt.signAccessToken({ employeeId: 2, role: "admin", driverId: null });
    expect(await mt.verifyAccessToken(token)).toMatchObject({ employeeId: 2 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("MOBILE_JWT_SECRET is not set"));
  });

  it("fails closed when no signing secret exists", async () => {
    stashEnv();
    delete process.env.MOBILE_JWT_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mt = await import("./mobile-token");

    await expect(mt.signAccessToken({ employeeId: 3, role: "driver", driverId: null })).rejects.toThrow(
      /not set/
    );
  });

  it("fails closed when production reuses the web signing secret", async () => {
    stashEnv();
    process.env.NODE_ENV = "production";
    process.env.NEXTAUTH_SECRET = "same-secret";
    process.env.MOBILE_JWT_SECRET = "same-secret";
    const mt = await import("./mobile-token");

    await expect(mt.signAccessToken({ employeeId: 4, role: "driver", driverId: null })).rejects.toThrow(
      /must differ/
    );
  });
});
