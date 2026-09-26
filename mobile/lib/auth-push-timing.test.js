import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const AUTH_FILE_PATH = fileURLToPath(new URL("./auth.js", import.meta.url));
const LOGIN_FILE_PATH = fileURLToPath(new URL("../app/login.js", import.meta.url));
const PERMISSIONS_SCREEN_PATH = fileURLToPath(new URL("../app/permissions.js", import.meta.url));
const PROFILE_PERMISSIONS_PATH = fileURLToPath(new URL("../app/(app)/profile/permissions.js", import.meta.url));

describe("Auth Push Timing & Structural Isolation", () => {
  describe("Structural Code Contract — auth.js", () => {
    const authSource = readFileSync(AUTH_FILE_PATH, "utf8");

    it("auth.js must not import Notifications from expo-notifications", () => {
      expect(authSource).not.toMatch(/from\s+["']expo-notifications["']/);
      expect(authSource).not.toMatch(/requestPermissionsAsync/);
    });

    it("auth.js must not import requestPushPermission", () => {
      expect(authSource).not.toMatch(/requestPushPermission/);
    });

    it("auth.js must import registerDeviceTokenIfAuthorized and unregisterDeviceToken", () => {
      expect(authSource).toMatch(/import\s+\{[^}]*registerDeviceTokenIfAuthorized[^}]*\}\s+from\s+["']\.\/notifications\/device-token["']/);
      expect(authSource).toMatch(/import\s+\{[^}]*unregisterDeviceToken[^}]*\}\s+from\s+["']\.\/notifications\/device-token["']/);
    });

    it("auth.js must NOT import the bare prompting registerDeviceToken", () => {
      const deviceTokenImport = authSource.match(/import\s+\{([^}]+)\}\s+from\s+["']\.\/notifications\/device-token["']/);
      expect(deviceTokenImport).not.toBeNull();
      const importedNames = deviceTokenImport[1].split(",").map((s) => s.trim());
      expect(importedNames).toContain("registerDeviceTokenIfAuthorized");
      expect(importedNames).toContain("unregisterDeviceToken");
      expect(importedNames).not.toContain("registerDeviceToken");
    });

    it("signIn must invoke registerDeviceTokenIfAuthorized and not bare registerDeviceToken", () => {
      expect(authSource).toMatch(/registerDeviceTokenIfAuthorized\(\)/);
    });

    it("session restore on cold-start must invoke registerDeviceTokenIfAuthorized", () => {
      expect(authSource).toContain("registerDeviceTokenIfAuthorized();");
    });
  });

  describe("Structural Code Contract — login.js", () => {
    const loginSource = readFileSync(LOGIN_FILE_PATH, "utf8");

    it("login.js must not import Notifications or permission requesting functions", () => {
      expect(loginSource).not.toMatch(/from\s+["']expo-notifications["']/);
      expect(loginSource).not.toMatch(/requestPermissionsAsync/);
      expect(loginSource).not.toMatch(/requestPushPermission/);
      expect(loginSource).not.toMatch(/registerDeviceToken/);
    });

    it("handlePostLogin navigates based strictly on consent version without requesting permissions", () => {
      expect(loginSource).toContain('router.replace("/consent")');
      expect(loginSource).toContain('router.replace("/")');
    });
  });

  describe("Structural Code Contract — permissions.js (onboarding)", () => {
    const permissionsSource = readFileSync(PERMISSIONS_SCREEN_PATH, "utf8");

    it("permissions.js imports registerDeviceToken", () => {
      expect(permissionsSource).toMatch(/import\s+\{[^}]*registerDeviceToken[^}]*\}\s+from\s+["']\.\.\/lib\/notifications\/device-token["']/);
    });

    it("permissions.js calls registerDeviceToken when notifications permission is granted", () => {
      expect(permissionsSource).toMatch(/key === ["']notifications["']\s*&&\s*result\.status === PERMISSION_STATUS\.GRANTED/);
      expect(permissionsSource).toContain("registerDeviceToken().catch");
    });
  });

  describe("Structural Code Contract — profile/permissions.js (settings)", () => {
    const profilePermSource = readFileSync(PROFILE_PERMISSIONS_PATH, "utf8");

    it("profile/permissions.js imports registerDeviceToken", () => {
      expect(profilePermSource).toMatch(/import\s+\{[^}]*registerDeviceToken[^}]*\}\s+from\s+["'].*\/notifications\/device-token["']/);
    });

    it("togglePushNotifications explicitly requests push permission on toggle ON", () => {
      expect(profilePermSource).toContain("requestPushPermission()");
    });

    it("togglePushNotifications registers device token after permission is granted", () => {
      expect(profilePermSource).toContain("await registerDeviceToken().catch(() => {});");
    });

    it("togglePushNotifications dismisses local notifications and syncs bulk preference on toggle OFF", () => {
      expect(profilePermSource).toContain("dismissAllLocalNotifications()");
      expect(profilePermSource).toContain("syncPushPreference(false)");
    });
  });
});

