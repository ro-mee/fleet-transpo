"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { DocumentScanCard } from "@/components/ui/document-scan-card";
import { DetailSkeleton } from "@/components/ui/skeleton";
import { getVehicle, deleteVehicle } from "@/services/vehicle.service";
import { AssignedVehicleCard } from "@/components/drivers/assigned-vehicle-card";
import { SubstituteDriverCard } from "@/components/drivers/substitute-driver-card";
import { useRoleAccess } from "@/hooks/use-role-access";
import { calculateLtoRenewalSchedule } from "@/lib/lto-renewal";
import {
  ArrowLeft, Pencil, Archive, Truck, Fuel, Gauge,
  CalendarDays, Wrench, Shield, FileText, ZoomIn, IdCard,
  Car, Tag, Calendar, ShieldAlert, CheckCircle2, FileImage, Sparkles,
  DollarSign, Hash, Layers
} from "lucide-react";
import { toast } from "@/components/ui/toast";
import { formatDate, formatNumber, formatCurrency } from "@/lib/utils";
import { useRequireRole } from "@/lib/auth/role-guard";

export default function VehicleDetailPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager"]);
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = useRoleAccess();
  const vehicleId = Number(params.id);

  const [previewModalUrl, setPreviewModalUrl] = useState(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const { data: vehicle, isLoading } = useQuery({
    queryKey: ["vehicle", vehicleId],
    queryFn: () => getVehicle(vehicleId),
    enabled: !!vehicleId,
  });

  const archiveMutation = useMutation({
    mutationFn: () => deleteVehicle(vehicleId),
    onSuccess: () => {
      toast.success("Vehicle archived");
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
      router.push("/fleet/vehicles");
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) return <DetailSkeleton />;

  if (!vehicle) {
    return (
      <div className="space-y-4 max-w-4xl mx-auto py-12">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
        <Card className="border-0 shadow-sm text-center p-12 rounded-2xl">
          <CardContent className="space-y-3">
            <Truck className="w-12 h-12 text-foreground-muted mx-auto opacity-50" />
            <p className="text-lg font-bold text-foreground">Vehicle Record Not Found</p>
            <p className="text-xs text-foreground-secondary">This vehicle profile may have been archived or deleted.</p>
            <Button className="mt-4 rounded-xl" onClick={() => router.push("/fleet/vehicles")}>Back to Vehicles List</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const ltoSchedule = vehicle.plate_number ? calculateLtoRenewalSchedule(vehicle.plate_number) : null;
  const docs = Array.isArray(vehicle.documents) ? vehicle.documents : [];
  const orCrDoc = docs.find((d) => d.document_type === "OR_CR");
  const insuranceDoc = docs.find((d) => d.document_type === "Insurance");

  return (
    <div className="space-y-6 w-full pb-6">
      {/* ── Top Header Banner Card ── */}
      <div className="bg-surface border border-border p-6 rounded-2xl shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="icon" className="rounded-xl shrink-0" onClick={() => router.push("/fleet/vehicles")}>
              <ArrowLeft className="w-5 h-5 text-foreground-secondary" />
            </Button>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold font-data text-foreground uppercase tracking-wide">
                  {vehicle.plate_number}
                </h1>
                <StatusBadge status={vehicle.vehicle_status} entity="vehicle" />
                <span className="bg-primary/10 text-primary text-xs font-semibold px-3 py-0.5 rounded-full border border-primary/20">
                  {vehicle.vehiclecategories?.category_name || "Vehicle Record"}
                </span>
              </div>
              <p className="text-xs text-foreground-secondary mt-1 font-medium">
                {vehicle.vehicle_name} {vehicle.manufacturer ? `· ${vehicle.manufacturer}` : ""} {vehicle.model ? `· ${vehicle.model}` : ""} {vehicle.year ? `(${vehicle.year})` : ""}
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2.5 shrink-0">
            <Button variant="outline" onClick={() => router.push(`/fleet/vehicles/${vehicleId}/edit`)} className="rounded-xl text-xs h-9">
              <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit Vehicle
            </Button>
            <Button
              variant="outline"
              className="rounded-xl text-xs h-9 text-danger border-danger/30 hover:bg-danger/10"
              onClick={() => setArchiveOpen(true)}
              disabled={archiveMutation.isPending}
            >
              <Archive className="w-3.5 h-3.5 mr-1.5" />
              {archiveMutation.isPending ? "Archiving..." : "Archive Vehicle"}
            </Button>
          </div>
        </div>

        {/* Quick High-Contrast Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-border/60">
          <div className="p-3.5 rounded-xl bg-muted/20 border border-border/50 space-y-1">
            <span className="text-[11px] text-foreground-secondary font-medium block">Fuel Tank Level</span>
            <span className="text-sm font-bold text-foreground">{vehicle.fuel_level || 0}% Tank</span>
          </div>
          <div className="p-3.5 rounded-xl bg-muted/20 border border-border/50 space-y-1">
            <span className="text-[11px] text-foreground-secondary font-medium block">Odometer Mileage</span>
            <span className="text-sm font-bold text-foreground">{formatNumber(vehicle.mileage || 0)} km</span>
          </div>
          <div className="p-3.5 rounded-xl bg-muted/20 border border-border/50 space-y-1">
            <span className="text-[11px] text-foreground-secondary font-medium block">Next Maintenance</span>
            <span className="text-sm font-bold text-foreground">{vehicle.next_service_date ? formatDate(vehicle.next_service_date) : "—"}</span>
          </div>
          <div className="p-3.5 rounded-xl bg-muted/20 border border-border/50 space-y-1">
            <span className="text-[11px] text-foreground-secondary font-medium block">Passenger Capacity</span>
            <span className="text-sm font-bold text-foreground">{vehicle.seating_capacity || "—"} Seats</span>
          </div>
        </div>
      </div>

      {/* ── Main Details Grid (7 Cols Left / 5 Cols Right) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* ── LEFT COLUMN: Specifications & LTO Schedule (7 Cols) ── */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* Vehicle Information Specifications */}
          <Card className="border-0 shadow-sm rounded-2xl">
            <CardHeader className="pb-3 border-b border-border/60">
              <CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
                <div className="p-2 rounded-xl bg-primary/10 text-primary">
                  <Car className="w-4 h-4" />
                </div>
                Vehicle Specifications
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-2 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-muted/20 border border-border/40 space-y-1">
                  <span className="text-foreground-secondary block text-[11px]">Plate Number</span>
                  <span className="font-bold font-data text-foreground text-sm uppercase">{vehicle.plate_number}</span>
                </div>
                <div className="p-3 rounded-xl bg-muted/20 border border-border/40 space-y-1">
                  <span className="text-foreground-secondary block text-[11px]">Vehicle Type / Name</span>
                  <span className="font-bold text-foreground text-sm">{vehicle.vehicle_name}</span>
                </div>
                <div className="p-3 rounded-xl bg-muted/20 border border-border/40 space-y-1">
                  <span className="text-foreground-secondary block text-[11px]">Make / Brand</span>
                  <span className="font-semibold text-foreground">{vehicle.manufacturer || "—"}</span>
                </div>
                <div className="p-3 rounded-xl bg-muted/20 border border-border/40 space-y-1">
                  <span className="text-foreground-secondary block text-[11px]">Series / Model</span>
                  <span className="font-semibold text-foreground">{vehicle.model || "—"}</span>
                </div>
                <div className="p-3 rounded-xl bg-muted/20 border border-border/40 space-y-1">
                  <span className="text-foreground-secondary block text-[11px]">Year Model</span>
                  <span className="font-semibold text-foreground">{vehicle.year || "—"}</span>
                </div>
                <div className="p-3 rounded-xl bg-muted/20 border border-border/40 space-y-1">
                  <span className="text-foreground-secondary block text-[11px]">Color</span>
                  <span className="font-semibold text-foreground">{vehicle.color || "—"}</span>
                </div>
                <div className="p-3 rounded-xl bg-muted/20 border border-border/40 space-y-1">
                  <span className="text-foreground-secondary block text-[11px]">Category</span>
                  <span className="font-semibold text-foreground">{vehicle.vehiclecategories?.category_name || "—"}</span>
                </div>
                <div className="p-3 rounded-xl bg-muted/20 border border-border/40 space-y-1">
                  <span className="text-foreground-secondary block text-[11px]">Fuel Type</span>
                  <span className="font-semibold text-foreground">{vehicle.fuel_type}</span>
                </div>
                <div className="p-3 rounded-xl bg-muted/20 border border-border/40 space-y-1">
                  <span className="text-foreground-secondary block text-[11px]">Passenger Capacity</span>
                  <span className="font-semibold text-foreground">{vehicle.seating_capacity || "—"} Passengers</span>
                </div>
                <div className="p-3 rounded-xl bg-muted/20 border border-border/40 space-y-1">
                  <span className="text-foreground-secondary block text-[11px]">Purchase Date</span>
                  <span className="font-semibold text-foreground">{vehicle.purchase_date ? formatDate(vehicle.purchase_date) : "—"}</span>
                </div>
                <div className="p-3 rounded-xl bg-muted/20 border border-border/40 space-y-1 md:col-span-2">
                  <span className="text-foreground-secondary block text-[11px]">Purchase Price</span>
                  <span className="font-semibold text-foreground">{vehicle.purchase_price ? formatCurrency(vehicle.purchase_price) : "—"}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* LTO Renewal Schedule Banner Card */}
          {ltoSchedule?.success && (
            <Card className="border-0 shadow-sm rounded-2xl bg-primary/5 border border-primary/20">
              <CardHeader className="pb-3 border-b border-primary/10">
                <CardTitle className="text-base font-bold flex items-center justify-between text-foreground">
                  <span className="flex items-center gap-2 text-primary">
                    <IdCard className="w-4 h-4" /> Philippine LTO Registration Renewal
                  </span>
                  <Badge
                    variant={
                      ltoSchedule.status === "Overdue"
                        ? "danger"
                        : ltoSchedule.status === "Due This Week" || ltoSchedule.status === "Due in 7 Days"
                        ? "warning"
                        : "success"
                    }
                    className="text-xs rounded-full px-3"
                  >
                    {ltoSchedule.status}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-3 text-xs">
                <div className="flex items-center justify-between border-b border-primary/10 pb-2">
                  <span className="text-foreground-secondary font-medium">Renewal Schedule Window:</span>
                  <span className="font-bold text-foreground text-sm">{ltoSchedule.formatted_window}</span>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="p-3 rounded-xl bg-surface border border-border">
                    <span className="text-foreground-secondary block text-[11px]">Renewal Month</span>
                    <span className="font-bold text-foreground">{ltoSchedule.month} (Digit: {vehicle.plate_number.replace(/\D/g, "").slice(-1)})</span>
                  </div>
                  <div className="p-3 rounded-xl bg-surface border border-border">
                    <span className="text-foreground-secondary block text-[11px]">Renewal Window</span>
                    <span className="font-bold text-foreground">{ltoSchedule.window_label}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── RIGHT COLUMN: Custodian & Document Scans (5 Cols) ── */}
        <div className="lg:col-span-5 space-y-6">
          
          {/* Custodial Pairing Assignment Card */}
          <AssignedVehicleCard
            side="vehicle"
            id={vehicleId}
            canManage={can("driver_assignments", "create")}
          />

          <SubstituteDriverCard
            id={vehicleId}
            canManage={can("substitute_driver_schedules", "create")}
          />

          {/* Compliance Document Scans Card */}
          <Card className="border-0 shadow-sm rounded-2xl">
            <CardHeader className="pb-3 border-b border-border/60">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
                  <FileText className="w-4 h-4 text-primary" /> Vehicle Compliance Scans
                </CardTitle>
                <Badge variant="outline" className="text-xs rounded-full">
                  {docs.filter((d) => d.file_url).length} Attached
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <DocumentScanCard
                title="LTO OR/CR Scan"
                icon={IdCard}
                fileUrl={orCrDoc?.file_url}
                meta={[
                  ...(orCrDoc?.document_number ? [{ label: "Document No", value: orCrDoc.document_number }] : []),
                  ...(ltoSchedule?.formatted_window ? [{ label: "Renewal Window", value: ltoSchedule.formatted_window }] : []),
                ]}
                onPreview={setPreviewModalUrl}
              />
              <DocumentScanCard
                title="Insurance Policy Scan"
                icon={Shield}
                fileUrl={insuranceDoc?.file_url}
                meta={[
                  ...(insuranceDoc?.document_number ? [{ label: "Policy No", value: insuranceDoc.document_number }] : []),
                  ...(vehicle.insurance_expiry ? [{ label: "Expiry Date", value: formatDate(vehicle.insurance_expiry) }] : []),
                ]}
                onPreview={setPreviewModalUrl}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Confirmation Dialog for Archiving */}
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Archive Vehicle Record"
        description="This vehicle will be hidden from active lists. You can restore it later."
        confirmText="Archive Vehicle"
        onConfirm={() => archiveMutation.mutate()}
        loading={archiveMutation.isPending}
      />

      {/* Enlarged Zoom Preview Modal */}
      <Dialog open={!!previewModalUrl} onOpenChange={() => setPreviewModalUrl(null)}>
        <DialogContent className="max-w-3xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" /> Vehicle Document Verification Zoom
            </DialogTitle>
          </DialogHeader>
          <div className="p-2 flex items-center justify-center max-h-[70vh] overflow-auto bg-black/5 rounded-3xl border border-border">
            {previewModalUrl && (
              <img
                src={previewModalUrl}
                alt="Document Full Preview"
                className="max-h-[65vh] w-auto object-contain rounded-lg shadow-md"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
