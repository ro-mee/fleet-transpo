"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { DocumentScanCard } from "@/components/ui/document-scan-card";
import { getVehicle, deleteVehicle } from "@/services/vehicle.service";
import { calculateLtoRenewalSchedule } from "@/lib/lto-renewal";
import { ArrowLeft, Pencil, Archive, Truck, Fuel, Gauge, CalendarDays, Wrench, Shield, FileText, ZoomIn, IdCard } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { formatDate, formatNumber, formatCurrency } from "@/lib/utils";
import { useRequireRole } from "@/lib/auth/role-guard";

export default function VehicleDetailPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager"]);
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const vehicleId = Number(params.id);

  const [previewModalUrl, setPreviewModalUrl] = useState(null);

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

  const ltoSchedule = vehicle.plate_number ? calculateLtoRenewalSchedule(vehicle.plate_number) : null;
  const docs = Array.isArray(vehicle.documents) ? vehicle.documents : [];
  const orCrDoc = docs.find((d) => d.document_type === "OR_CR");
  const insuranceDoc = docs.find((d) => d.document_type === "Insurance");

  return (
    <div className="space-y-6">
      {/* ── Zoom Preview Modal ── */}
      <Dialog open={!!previewModalUrl} onOpenChange={() => setPreviewModalUrl(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" /> Vehicle Document Full Preview
            </DialogTitle>
          </DialogHeader>
          <div className="p-2 flex items-center justify-center max-h-[70vh] overflow-auto bg-black/5 rounded-xl border border-border">
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

      {/* ── Page Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <p className="font-data text-[11px] font-medium uppercase tracking-widest text-foreground-muted mb-1">
              Fleet
            </p>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">{vehicle.plate_number}</h1>
              <StatusBadge status={vehicle.vehicle_status} entity="vehicle" />
            </div>
            <p className="text-foreground-secondary mt-1">{vehicle.vehicle_name} · {vehicle.model || ""} · {vehicle.year || ""}</p>
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

      {/* ── Top Metric Cards ── */}
      <StatGrid cols={4}>
        <StatCard icon={Fuel} label="Fuel Level" value={`${vehicle.fuel_level || 0}%`} tone="primary" />
        <StatCard icon={Gauge} label="Total Mileage (km)" value={formatNumber(vehicle.mileage || 0)} tone="info" />
        <StatCard icon={Wrench} label="Next Service" value={vehicle.next_service_date ? formatDate(vehicle.next_service_date) : "—"} tone="warning" />
        <StatCard icon={CalendarDays} label="Passenger Capacity" value={vehicle.seating_capacity || "—"} tone="primary" />
      </StatGrid>

      {/* ── Main Details Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Specifications & LTO Renewal Card */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Vehicle Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-y-4 gap-x-8 text-sm">
                <div>
                  <p className="text-xs text-foreground-muted">Plate Number</p>
                  <p className="font-semibold text-foreground font-data">{vehicle.plate_number}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">Vehicle Type / Name</p>
                  <p className="font-medium text-foreground">{vehicle.vehicle_name}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">Make / Brand</p>
                  <p className="font-medium text-foreground">{vehicle.manufacturer || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">Series / Model</p>
                  <p className="font-medium text-foreground">{vehicle.model || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">Year Model</p>
                  <p className="font-medium text-foreground">{vehicle.year || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">Color</p>
                  <p className="font-medium text-foreground">{vehicle.color || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">Category</p>
                  <p className="font-medium text-foreground">{vehicle.vehiclecategories?.category_name || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">Fuel Type</p>
                  <p className="font-medium text-foreground">{vehicle.fuel_type}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">Passenger Capacity</p>
                  <p className="font-medium text-foreground">{vehicle.seating_capacity || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">Purchase Date</p>
                  <p className="font-medium text-foreground">{vehicle.purchase_date ? formatDate(vehicle.purchase_date) : "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">Purchase Price</p>
                  <p className="font-medium text-foreground">{vehicle.purchase_price ? formatCurrency(vehicle.purchase_price) : "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">Registration Renewal Window</p>
                  <p className="font-medium text-foreground">{ltoSchedule?.formatted_window || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">Next Service Mileage</p>
                  <p className="font-medium text-foreground">{vehicle.next_service_mileage ? formatNumber(vehicle.next_service_mileage) : "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">Last Service Date</p>
                  <p className="font-medium text-foreground">{vehicle.last_service_date ? formatDate(vehicle.last_service_date) : "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">Status</p>
                  <StatusBadge status={vehicle.vehicle_status} entity="vehicle" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* LTO Renewal Schedule Card */}
          {ltoSchedule?.success && (
            <Card className="border-0 shadow-sm bg-primary/5 border border-primary/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-primary">
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
                    className="text-xs"
                  >
                    {ltoSchedule.status}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex items-center justify-between border-b border-primary/10 pb-2">
                  <span className="text-foreground-secondary">Renewal Schedule Window:</span>
                  <span className="font-bold text-foreground text-sm">{ltoSchedule.formatted_window}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div>
                    <span className="text-foreground-secondary block text-[11px]">Renewal Month</span>
                    <span className="font-semibold text-foreground">{ltoSchedule.month} (Digit: {vehicle.plate_number.replace(/\D/g, "").slice(-1)})</span>
                  </div>
                  <div>
                    <span className="text-foreground-secondary block text-[11px]">Renewal Window</span>
                    <span className="font-semibold text-foreground">{ltoSchedule.window_label}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column: Attached Scans & Documents */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 border-b border-border">
            <CardTitle className="text-base font-semibold flex items-center justify-between">
              <span className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" /> Vehicle Document Scans
              </span>
              <Badge variant="outline" className="text-[11px]">
                {docs.filter((d) => d.file_url).length} Attached
              </Badge>
            </CardTitle>
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
  );
}
