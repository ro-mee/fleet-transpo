import { apiFetch, buildQuery } from "@/lib/api/client";

async function getWorkbook(path, fallback) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Export failed (${response.status})`);
  }
  const disposition = response.headers.get("content-disposition") || "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] || fallback;
  return { blob: await response.blob(), filename };
}

export async function getFleetUtilizationReport(from, to) {
  return apiFetch(`/api/reports/fleet-utilization${buildQuery({ from, to })}`);
}

export async function getFuelConsumptionReport(from, to) {
  return apiFetch(`/api/reports/fuel-consumption${buildQuery({ from, to })}`);
}

export async function getFuelConsumptionWorkbook(from, to) {
  return getWorkbook(`/api/reports/fuel-consumption/excel${buildQuery({ from, to })}`, `fuel-consumption-efficiency-${from}-to-${to}.xlsx`);
}

export function getFleetUtilizationWorkbook(from, to) {
  return getWorkbook(`/api/reports/fleet-utilization/excel${buildQuery({ from, to })}`, `fleet-activity-utilization-${from}-to-${to}.xlsx`);
}

export function getMaintenanceWorkbook(from, to) {
  return getWorkbook(`/api/reports/maintenance/excel${buildQuery({ from, to })}`, `maintenance-audit-${from}-to-${to}.xlsx`);
}

export function getDriverPerformanceWorkbook(from, to) {
  return getWorkbook(`/api/reports/driver-performance/excel${buildQuery({ from, to })}`, `driver-performance-${from}-to-${to}.xlsx`);
}

export function getFinancialWorkbook(from, to) {
  return getWorkbook(`/api/reports/financial/excel${buildQuery({ from, to })}`, `financial-summary-${from}-to-${to}.xlsx`);
}

export function getFleetCostWorkbook(from, to) {
  return getWorkbook(`/api/reports/fleet-cost/excel${buildQuery({ from, to })}`, `fleet-cost-${from}-to-${to}.xlsx`);
}

export function getAnalyticsWorkbook(from, to) {
  return getWorkbook(`/api/reports/analytics/excel${buildQuery({ from, to })}`, `fleet-analytics-${from}-to-${to}.xlsx`);
}

export function getTripPerformanceWorkbook(from, to) {
  return getWorkbook(`/api/reports/trip-performance/excel${buildQuery({ from, to })}`, `trip-performance-${from || "all"}-to-${to || "time"}.xlsx`);
}

export function getIncidentWorkbook(from, to) {
  return getWorkbook(`/api/reports/incidents/excel${buildQuery({ from, to })}`, `incident-registry-${from || "all"}-to-${to || "time"}.xlsx`);
}

export async function getMaintenanceReport(from, to) {
  return apiFetch(`/api/reports/maintenance${buildQuery({ from, to })}`);
}

export async function getDriverPerformanceReport(from, to) {
  return apiFetch(`/api/reports/driver-performance${buildQuery({ from, to })}`);
}

export async function getFinancialSummary(from, to) {
  return apiFetch(`/api/reports/financial${buildQuery({ from, to })}`);
}

export async function getFleetCostReport(from, to) {
  return apiFetch(`/api/reports/fleet-cost${buildQuery({ from, to })}`);
}
