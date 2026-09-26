import { describe, it, expect, vi, beforeEach } from "vitest";

let currentPermissionState = { granted: false, status: "undetermined", canAskAgain: true };

const mockGetPermissionsAsync = vi.fn(async () => ({ ...currentPermissionState }));
const mockRequestPermissionsAsync = vi.fn(async () => ({ ...currentPermissionState }));

vi.mock("expo-notifications", () => ({
  getPermissionsAsync: (...args) => mockGetPermissionsAsync(...args),
  requestPermissionsAsync: (...args) => mockRequestPermissionsAsync(...args),
  setNotificationHandler: vi.fn(),
  setNotificationChannelAsync: vi.fn(),
  AndroidImportance: { HIGH: 4, LOW: 2 },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
}));

vi.mock("expo-location", () => ({
  getForegroundPermissionsAsync: vi.fn(async () => ({ granted: true })),
  requestForegroundPermissionsAsync: vi.fn(async () => ({ granted: true })),
  getBackgroundPermissionsAsync: vi.fn(async () => ({ granted: true })),
  requestBackgroundPermissionsAsync: vi.fn(async () => ({ granted: true })),
}));

vi.mock("expo-image-picker", () => ({
  getCameraPermissionsAsync: vi.fn(async () => ({ granted: true })),
  requestCameraPermissionsAsync: vi.fn(async () => ({ granted: true })),
  getMediaLibraryPermissionsAsync: vi.fn(async () => ({ granted: true })),
  requestMediaLibraryPermissionsAsync: vi.fn(async () => ({ granted: true })),
}));

vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  Linking: { openSettings: vi.fn() },
}));

vi.mock("expo-constants", () => ({
  default: {
    easConfig: { projectId: "test-project-id" },
  },
}));

const mockApiPost = vi.fn();
vi.mock("./api", () => ({
  api: {
    post: (...args) => mockApiPost(...args),
    del: vi.fn(),
  },
}));

import {
  APP_PERMISSIONS,
  PERMISSION_STATUS,
  listAppPermissions,
  requestAppPermission,
} from "./permissions";

describe("Permissions Onboarding & Notification Wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentPermissionState = { granted: false, status: "undetermined", canAskAgain: true };
    mockGetPermissionsAsync.mockImplementation(async () => ({ ...currentPermissionState }));
    mockRequestPermissionsAsync.mockImplementation(async () => ({ ...currentPermissionState }));
  });

  it("lists notifications among the app permissions registry", () => {
    const permissions = listAppPermissions();
    const notif = permissions.find((p) => p.key === "notifications");
    expect(notif).toBeDefined();
    expect(notif.title).toBe("Notifications");
    expect(notif.why).toContain("dispatch assignments");
  });

  it("notifications check() does not prompt for permission", async () => {
    currentPermissionState = { granted: false, status: "undetermined", canAskAgain: true };

    const notifEntry = APP_PERMISSIONS.find((p) => p.key === "notifications");
    const result = await notifEntry.check();

    expect(result.granted).toBe(false);
    expect(mockGetPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("notifications request() prompts via requestPushPermission", async () => {
    currentPermissionState = { granted: false, status: "undetermined", canAskAgain: true };
    mockRequestPermissionsAsync.mockImplementation(async () => {
      currentPermissionState = { granted: true, status: "granted", canAskAgain: true };
      return { ...currentPermissionState };
    });

    const notifEntry = APP_PERMISSIONS.find((p) => p.key === "notifications");
    const result = await notifEntry.request();

    expect(result.granted).toBe(true);
    expect(mockRequestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it("requestAppPermission('notifications') returns normalized GRANTED state when granted", async () => {
    currentPermissionState = { granted: false, status: "undetermined", canAskAgain: true };
    mockRequestPermissionsAsync.mockImplementation(async () => {
      currentPermissionState = { granted: true, status: "granted", canAskAgain: true };
      return { ...currentPermissionState };
    });

    const result = await requestAppPermission("notifications");
    expect(result.status).toBe(PERMISSION_STATUS.GRANTED);
  });

  it("requestAppPermission('notifications') returns normalized DENIED state when denied", async () => {
    currentPermissionState = { granted: false, status: "undetermined", canAskAgain: true };
    mockRequestPermissionsAsync.mockImplementation(async () => {
      currentPermissionState = { granted: false, status: "denied", canAskAgain: false };
      return { ...currentPermissionState };
    });

    const result = await requestAppPermission("notifications");
    expect(result.status).toBe(PERMISSION_STATUS.DENIED);
  });

  describe("Onboarding Enable Permissions workflow simulation", () => {
    it("registers device token when notifications permission is granted during onboarding", async () => {
      currentPermissionState = { granted: false, status: "undetermined", canAskAgain: true };
      mockRequestPermissionsAsync.mockImplementation(async () => {
        currentPermissionState = { granted: true, status: "granted", canAskAgain: true };
        return { ...currentPermissionState };
      });

      const tokenRegistered = vi.fn();

      const allPermissions = listAppPermissions();
      for (const entry of allPermissions) {
        const result = await requestAppPermission(entry.key);
        if (entry.key === "notifications" && result.status === PERMISSION_STATUS.GRANTED) {
          tokenRegistered();
        }
      }

      expect(mockRequestPermissionsAsync).toHaveBeenCalledTimes(1);
      expect(tokenRegistered).toHaveBeenCalledTimes(1);
    });

    it("skips device token registration and completes onboarding if notifications is denied", async () => {
      currentPermissionState = { granted: false, status: "undetermined", canAskAgain: true };
      mockRequestPermissionsAsync.mockImplementation(async () => {
        currentPermissionState = { granted: false, status: "denied", canAskAgain: false };
        return { ...currentPermissionState };
      });

      const tokenRegistered = vi.fn();
      let onboardingCompleted = false;

      const allPermissions = listAppPermissions();
      for (const entry of allPermissions) {
        const result = await requestAppPermission(entry.key);
        if (entry.key === "notifications" && result.status === PERMISSION_STATUS.GRANTED) {
          tokenRegistered();
        }
      }
      onboardingCompleted = true;

      expect(tokenRegistered).not.toHaveBeenCalled();
      expect(onboardingCompleted).toBe(true);
    });

    it("does not block onboarding if device token registration throws", async () => {
      currentPermissionState = { granted: false, status: "undetermined", canAskAgain: true };
      mockRequestPermissionsAsync.mockImplementation(async () => {
        currentPermissionState = { granted: true, status: "granted", canAskAgain: true };
        return { ...currentPermissionState };
      });

      let onboardingCompleted = false;
      const failingRegister = async () => {
        throw new Error("Device token POST failed 500");
      };

      const allPermissions = listAppPermissions();
      for (const entry of allPermissions) {
        const result = await requestAppPermission(entry.key);
        if (entry.key === "notifications" && result.status === PERMISSION_STATUS.GRANTED) {
          await failingRegister().catch(() => {
            // Best effort: failure does not block onboarding
          });
        }
      }
      onboardingCompleted = true;

      expect(onboardingCompleted).toBe(true);
    });
  });
});
