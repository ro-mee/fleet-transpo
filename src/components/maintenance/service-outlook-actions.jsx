"use client";

import MaintenanceFormDialog from "./maintenance-form-dialog";
import ServicePlanDialog from "./service-plan-dialog";
export default function ServiceOutlookActions({action,onClose}) {
  if (action.kind === "schedule") return <MaintenanceFormDialog isOpen onClose={onClose} initialData={{vehicle_id:action.row.vehicle.vehicle_id,service_plan_id:action.row.service.plan_id,expected_version:action.row.service.version,service_code:action.row.service.service_code,maintenance_type:action.row.service.service_code === "routine" ? "Routine" : "Preventive",status:"Scheduled"}} />;
  return <ServicePlanDialog action={action} onClose={onClose} />;
}
