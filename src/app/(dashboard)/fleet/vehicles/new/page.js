"use client";

import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { createVehicle, updateVehicle, getVehicle, getVehicleCategories } from "@/services/vehicle.service";
import { ArrowLeft, Loader2 } from "lucide-react";

const vehicleSchema = z.object({
  plate_number: z.string().min(1, "Plate number is required"),
  vehicle_name: z.string().min(1, "Vehicle name is required"),
  model: z.string().optional(),
  manufacturer: z.string().optional(),
  year: z.coerce.number().optional(),
  color: z.string().optional(),
  fuel_type: z.string().default("Gasoline"),
  seating_capacity: z.coerce.number().min(1).default(4),
  mileage: z.coerce.number().default(0),
  fuel_level: z.coerce.number().min(0).max(100).default(100),
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

export default function VehicleFormPage({ params }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEdit = params?.id;
  const vehicleId = isEdit ? Number(params.id) : null;

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
    defaultValues: vehicle || {
      plate_number: "",
      vehicle_name: "",
      model: "",
      manufacturer: "",
      year: new Date().getFullYear(),
      color: "",
      fuel_type: "Gasoline",
      seating_capacity: 4,
      mileage: 0,
      fuel_level: 100,
      category_id: "",
      vehicle_status: "Available",
      purchase_price: "",
      purchase_date: "",
      insurance_expiry: "",
      registration_expiry: "",
      license_plate_expiry: "",
      next_service_date: "",
      next_service_mileage: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: createVehicle,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      router.push("/fleet/vehicles");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => updateVehicle(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
      router.push(`/fleet/vehicles/${vehicleId}`);
    },
  });

  const onSubmit = async (data) => {
    if (isEdit) {
      updateMutation.mutate({ id: vehicleId, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {isEdit ? "Edit Vehicle" : "Add New Vehicle"}
          </h1>
          <p className="text-foreground-secondary mt-1">
            {isEdit ? `Editing ${vehicle?.plate_number || "vehicle"}` : "Register a new vehicle to your fleet"}
          </p>
        </div>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Basic Information</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="plate_number">Plate Number *</Label>
                <Input id="plate_number" {...form.register("plate_number")} placeholder="ABC-1234" />
                {form.formState.errors.plate_number && (
                  <p className="text-xs text-danger">{form.formState.errors.plate_number.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="vehicle_name">Vehicle Name *</Label>
                <Input id="vehicle_name" {...form.register("vehicle_name")} placeholder="Toyota HiAce" />
                {form.formState.errors.vehicle_name && (
                  <p className="text-xs text-danger">{form.formState.errors.vehicle_name.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="manufacturer">Manufacturer</Label>
                <Input id="manufacturer" {...form.register("manufacturer")} placeholder="Toyota" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="model">Model</Label>
                <Input id="model" {...form.register("model")} placeholder="HiAce Commuter" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="year">Year</Label>
                <Input id="year" type="number" {...form.register("year")} placeholder="2024" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="color">Color</Label>
                <Input id="color" {...form.register("color")} placeholder="White" />
              </div>
            </div>

            <div className="border-t border-border pt-6">
              <h3 className="text-sm font-semibold text-foreground mb-4">Specifications</h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="category_id">Category</Label>
                  <select
                    id="category_id"
                    {...form.register("category_id")}
                    className="flex h-10 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm"
                  >
                    <option value="">Select category</option>
                    {categories.map((cat) => (
                      <option key={cat.category_id} value={cat.category_id}>
                        {cat.category_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fuel_type">Fuel Type</Label>
                  <select
                    id="fuel_type"
                    {...form.register("fuel_type")}
                    className="flex h-10 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm"
                  >
                    <option value="Gasoline">Gasoline</option>
                    <option value="Diesel">Diesel</option>
                    <option value="Electric">Electric</option>
                    <option value="Hybrid">Hybrid</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="seating_capacity">Seating Capacity</Label>
                  <Input id="seating_capacity" type="number" {...form.register("seating_capacity")} />
                </div>
              </div>
            </div>

            <div className="border-t border-border pt-6">
              <h3 className="text-sm font-semibold text-foreground mb-4">Status & Mileage</h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="vehicle_status">Status</Label>
                  <select
                    id="vehicle_status"
                    {...form.register("vehicle_status")}
                    className="flex h-10 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm"
                  >
                    <option value="Available">Available</option>
                    <option value="In Use">In Use</option>
                    <option value="Under Maintenance">Under Maintenance</option>
                    <option value="Out of Service">Out of Service</option>
                    <option value="Reserved">Reserved</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mileage">Mileage (km)</Label>
                  <Input id="mileage" type="number" {...form.register("mileage")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fuel_level">Fuel Level (%)</Label>
                  <Input id="fuel_level" type="number" min="0" max="100" {...form.register("fuel_level")} />
                </div>
              </div>
            </div>

            <div className="border-t border-border pt-6">
              <h3 className="text-sm font-semibold text-foreground mb-4">Purchase & Financial</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="purchase_date">Purchase Date</Label>
                  <Input id="purchase_date" type="date" {...form.register("purchase_date")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="purchase_price">Purchase Price (₱)</Label>
                  <Input id="purchase_price" type="number" {...form.register("purchase_price")} />
                </div>
              </div>
            </div>

            <div className="border-t border-border pt-6">
              <h3 className="text-sm font-semibold text-foreground mb-4">Compliance Dates</h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="insurance_expiry">Insurance Expiry</Label>
                  <Input id="insurance_expiry" type="date" {...form.register("insurance_expiry")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="registration_expiry">Registration Expiry</Label>
                  <Input id="registration_expiry" type="date" {...form.register("registration_expiry")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="license_plate_expiry">License Plate Expiry</Label>
                  <Input id="license_plate_expiry" type="date" {...form.register("license_plate_expiry")} />
                </div>
              </div>
            </div>

            <div className="border-t border-border pt-6">
              <h3 className="text-sm font-semibold text-foreground mb-4">Service Schedule</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="next_service_date">Next Service Date</Label>
                  <Input id="next_service_date" type="date" {...form.register("next_service_date")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="next_service_mileage">Next Service Mileage</Label>
                  <Input id="next_service_mileage" type="number" {...form.register("next_service_mileage")} />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
              <Button type="button" variant="outline" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                {isEdit ? "Update Vehicle" : "Add Vehicle"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
