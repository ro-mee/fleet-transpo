import { describe, expect, it } from "vitest";
import {
  SystemUsageOverviewCard,
  SystemHealthCard,
  AccountPostureCard,
  RecentSystemActivitiesCard,
  RecentErrorsCard,
  RecentSecurityAuditCard,
} from "@/components/dashboard/system-admin-cards";

describe("system-admin-cards", () => {
  it("exports all 6 System Admin dashboard cards as valid React components", () => {
    expect(typeof SystemUsageOverviewCard).toBe("function");
    expect(typeof SystemHealthCard).toBe("function");
    expect(typeof AccountPostureCard).toBe("function");
    expect(typeof RecentSystemActivitiesCard).toBe("function");
    expect(typeof RecentErrorsCard).toBe("function");
    expect(typeof RecentSecurityAuditCard).toBe("function");
  });

  it("renders SystemUsageOverviewCard element cleanly", () => {
    const el = SystemUsageOverviewCard({});
    expect(el).toBeDefined();
    expect(el.type).toBeDefined();
  });

  it("renders SystemHealthCard element cleanly with custom and default services", () => {
    const defaultEl = SystemHealthCard({});
    expect(defaultEl).toBeDefined();

    const customServices = [
      { name: "Custom API", status: "Operational", uptime: "100%" },
    ];
    const customEl = SystemHealthCard({ services: customServices, statusLabel: "All Good" });
    expect(customEl).toBeDefined();
  });

  it("renders AccountPostureCard element cleanly with custom roles and totals", () => {
    const defaultEl = AccountPostureCard({});
    expect(defaultEl).toBeDefined();

    const customRoles = [
      { name: "admin", count: 5, color: "#2563eb" },
      { name: "driver", count: 12, color: "#10b981" },
    ];
    const customEl = AccountPostureCard({
      roles: customRoles,
      totalAccounts: 17,
      disabledRoles: ["guest"],
      disabledExtra: 0,
    });
    expect(customEl).toBeDefined();
  });

  it("renders RecentSystemActivitiesCard element cleanly with custom activities", () => {
    const defaultEl = RecentSystemActivitiesCard({});
    expect(defaultEl).toBeDefined();

    const customActivities = [
      {
        time: "10:00 AM",
        user: "Admin",
        initials: "AD",
        action: "Created",
        actionTone: "green",
        module: "Security",
        details: "Created API key",
      },
    ];
    const customEl = RecentSystemActivitiesCard({ activities: customActivities });
    expect(customEl).toBeDefined();
  });

  it("renders RecentErrorsCard element cleanly with custom errors", () => {
    const defaultEl = RecentErrorsCard({});
    expect(defaultEl).toBeDefined();

    const customErrors = [
      {
        id: "err-test",
        severity: "CRITICAL",
        title: "Test Critical Failure",
        occurrences: 4,
        lastSeen: "10m ago",
      },
    ];
    const customEl = RecentErrorsCard({ errors: customErrors });
    expect(customEl).toBeDefined();
  });

  it("renders RecentSecurityAuditCard element cleanly with custom audit entries", () => {
    const defaultEl = RecentSecurityAuditCard({});
    expect(defaultEl).toBeDefined();

    const customLogs = [
      {
        id: "audit-test",
        type: "security",
        event: "login_success · authentication#99",
        actor: "Admin User",
        time: "Sep 6 · 10:00 AM",
      },
    ];
    const customEl = RecentSecurityAuditCard({ logs: customLogs });
    expect(customEl).toBeDefined();
  });
});

