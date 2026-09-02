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
    queries: ["vehicles", "driverStats", "reservations", "dispatches", "maintenance", "incidents", "documents", "fuelRequests"],
    layout: ["attention", "operations-pulse", "fleet-health", "maintenance-incidents"],
  },
  fleet_manager: {
    title: "Fleet Operations",
    description: "Fleet health, maintenance pressure and driver availability.",
    queries: ["vehicles", "drivers", "driverStats", "dispatches", "assignments", "substitutes", "leave", "maintenance", "documents", "fuelRequests"],
    layout: ["readiness", "pair-coverage", "maintenance", "compliance"],
  },
  dispatcher: {
    title: "Transportation Operations",
    description: "The dispatch floor: requests, trips in motion and live position.",
    queries: ["vehicles", "driverStats", "reservations", "dispatches", "locations"],
    layout: ["priority-queue", "timeline", "active-trips", "live-map", "recommendation"],
  },
};

export function getDashboardConfig(role) {
  return DASHBOARD_CONFIGS[role] || DASHBOARD_CONFIGS.admin;
}
