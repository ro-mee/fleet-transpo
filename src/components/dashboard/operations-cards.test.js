import { describe, expect, it } from "vitest";
import {
  DocumentComplianceCard,
  IncidentRiskCard,
  MaintenancePressureCard,
  RequestPipelineCard,
  formatRelativeTime,
} from "@/components/dashboard/operations-cards";

describe("operations-cards", () => {
  describe("formatRelativeTime", () => {
    it("handles null or undefined safely", () => {
      expect(formatRelativeTime(null)).toBe("Recently");
      expect(formatRelativeTime(undefined)).toBe("Recently");
      expect(formatRelativeTime("invalid-date")).toBe("Recently");
    });

    it("formats recent seconds as Just now", () => {
      const now = new Date();
      expect(formatRelativeTime(now.toISOString())).toBe("Just now");
    });

    it("formats minutes correctly", () => {
      const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
      expect(formatRelativeTime(fiveMinsAgo.toISOString())).toBe("5 mins ago");

      const oneMinAgo = new Date(Date.now() - 65 * 1000);
      expect(formatRelativeTime(oneMinAgo.toISOString())).toBe("1 min ago");
    });

    it("formats hours correctly", () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      expect(formatRelativeTime(twoHoursAgo.toISOString())).toBe("2 hours ago");

      const oneHourAgo = new Date(Date.now() - 65 * 60 * 1000);
      expect(formatRelativeTime(oneHourAgo.toISOString())).toBe("1 hour ago");
    });

    it("formats days correctly", () => {
      const oneDayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
      expect(formatRelativeTime(oneDayAgo.toISOString())).toBe("1 day ago");

      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      expect(formatRelativeTime(threeDaysAgo.toISOString())).toBe("3 days ago");
    });
  });

  describe("component exports", () => {
    it("exports all 4 core operations cards as functions", () => {
      expect(typeof RequestPipelineCard).toBe("function");
      expect(typeof DocumentComplianceCard).toBe("function");
      expect(typeof MaintenancePressureCard).toBe("function");
      expect(typeof IncidentRiskCard).toBe("function");
    });
  });
});

