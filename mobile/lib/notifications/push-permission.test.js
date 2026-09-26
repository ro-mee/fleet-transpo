import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("react-native", () => ({
  Platform: { OS: "android" },
}));

const mockGetPermissionsAsync = vi.fn();
const mockRequestPermissionsAsync = vi.fn();
const mockGetExpoPushTokenAsync = vi.fn();
const mockSetNotificationHandler = vi.fn();
const mockSetNotificationChannelAsync = vi.fn();

vi.mock("expo-notifications", () => ({
  getPermissionsAsync: (...args) => mockGetPermissionsAsync(...args),
  requestPermissionsAsync: (...args) => mockRequestPermissionsAsync(...args),
  getExpoPushTokenAsync: (...args) => mockGetExpoPushTokenAsync(...args),
  setNotificationHandler: (...args) => mockSetNotificationHandler(...args),
  setNotificationChannelAsync: (...args) => mockSetNotificationChannelAsync(...args),
  AndroidImportance: { HIGH: 4, LOW: 2 },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
}));

vi.mock("expo-constants", () => ({
  default: {
    easConfig: { projectId: "test-project-id" },
  },
}));

const mockApiPost = vi.fn();
const mockApiDel = vi.fn();

vi.mock("../api", () => ({
  api: {
    post: (...args) => mockApiPost(...args),
    del: (...args) => mockApiDel(...args),
  },
}));

import {
  hasPushPermission,
  requestPushPermission,
  getPushToken,
  getPushTokenIfAuthorized,
  initPush,
} from "./push";

import {
  registerDeviceToken,
  registerDeviceTokenIfAuthorized,
  unregisterDeviceToken,
} from "./device-token";

describe("Push notification permissions and token registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("hasPushPermission (check-only, non-prompting)", () => {
    it("returns false and never prompts when status is undetermined", async () => {
      mockGetPermissionsAsync.mockResolvedValueOnce({
        granted: false,
        status: "undetermined",
        canAskAgain: true,
      });

      const result = await hasPushPermission();
      expect(result).toBe(false);
      expect(mockGetPermissionsAsync).toHaveBeenCalledTimes(1);
      expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
    });

    it("returns false and never prompts when status is denied", async () => {
      mockGetPermissionsAsync.mockResolvedValueOnce({
        granted: false,
        status: "denied",
        canAskAgain: false,
      });

      const result = await hasPushPermission();
      expect(result).toBe(false);
      expect(mockGetPermissionsAsync).toHaveBeenCalledTimes(1);
      expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
    });

    it("returns true and never prompts when status is granted", async () => {
      mockGetPermissionsAsync.mockResolvedValueOnce({
        granted: true,
        status: "granted",
      });

      const result = await hasPushPermission();
      expect(result).toBe(true);
      expect(mockGetPermissionsAsync).toHaveBeenCalledTimes(1);
      expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
    });

    it("returns true and never prompts for iOS provisional permission", async () => {
      mockGetPermissionsAsync.mockResolvedValueOnce({
        granted: false,
        ios: { status: 3 }, // IosAuthorizationStatus.PROVISIONAL
      });

      const result = await hasPushPermission();
      expect(result).toBe(true);
      expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
    });
  });

  describe("requestPushPermission (prompting when needed)", () => {
    it("returns true without requesting if permission is already granted", async () => {
      mockGetPermissionsAsync.mockResolvedValueOnce({
        granted: true,
        status: "granted",
      });

      const result = await requestPushPermission();
      expect(result).toBe(true);
      expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
    });

    it("explicitly calls requestPermissionsAsync when permission is undetermined", async () => {
      mockGetPermissionsAsync.mockResolvedValueOnce({
        granted: false,
        status: "undetermined",
      });
      mockRequestPermissionsAsync.mockResolvedValueOnce({
        granted: true,
        status: "granted",
      });

      const result = await requestPushPermission();
      expect(result).toBe(true);
      expect(mockRequestPermissionsAsync).toHaveBeenCalledTimes(1);
    });

    it("returns false when user denies permission", async () => {
      mockGetPermissionsAsync.mockResolvedValueOnce({
        granted: false,
        status: "undetermined",
      });
      mockRequestPermissionsAsync.mockResolvedValueOnce({
        granted: false,
        status: "denied",
      });

      const result = await requestPushPermission();
      expect(result).toBe(false);
      expect(mockRequestPermissionsAsync).toHaveBeenCalledTimes(1);
    });
  });

  describe("getPushToken & getPushTokenIfAuthorized", () => {
    it("getPushToken({ requestPermission: false }) returns null without prompting when undetermined", async () => {
      mockGetPermissionsAsync.mockResolvedValueOnce({
        granted: false,
        status: "undetermined",
      });

      const token = await getPushToken({ requestPermission: false });
      expect(token).toBeNull();
      expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
      expect(mockGetExpoPushTokenAsync).not.toHaveBeenCalled();
    });

    it("getPushToken() defaults to requestPermission: false and does not prompt", async () => {
      mockGetPermissionsAsync.mockResolvedValueOnce({
        granted: false,
        status: "undetermined",
      });

      const token = await getPushToken();
      expect(token).toBeNull();
      expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
    });

    it("getPushTokenIfAuthorized returns null without prompting when denied", async () => {
      mockGetPermissionsAsync.mockResolvedValueOnce({
        granted: false,
        status: "denied",
      });

      const token = await getPushTokenIfAuthorized();
      expect(token).toBeNull();
      expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
    });

    it("getPushTokenIfAuthorized returns token without prompting when already granted", async () => {
      mockGetPermissionsAsync.mockResolvedValueOnce({
        granted: true,
        status: "granted",
      });
      mockGetExpoPushTokenAsync.mockResolvedValueOnce({
        data: "ExponentPushToken[test-token-123]",
      });

      const token = await getPushTokenIfAuthorized();
      expect(token).toBe("ExponentPushToken[test-token-123]");
      expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
      expect(mockGetExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: "test-project-id" });
    });

    it("getPushToken({ requestPermission: true }) prompts when undetermined and returns token if granted", async () => {
      mockGetPermissionsAsync.mockResolvedValueOnce({
        granted: false,
        status: "undetermined",
      });
      mockRequestPermissionsAsync.mockResolvedValueOnce({
        granted: true,
        status: "granted",
      });
      mockGetExpoPushTokenAsync.mockResolvedValueOnce({
        data: "ExponentPushToken[test-token-prompted]",
      });

      const token = await getPushToken({ requestPermission: true });
      expect(token).toBe("ExponentPushToken[test-token-prompted]");
      expect(mockRequestPermissionsAsync).toHaveBeenCalledTimes(1);
    });
  });

  describe("registerDeviceToken & registerDeviceTokenIfAuthorized", () => {
    it("does not register token and never prompts when permission is undetermined", async () => {
      mockGetPermissionsAsync.mockResolvedValueOnce({
        granted: false,
        status: "undetermined",
      });

      const result = await registerDeviceTokenIfAuthorized();
      expect(result).toBeNull();
      expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
      expect(mockApiPost).not.toHaveBeenCalled();
    });

    it("does not register token and never prompts when permission is denied", async () => {
      mockGetPermissionsAsync.mockResolvedValueOnce({
        granted: false,
        status: "denied",
      });

      const result = await registerDeviceToken();
      expect(result).toBeNull();
      expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
      expect(mockApiPost).not.toHaveBeenCalled();
    });

    it("registers token with backend without prompting when permission is already granted", async () => {
      mockGetPermissionsAsync.mockResolvedValueOnce({
        granted: true,
        status: "granted",
      });
      mockGetExpoPushTokenAsync.mockResolvedValueOnce({
        data: "ExponentPushToken[authorized-token]",
      });
      mockApiPost.mockResolvedValueOnce({ ok: true });

      const result = await registerDeviceTokenIfAuthorized();
      expect(result).toBe("ExponentPushToken[authorized-token]");
      expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
      expect(mockApiPost).toHaveBeenCalledWith("/api/device-tokens", {
        token: "ExponentPushToken[authorized-token]",
        platform: "android",
      });
    });

    it("handles backend API error gracefully without throwing (best effort)", async () => {
      mockGetPermissionsAsync.mockResolvedValueOnce({
        granted: true,
        status: "granted",
      });
      mockGetExpoPushTokenAsync.mockResolvedValueOnce({
        data: "ExponentPushToken[failing-token]",
      });
      mockApiPost.mockRejectedValueOnce(new Error("500 Server error"));

      // Should never throw
      await expect(registerDeviceTokenIfAuthorized()).resolves.toBeNull();
    });
  });

  describe("initPush", () => {
    it("initializes channels and handler without requesting permission", async () => {
      await expect(initPush()).resolves.toBeUndefined();
      expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
    });
  });
});
