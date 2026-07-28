"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { getVehicle, deleteVehicle } from "@/services/vehicle.service";
import { ArrowLeft, Pencil, Archive, Truck, Fuel, Gauge, CalendarDays, Wrench, Shield, FileText } from "lucide-react";
import { formatDate, formatNumber, formatCurrency } from "@/lib/utils";

const statusVariant = {
  Available: "success",
  "In Use": "warning",
  "Under Maintenance": "danger",
  "Out of Service": "danger",
  Reserved: "default",
};

export default function VehicleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const vehicleId = Number(params.id);

  const { data: vehicle, isLoading } = useQuery({
    queryKey: ["vehicle", vehicleId],
    queryFn: () => getVehicle(vehicleId),
    enabled: !!vehicleId,
  });

  const archiveMutation = useMutation({
    mutationFn: () => deleteVehicle(vehicleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      router.push("/fleet/vehicles");
    },
  });

  const [archiveOpen, setArchiveOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/3" />
          <div className="h-48 bg-muted rounded-xl" />
          <div className="grid grid-cols-3 gap-4">
            <div className="h-24 bg-muted rounded-xl" />
            <div className="h-24 bg-muted rounded-xl" />
            <div className="h-24 bg-muted rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div className="text-center py-12 text-foreground-muted">
        <Truck className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p className="text-lg font-medium">Vehicle not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">{vehicle.plate_number}</h1>
              <Badge variant={statusVariant[vehicle.vehicle_status] || "default"}>
                {vehicle.vehicle_status}
              </Badge>
            </div>
            <p className="text-foreground-secondary mt-1">{vehicle.vehicle_name} · {vehicle.model} · {vehicle.year}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => router.push(`/fleet/vehicles/${vehicleId}/edit`)}>
            <Pencil className="w-4 h-4 mr-2" />
            Edit
          </Button>
          <Button variant="outline" size="sm" className="text-danger border-danger/20 hover:bg-danger/10" onClick={() => setArchiveOpen(true)} disabled={archiveMutation.isPending}>
            <Archive className="w-4 h-4 mr-2" />
            {archiveMutation.isPending ? "Archiving..." : "Archive"}
          </Button>
          <ConfirmDialog
            open={archiveOpen}
            onOpenChange={setArchiveOpen}
            title="Archive Vehicle?"
            message="This vehicle will be hidden from active lists. You can restore it later."
            confirmLabel="Archive"
            variant="archive"
            onConfirm={() => archiveMutation.mutate()}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 text-center">
            <Fuel className="w-5 h-5 mx-auto mb-2 text-foreground-muted" />
            <p className="text-2xl font-bold text-foreground">{vehicle.fuel_level || 0}%</p>
            <p className="text-xs text-foreground-muted">Fuel Level</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 text-center">
            <Gauge className="w-5 h-5 mx-auto mb-2 text-foreground-muted" />
            <p className="text-2xl font-bold text-foreground">{formatNumber(vehicle.mileage || 0)}</p>
            <p className="text-xs text-foreground-muted">Total Mileage (km)</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 text-center">
            <Wrench className="w-5 h-5 mx-auto mb-2 text-foreground-muted" />
            <p className="text-2xl font-bold text-foreground">
              {vehicle.next_service_date ? formatDate(vehicle.next_service_date) : "—"}
            </p>
            <p className="text-xs text-foreground-muted">Next Service</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 text-center">
            <CalendarDays className="w-5 h-5 mx-auto mb-2 text-foreground-muted" />
            <p className="text-2xl font-bold text-foreground">{vehicle.seating_capacity}</p>
            <p className="text-xs text-foreground-muted">Seating Capacity</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="border-0 shadow-sm lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Vehicle Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-y-4 gap-x-8">
              <div>
                <p className="text-xs text-foreground-muted">Plate Number</p>
                <p className="text-sm font-medium text-foreground">{vehicle.plate_number}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted">Vehicle Name</p>
                <p className="text-sm font-medium text-foreground">{vehicle.vehicle_name}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted">Manufacturer</p>
                <p className="text-sm font-medium text-foreground">{vehicle.manufacturer || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted">Model</p>
                <p className="text-sm font-medium text-foreground">{vehicle.model || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted">Year</p>
                <p className="text-sm font-medium text-foreground">{vehicle.year || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted">Color</p>
                <p className="text-sm font-medium text-foreground">{vehicle.color || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted">Category</p>
                <p className="text-sm font-medium text-foreground">{vehicle.vehiclecategories?.category_name || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted">Fuel Type</p>
                <p className="text-sm font-medium text-foreground">{vehicle.fuel_type}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted">Purchase Date</p>
                <p className="text-sm font-medium text-foreground">{vehicle.purchase_date ? formatDate(vehicle.purchase_date) : "—"}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted">Purchase Price</p>
                <p className="text-sm font-medium text-foreground">{vehicle.purchase_price ? formatCurrency(vehicle.purchase_price) : "—"}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted">Branch</p>
                <p className="text-sm font-medium text-foreground">{vehicle.branches?.branch_name || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted">Status</p>
                <Badge variant={statusVariant[vehicle.vehicle_status] || "default"} className="text-xs">
                  {vehicle.vehicle_status}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Documents & Compliance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
              <div className="flex items-center gap-3">
                <Shield className="w-4 h-4 text-primary" />
                <div>
                  <p className="text-sm font-medium text-foreground">Insurance</p>
                  <p className="text-xs text-foreground-muted">
                    {vehicle.insurance_expiry ? `Expires ${formatDate(vehicle.insurance_expiry)}` : "Not set"}
                  </p>
                </div>
              </div>
              <Badge variant={vehicle.insurance_expiry && new Date(vehicle.insurance_expiry) > new Date() ? "success" : "danger"} className="text-[10px]">
                {vehicle.insurance_expiry && new Date(vehicle.insurance_expiry) > new Date() ? "Valid" : "Expired"}
              </Badge>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
              <div className="flex items-center gap-3">
                <FileText className="w-4 h-4 text-warning" />
                <div>
                  <p className="text-sm font-medium text-foreground">Registration</p>
                  <p className="text-xs text-foreground-muted">
                    {vehicle.registration_expiry ? `Expires ${formatDate(vehicle.registration_expiry)}` : "Not set"}
                  </p>
                </div>
              </div>
              <Badge variant={vehicle.registration_expiry && new Date(vehicle.registration_expiry) > new Date() ? "success" : "danger"} className="text-[10px]">
                {vehicle.registration_expiry && new Date(vehicle.registration_expiry) > new Date() ? "Valid" : "Expired"}
              </Badge>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
              <div className="flex items-center gap-3">
                <FileText className="w-4 h-4 text-success" />
                <div>
                  <p className="text-sm font-medium text-foreground">License Plate</p>
                  <p className="text-xs text-foreground-muted">
                    {vehicle.license_plate_expiry ? `Expires ${formatDate(vehicle.license_plate_expiry)}` : "Not set"}
                  </p>
                </div>
              </div>
              <Badge variant={vehicle.license_plate_expiry && new Date(vehicle.license_plate_expiry) > new Date() ? "success" : "danger"} className="text-[10px]">
                {vehicle.license_plate_expiry && new Date(vehicle.license_plate_expiry) > new Date() ? "Valid" : "Expired"}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
