import { describe, it, expect } from "vitest";
import { authOptions, isSafeAvatarUrl } from "./auth";

describe("authOptions callbacks and avatar protection", () => {
  it("isSafeAvatarUrl validates URLs correctly", () => {
    expect(isSafeAvatarUrl("https://example.com/avatar.jpg")).toBe(true);
    expect(isSafeAvatarUrl("http://example.com/avatar.png")).toBe(true);
    expect(isSafeAvatarUrl("data:image/jpeg;base64," + "a".repeat(1000))).toBe(false);
    expect(isSafeAvatarUrl("https://example.com/" + "a".repeat(600))).toBe(false);
    expect(isSafeAvatarUrl(null)).toBe(false);
    expect(isSafeAvatarUrl(undefined)).toBe(false);
  });

  it("jwt callback preserves safe avatarUrl on login", async () => {
    const token = await authOptions.callbacks.jwt({
      token: {},
      user: {
        role: "admin",
        employeeId: 1,
        firstName: "Jack",
        lastName: "Mors",
        position: "Admin",
        status: "Active",
        avatarUrl: "https://example.com/avatar.jpg",
        authVersion: 1,
        sessionId: "123",
      },
    });
    expect(token.avatarUrl).toBe("https://example.com/avatar.jpg");
    expect(token.role).toBe("admin");
  });

  it("jwt callback strips unsafe base64 avatarUrl on login", async () => {
    const token = await authOptions.callbacks.jwt({
      token: {},
      user: {
        role: "admin",
        employeeId: 1,
        firstName: "Jack",
        lastName: "Mors",
        position: "Admin",
        status: "Active",
        avatarUrl: "data:image/jpeg;base64,oversizeddata",
        authVersion: 1,
        sessionId: "123",
      },
    });
    expect(token.avatarUrl).toBeNull();
  });

  it("jwt callback handles update trigger", async () => {
    const token = await authOptions.callbacks.jwt({
      token: { avatarUrl: "https://example.com/old.png" },
      trigger: "update",
      session: { avatarUrl: "https://example.com/new.png" },
    });
    expect(token.avatarUrl).toBe("https://example.com/new.png");
  });

  it("session callback propagates fields to session object", async () => {
    const session = await authOptions.callbacks.session({
      session: { user: {} },
      token: {
        role: "admin",
        employeeId: 1,
        firstName: "Jack",
        lastName: "Mors",
        position: "Admin",
        status: "Active",
        driverStatus: null,
        avatarUrl: "https://example.com/avatar.jpg",
        authVersion: 1,
        sessionId: "123",
      },
    });
    expect(session.user.role).toBe("admin");
    expect(session.user.avatarUrl).toBe("https://example.com/avatar.jpg");
    expect(session.user.image).toBe("https://example.com/avatar.jpg");
  });
});
