"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import { createVehicle, updateVehicle, getVehicle, getVehicleCategories } from "@/services/vehicle.service";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/toast";

const vehicleSchema = z.object({
  plate_number: z.string().min(1, "Plate number is required"),
  vehicle_name: z.string().min(1, "Vehicle name is required"),
  model: z.string().optional(),
  manufacturer: z.string().optional(),
  year: z.coerce.number().optional(),
  color: z.string().optional(),
  fuel_type: z.string().default("Gasoline"),
  seating_capacity: z.coerce.number().min(1).default(4),
  category_id: z.coerce.number().optional(),
  vehicle_status: z.string().default("Available"),
  purchase_price: z.coerce.number().optional(),
  purchase_date: z.string().optional(),
  insurance_expiry: z.string().optional(),
  registration_expiry: z.string().optional(),
  license_plate_expiry: z.string().optional(),
  next_service_date: z.string().optional(),
  next_service_mileage: z.coerce.number().optional(),
});

export default function EditVehiclePage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const vehicleId = Number(params.id);

  const { data: vehicle } = useQuery({
    queryKey: ["vehicle", vehicleId],
    queryFn: () => getVehicle(vehicleId),
    enabled: !!vehicleId,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["vehicle-categories"],
    queryFn: () => getVehicleCategories(),
  });

  const form = useForm({
    resolver: zodResolver(vehicleSchema),
    values: vehicle ? {
      plate_number: vehicle.plate_number || "",
      vehicle_name: vehicle.vehicle_name || "",
      model: vehicle.model || "",
      manufacturer: vehicle.manufacturer || "",
      year: vehicle.year || new Date().getFullYear(),
      color: vehicle.color || "",
      fuel_type: vehicle.fuel_type || "Gasoline",
      seating_capacity: vehicle.seating_capacity || 4,
      category_id: vehicle.category_id || undefined,
      vehicle_status: vehicle.vehicle_status || "Available",
      purchase_price: vehicle.purchase_price || undefined,
      purchase_date: vehicle.purchase_date || undefined,
      insurance_expiry: vehicle.insurance_expiry || undefined,
      registration_expiry: vehicle.registration_expiry || undefined,
      license_plate_expiry: vehicle.license_plate_expiry || undefined,
      next_service_date: vehicle.next_service_date || undefined,
      next_service_mileage: vehicle.next_service_mileage || undefined,
    } : undefined,
  });

  const [submitError, setSubmitError] = useState("");

  const updateMutation = useMutation({
    mutationFn: (data) => updateVehicle(vehicleId, data),
    onSuccess: () => {
      toast.success("Vehicle updated");
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
      router.push(`/fleet/vehicles/${vehicleId}`);
    },
    onError: (err) => {
      setSubmitError(err.message || "Failed to update vehicle");
    },
  });

  const onSubmit = (data) => updateMutation.mutate(data);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Edit Vehicle</h1>
          <p className="text-foreground-secondary mt-1">Editing {vehicle?.plate_number || "vehicle"}</p>
        </div>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-6">
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            {submitError && (
              <div className="p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger">
                {submitError}
              </div>
            )}

            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3">General Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="plate_number">Plate Number *</Label>
                  <Input id="plate_number" {...form.register("plate_number")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="vehicle_name">Vehicle Name *</Label>
                  <Input id="vehicle_name" {...form.register("vehicle_name")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="manufacturer">Manufacturer</Label>
                  <Input id="manufacturer" {...form.register("manufacturer")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="model">Model</Label>
                  <Input id="model" {...form.register("model")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="year">Year</Label>
                  <Input id="year" type="number" {...form.register("year")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="color">Color</Label>
                  <Input id="color" {...form.register("color")} />
                </div>
              </div>
            </div>

            <div className="border-t border-border pt-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">Classification</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="category_id">Category</Label>
                  <select id="category_id" {...form.register("category_id")} className="flex h-10 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm">
                    <option value="">Select category</option>
                    {categories.map((cat) => (
                      <option key={cat.category_id} value={cat.category_id}>{cat.category_name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="fuel_type">Fuel Type</Label>
                  <select id="fuel_type" {...form.register("fuel_type")} className="flex h-10 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm">
                    <option value="Gasoline">Gasoline</option>
                    <option value="Diesel">Diesel</option>
                    <option value="Electric">Electric</option>
                    <option value="Hybrid">Hybrid</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="seating_capacity">Seating Capacity</Label>
                  <Input id="seating_capacity" type="number" {...form.register("seating_capacity")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="vehicle_status">Status</Label>
                  <select id="vehicle_status" {...form.register("vehicle_status")} className="flex h-10 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm">
                    <option value="Available">Available</option>
                    <option value="In Use">In Use</option>
                    <option value="Under Maintenance">Under Maintenance</option>
                    <option value="Out of Service">Out of Service</option>
                    <option value="Reserved">Reserved</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="border-t border-border pt-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">Financial & Compliance</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <div className="space-y-1.5">
                  <Label htmlFor="purchase_date">Purchase Date</Label>
                  <Input id="purchase_date" type="date" {...form.register("purchase_date")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="purchase_price">Purchase Price (₱)</Label>
                  <Input id="purchase_price" type="number" {...form.register("purchase_price")} />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="insurance_expiry">Insurance Expiry</Label>
                  <Input id="insurance_expiry" type="date" {...form.register("insurance_expiry")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="registration_expiry">Registration Expiry</Label>
                  <Input id="registration_expiry" type="date" {...form.register("registration_expiry")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="license_plate_expiry">License Plate Expiry</Label>
                  <Input id="license_plate_expiry" type="date" {...form.register("license_plate_expiry")} />
                </div>
              </div>
            </div>

            <div className="border-t border-border pt-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">Service Schedule</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="next_service_date">Next Service Date</Label>
                  <Input id="next_service_date" type="date" {...form.register("next_service_date")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="next_service_mileage">Next Service Mileage</Label>
                  <Input id="next_service_mileage" type="number" {...form.register("next_service_mileage")} />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Update Vehicle
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
