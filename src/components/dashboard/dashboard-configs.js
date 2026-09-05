export const DASHBOARD_CONFIGS = {
  system_admin: {
    title: "System Console",
    description: "Platform health, security and configuration at a glance.",
    queries: ["users", "sessions", "notifications", "audit", "activity"],
    layout: ["account-posture", "platform-activity", "audit"],
  },
  admin: {
    title: "Operations Center",
    description: "Live fleet status, trips and requests across the operation.",
    queries: ["reservations", "dispatches", "maintenance", "incidents", "documents", "fuelRequests"],
    layout: ["attention", "operations-pulse", "request-pipeline", "doc-compliance", "maintenance-incidents"],
  },
  fleet_manager: {
    title: "Fleet Operations",
    description: "Fleet health, maintenance pressure and driver availability.",
    queries: ["vehicles", "drivers", "driverStats", "dispatches", "assignments", "substitutes", "leave", "maintenance", "documents", "fuelRequests", "utilization", "driverPerformance"],
    layout: ["readiness", "pair-coverage", "maintenance", "compliance"],
  },
  dispatcher: {
    title: "Transportation Operations",
    description: "The dispatch floor: requests, trips in motion and live position.",
    queries: ["vehicles", "drivers", "driverStats", "reservations", "dispatches", "locations"],
    layout: ["priority-queue", "resource-health", "timeline", "active-trips", "live-map", "recommendation"],
  },
};

export function getDashboardConfig(role) {
  return DASHBOARD_CONFIGS[role] || DASHBOARD_CONFIGS.admin;
}
