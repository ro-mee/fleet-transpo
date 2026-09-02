import { describe, expect, it, beforeEach } from "vitest";
import {
  isValidInternalPath,
  saveReturnTo,
  getAndClearReturnTo,
} from "./return-to";

describe("returnTo open-redirect protection", () => {
  beforeEach(() => {
    const store = new Map();
    globalThis.sessionStorage = {
      getItem: (k) => store.get(k) || null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    };
  });

  it("permits safe internal dashboard routes", () => {
    expect(isValidInternalPath("/dashboard")).toBe(true);
    expect(isValidInternalPath("/fuel/requests/new")).toBe(true);
    expect(isValidInternalPath("/reservations/123?tab=active")).toBe(true);
    expect(isValidInternalPath("/fleet/vehicles?category=SUV&sort=asc")).toBe(true);
  });

  it("rejects open-redirect attempts with external hosts or protocols", () => {
    expect(isValidInternalPath("https://evil.com")).toBe(false);
    expect(isValidInternalPath("http://evil.com")).toBe(false);
    expect(isValidInternalPath("//evil.com")).toBe(false);
    expect(isValidInternalPath("/\\evil.com")).toBe(false);
    expect(isValidInternalPath("javascript:alert(1)")).toBe(false);
    expect(isValidInternalPath("data:text/html,evil")).toBe(false);
  });

  it("rejects loop-back to auth entrypoints", () => {
    expect(isValidInternalPath("/login")).toBe(false);
    expect(isValidInternalPath("/login?reason=expired")).toBe(false);
    expect(isValidInternalPath("/register")).toBe(false);
    expect(isValidInternalPath("/forgot-password")).toBe(false);
    expect(isValidInternalPath("/reset-password")).toBe(false);
  });

  it("rejects malformed inputs, whitespace, and CRLF injections", () => {
    expect(isValidInternalPath("")).toBe(false);
    expect(isValidInternalPath(null)).toBe(false);
    expect(isValidInternalPath(undefined)).toBe(false);
    expect(isValidInternalPath("   ")).toBe(false);
    expect(isValidInternalPath("/dashboard\r\nSet-Cookie: evil")).toBe(false);
  });

  it("saves and retrieves safe returnTo from sessionStorage", () => {
    saveReturnTo("/fuel/requests/new");
    const restored = getAndClearReturnTo("dispatcher");
    expect(restored).toBe("/fuel/requests/new");

    // Must be single-use (cleared after first consumption)
    const secondCall = getAndClearReturnTo("dispatcher");
    expect(secondCall).toBe("/dashboard");
  });

  it("falls back to driver portal for driver role when no return path is stored", () => {
    const defaultRoute = getAndClearReturnTo("driver");
    expect(defaultRoute).toBe("/driver");
  });
});
