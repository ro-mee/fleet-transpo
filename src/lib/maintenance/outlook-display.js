import { SERVICE_CODES } from "@/lib/maintenance/service-catalog";
import { can, hasRole } from "@/lib/auth/permissions";

export const serviceName = code => ({ routine: "Routine service", brakes: "Brakes", tires: "Tires" })[code] || "Service";
export function dueLabel(service = {}) {
  if (service.kmToService != null && service.kmToService < 0) return `Mileage overdue by ${Math.abs(service.kmToService).toLocaleString()} km`;
  if (service.effectiveDays < 0) return `${Math.abs(service.effectiveDays)} days overdue`;
  if (service.kmToService === 0 || service.effectiveDays === 0) return "Due now";
  if (service.dataIssues?.includes("missing_mileage")) return "Needs mileage";
  if (service.serviceStatus === "needs_data") return "Needs data";
  if (service.effectiveDays != null) return service.effectiveDays <= 7 ? "Due within 7 days" : `Due in ${service.effectiveDays} days`;
  return "No day estimate";
}
export function outlookRows(predictions = []) {
  return predictions.flatMap(vehicle => {
    // The server selects the primary task; do not recalculate forecast urgency here.
    const primary = vehicle.services.filter(service => service.plan_id === vehicle.primary_service_plan_id);
    const others = vehicle.services.filter(service => service.plan_id !== vehicle.primary_service_plan_id);
    const services = [...primary, ...others].map(service => ({
      key: `plan:${vehicle.vehicle_id}:${service.plan_id}`,
      vehicle, service, kind: "service", label: serviceName(service.service_code),
      order: service.active_work_order,
    }));
    const signals = (vehicle.signals || []).map(signal => ({
      key: `signal:${vehicle.vehicle_id}:${signal.checklist_item_id}`,
      vehicle, signal, kind: "signal", label: "Recurring inspection finding",
      order: signal.active_work_order,
    }));
    const unconfigured = SERVICE_CODES
      .filter(code => !vehicle.services.some(service => service.service_code === code))
      .map(code => ({
        key: `setup:${vehicle.vehicle_id}:${code}`, vehicle, service_code: code,
        kind: "setup", label: serviceName(code),
      }));
    return [...services, ...signals, ...unconfigured];
  });
}
export function outlookPermissions(employee) {
  const staff = hasRole(employee, ["super_admin", "admin", "fleet_manager"]);
  return { schedule: staff && can(employee, "maintenance", "create"), configure: staff && can(employee, "maintenance", "update"), odometer: can(employee, "vehicles", "update"), staff, mechanic: hasRole(employee, "mechanic") };
}
export function workOrderHref(order, permissions) {
  if (!order?.maintenance_id) return null;
  if (permissions.mechanic) return `/mechanic/work-orders/${order.maintenance_id}`;
  return permissions.staff ? `/maintenance?work_order=${order.maintenance_id}` : null;
}
export async function refreshMaintenance(queryClient) {
  await Promise.all(["predictive-maintenance", "maintenance-service-plans", "maintenance", "maintenance-records", "vehicles", "vehicle", "vehicles-for-maintenance", "maintenance-record", "mechanicSummary", "mechanicWorkOrders", "mechanicHistoryStrip", "mechanicPredictive", "mechanic-vehicle-history"].map(key => queryClient.invalidateQueries({ queryKey: [key] })));
}
