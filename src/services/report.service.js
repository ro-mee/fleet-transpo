import { apiFetch, buildQuery } from "@/lib/api/client";

export async function getFleetUtilizationReport(from, to) {
  return apiFetch(`/api/reports/fleet-utilization${buildQuery({ from, to })}`);
}

export async function getFuelConsumptionReport(from, to) {
  return apiFetch(`/api/reports/fuel-consumption${buildQuery({ from, to })}`);
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
