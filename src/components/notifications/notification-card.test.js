import { describe, it, expect, vi } from "vitest";
import React from "react";
import {
  NotificationCard,
  NotificationCardSkeleton,
  getNotificationTheme,
  getNotificationBadgeLabel,
} from "./notification-card";

describe("NotificationCard component & helpers", () => {
  describe("getNotificationTheme", () => {
    it("assigns danger tone with AlertCircle to failed inspection notifications", () => {
      const theme = getNotificationTheme({
        type: "Alert",
        title: "Failed Inspection Filed a Vehicle Repair",
        reference_type: "maintenance",
        reference_id: 57,
      });
      expect(theme.tone).toBe("danger");
      expect(theme.iconContainerClass).toContain("#fdebed");
      expect(theme.iconContainerClass).toContain("#e5484d");
      expect(theme.badgeClass).toContain("#fdebed");
    });

    it("assigns warning tone with AlertTriangle to maintenance due notifications", () => {
      const theme = getNotificationTheme({
        type: "Warning",
        title: "Maintenance Due Soon",
        reference_type: "maintenance",
        reference_id: 57,
      });
      expect(theme.tone).toBe("warning");
      expect(theme.iconContainerClass).toContain("#f9f1e3");
      expect(theme.iconContainerClass).toContain("#d97706");
      expect(theme.badgeClass).toContain("#f9f1e3");
    });

    it("assigns success tone to completed events", () => {
      const theme = getNotificationTheme({
        type: "Success",
        title: "Trip Completed",
      });
      expect(theme.tone).toBe("success");
      expect(theme.iconContainerClass).toContain("#ecfdf5");
      expect(theme.iconContainerClass).toContain("#059669");
    });

    it("assigns info tone to dispatch and trip events", () => {
      const theme = getNotificationTheme({
        type: "Dispatch",
        reference_type: "dispatch",
        title: "Dispatch Assigned",
      });
      expect(theme.tone).toBe("info");
      expect(theme.iconContainerClass).toContain("#eff6ff");
      expect(theme.iconContainerClass).toContain("#2563eb");
    });

    it("handles emergency, incident and breakdown titles with danger tone", () => {
      expect(getNotificationTheme({ title: "Incident Report Filed" }).tone).toBe("danger");
      expect(getNotificationTheme({ title: "Vehicle Taken Out of Service" }).tone).toBe("danger");
      expect(getNotificationTheme({ severity: "Critical" }).tone).toBe("danger");
    });

    it("handles document expiry and scheduled maintenance with warning tone", () => {
      expect(getNotificationTheme({ title: "LTO Registration Due Soon" }).tone).toBe("warning");
      expect(getNotificationTheme({ reference_type: "document" }).tone).toBe("warning");
      expect(getNotificationTheme({ severity: "Moderate" }).tone).toBe("warning");
    });
  });

  describe("getNotificationBadgeLabel", () => {
    it("formats uppercase category and reference ID matching reference image", () => {
      expect(
        getNotificationBadgeLabel({
          reference_type: "maintenance",
          reference_id: 57,
        })
      ).toBe("MAINTENANCE #57");
    });

    it("handles dispatch reference", () => {
      expect(
        getNotificationBadgeLabel({
          reference_type: "dispatch",
          reference_id: 104,
        })
      ).toBe("DISPATCH #104");
    });

    it("handles trip reference", () => {
      expect(
        getNotificationBadgeLabel({
          reference_type: "trip",
          reference_id: 82,
        })
      ).toBe("TRIP #82");
    });

    it("handles notification with no reference_id gracefully", () => {
      expect(
        getNotificationBadgeLabel({
          type: "System",
        })
      ).toBe("SYSTEM");
    });
  });

  describe("NotificationCard component elements", () => {
    const sampleAlert = {
      notification_id: 101,
      title: "Failed Inspection Filed a Vehicle Repair",
      message:
        "Work order #57 was created from a failed Pre-Shift inspection (inspection #287) for vehicle #76. Filed for triage — the vehicle remains dispatchable until reviewed.",
      type: "Alert",
      reference_type: "maintenance",
      reference_id: 57,
      is_read: false,
      sent_at: "2026-09-29T08:00:00Z",
    };

    it("returns a valid React element with expected props in standard mode", () => {
      const element = NotificationCard({
        notification: sampleAlert,
        onClick: vi.fn(),
        onMarkAsRead: vi.fn(),
        onDelete: vi.fn(),
      });
      expect(React.isValidElement(element)).toBe(true);
      expect(element.props.role).toBe("button");
      expect(element.props.className).toContain("rounded-[22px]");
      expect(element.props.className).toContain("bg-[#ffffff]");
      expect(element.props.className).toContain("border-[#d7dee7]");
    });

    it("returns null if notification is null", () => {
      expect(NotificationCard({ notification: null })).toBeNull();
    });

    it("returns a valid React element in compact mode", () => {
      const element = NotificationCard({
        notification: sampleAlert,
        compact: true,
      });
      expect(React.isValidElement(element)).toBe(true);
      expect(element.props.className).toContain("rounded-[18px]");
    });

    it("renders skeleton placeholder with specified count", () => {
      const skeleton = NotificationCardSkeleton({ count: 3 });
      expect(React.isValidElement(skeleton)).toBe(true);
      expect(skeleton.props.children).toHaveLength(3);
    });
  });
});
