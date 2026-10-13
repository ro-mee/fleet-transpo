"use client";

import { Wrench } from "lucide-react";
import { FloatingSelect } from "@/components/ui/field";
import { SelectItem } from "@/components/ui/select";
import { normalizeVehicleId } from "@/lib/maintenance/vehicle-selection";

export default function MaintenanceVehicleSelect({ vehicles, value, onValueChange, error }) {
  return (
    <FloatingSelect
      label="Vehicle"
      icon={Wrench}
      required
      error={error}
      id="vehicle_id"
      value={normalizeVehicleId(value)}
      onValueChange={onValueChange}
      placeholder="Select vehicle"
    >
      {vehicles.map((vehicle) => (
        <SelectItem key={vehicle.vehicle_id} value={normalizeVehicleId(vehicle.vehicle_id)}>
          {vehicle.plate_number} — {vehicle.vehicle_name} ({vehicle.model || "Standard"})
        </SelectItem>
      ))}
    </FloatingSelect>
  );
}
