"use client";

import { useEffect } from "react";

const STORAGE_KEY = "fleetops_status_sync";

export function useVehicleStatusSync() {
  useEffect(() => {
    try {
      const today = new Date().toDateString();
      if (sessionStorage.getItem(STORAGE_KEY) === today) return;
      sessionStorage.setItem(STORAGE_KEY, today);
      fetch("/api/status/sync", { method: "POST" }).catch(() => {});
    } catch {
      fetch("/api/status/sync", { method: "POST" }).catch(() => {});
    }
  }, []);
}
