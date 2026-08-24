"use client";

import { useState, useRef } from "react";
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
import { RenewRegistrationDialog } from "@/components/vehicles/renew-registration-dialog";
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
  DollarSign, Hash, Layers, Users, Activity, Camera, Loader2
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
  const fileInputRef = useRef(null);

  const { data: vehicle, isLoading } = useQuery({
    queryKey: ["vehicle", vehicleId],
    queryFn: () => getVehicle(vehicleId),
    enabled: !!vehicleId,
  });

  const archiveMutation = useMutation({
    mutationFn: () => deleteVehicle(vehicleId),
    onSuccess: () => {
      toast.success("Vehicle archived successfully");
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
      router.push("/fleet/vehicles");
    },
    onError: (err) => toast.error(err.message),
  });

  const uploadImageMutation = useMutation({
    mutationFn: async (file) => {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch(`/api/vehicles/${vehicleId}/image`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        const errorMsg = typeof data.error === 'string' ? data.error : (data.error?.message || "Upload failed");
        throw new Error(errorMsg);
      }
      return data;
    },
    onSuccess: () => {
      toast.success("Vehicle image updated successfully!");
      queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
    },
    onError: (err) => {
      toast.error(err.message || "Failed to upload image");
    }
  });

  const handleImageClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image size must be less than 5MB");
      return;
    }
    
    uploadImageMutation.mutate(file);
  };

  if (isLoading) return <DetailSkeleton />;

  if (!vehicle) {
    return (
      <div className="space-y-4 max-w-4xl mx-auto py-12 px-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="rounded-xl">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
        <Card className="border-0 shadow-md text-center p-12 rounded-[24px] bg-surface">
          <CardContent className="space-y-4 flex flex-col items-center">
            <div className="w-20 h-20 rounded-full bg-muted/30 flex items-center justify-center mb-2">
              <Truck className="w-10 h-10 text-foreground-muted" />
            </div>
            <p className="text-xl font-bold text-foreground">Vehicle Record Not Found</p>
            <p className="text-sm text-foreground-secondary max-w-md">This vehicle profile may have been archived or deleted.</p>
            <Button className="mt-6 rounded-xl shadow-sm px-6 h-11" onClick={() => router.push("/fleet/vehicles")}>Back to Vehicles List</Button>
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
    <div className="space-y-6 w-full pb-10">
      {/* ── Top Header Banner Card ── */}
      <div className="relative overflow-hidden bg-surface border border-border/60 p-6 md:p-8 rounded-[24px] shadow-sm">
        {/* Subtle background decoration */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
        
        <div className="relative z-10 space-y-6">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
            <div className="flex items-start gap-5">
              <Button variant="outline" size="icon" className="rounded-2xl shrink-0 border-border/80 shadow-xs hover:bg-muted/50 mt-1" onClick={() => router.push("/fleet/vehicles")}>
                <ArrowLeft className="w-5 h-5 text-foreground-secondary" />
              </Button>
              
              {/* Vehicle Image / Avatar */}
              <div className="relative group cursor-pointer shrink-0 mt-1" onClick={handleImageClick}>
                <div className="w-24 h-24 rounded-2xl bg-muted/40 border-2 border-border/60 overflow-hidden flex items-center justify-center relative shadow-sm transition-all group-hover:border-primary/50 group-hover:shadow-md">
                  {vehicle.image_url ? (
                    <img src={vehicle.image_url} alt={vehicle.plate_number} className="w-full h-full object-cover" />
                  ) : (
                    <Truck className="w-10 h-10 text-foreground-muted/40" />
                  )}
                  
                  {/* Upload Overlay */}
                  <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    {uploadImageMutation.isPending ? (
                      <Loader2 className="w-6 h-6 text-white animate-spin" />
                    ) : (
                      <>
                        <Camera className="w-6 h-6 text-white mb-1" />
                        <span className="text-[10px] text-white font-bold tracking-wider">CHANGE</span>
                      </>
                    )}
                  </div>
                </div>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept="image/jpeg,image/png,image/webp" 
                  onChange={handleFileChange}
                />
              </div>

              <div className="space-y-1.5 mt-1">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-3xl font-black font-data text-foreground uppercase tracking-wider">
                    {vehicle.plate_number}
                  </h1>
                  <StatusBadge status={vehicle.vehicle_status} entity="vehicle" />
                  <span className="bg-primary/10 text-primary text-[11px] font-bold px-3 py-1 rounded-full border border-primary/20 uppercase tracking-wider shadow-xs">
                    {vehicle.vehiclecategories?.category_name || "Vehicle"}
                  </span>
                </div>
                <div className="flex items-center gap-2.5 text-sm text-foreground-secondary flex-wrap font-medium pt-1">
                  <span className="flex items-center gap-1.5"><Car className="w-4 h-4 text-foreground-muted" /> {vehicle.vehicle_name}</span>
                  {(vehicle.manufacturer || vehicle.model) && <span className="text-border text-lg leading-none">•</span>}
                  <span className="flex items-center gap-1.5">
                    {vehicle.manufacturer ? <span className="font-semibold">{vehicle.manufacturer}</span> : ""} 
                    {vehicle.model ? ` ${vehicle.model}` : ""}
                  </span>
                  {vehicle.year && <span className="text-border text-lg leading-none">•</span>}
                  {vehicle.year && <span className="flex items-center gap-1.5"><Calendar className="w-4 h-4 text-foreground-muted" /> {vehicle.year}</span>}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <Button variant="outline" onClick={() => router.push(`/fleet/vehicles/${vehicleId}/edit`)} className="rounded-xl text-xs h-10 px-4 font-semibold shadow-xs border-border/80">
                <Pencil className="w-4 h-4 mr-2" /> Edit Details
              </Button>
              <Button
                variant="outline"
                className="rounded-xl text-xs h-10 px-4 font-semibold text-danger border-danger/20 hover:bg-danger/5 hover:border-danger/40 transition-colors"
                onClick={() => setArchiveOpen(true)}
                disabled={archiveMutation.isPending}
              >
                <Archive className="w-4 h-4 mr-2" />
                {archiveMutation.isPending ? "Archiving..." : "Archive"}
              </Button>
            </div>
          </div>

          {/* Quick High-Contrast Metric Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-5 border-t border-border/40">
            
            <div className="group flex flex-col p-4 rounded-[18px] bg-gradient-to-br from-surface to-muted/20 border border-border/40 shadow-xs hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
              <div className="flex items-center gap-2 mb-2">
                <div className={`p-1.5 rounded-lg ${vehicle.fuel_level < 20 ? "bg-danger/10 text-danger" : vehicle.fuel_level < 50 ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}>
                  <Fuel className="w-4 h-4" />
                </div>
                <span className="text-xs font-semibold text-foreground-secondary uppercase tracking-wider">Fuel Level</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className={`text-xl font-bold ${vehicle.fuel_level < 20 ? "text-danger" : vehicle.fuel_level < 50 ? "text-warning" : "text-success"}`}>{vehicle.fuel_level || 0}</span>
                <span className="text-xs font-medium text-foreground-muted">% Tank</span>
              </div>
            </div>

            <div className="group flex flex-col p-4 rounded-[18px] bg-gradient-to-br from-surface to-muted/20 border border-border/40 shadow-xs hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500">
                  <Gauge className="w-4 h-4" />
                </div>
                <span className="text-xs font-semibold text-foreground-secondary uppercase tracking-wider">Odometer</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold text-foreground font-data">{formatNumber(vehicle.mileage || 0)}</span>
                <span className="text-xs font-medium text-foreground-muted">km</span>
              </div>
            </div>

            <div className="group flex flex-col p-4 rounded-[18px] bg-gradient-to-br from-surface to-muted/20 border border-border/40 shadow-xs hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500">
                  <Wrench className="w-4 h-4" />
                </div>
                <span className="text-xs font-semibold text-foreground-secondary uppercase tracking-wider">Next Service</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-[15px] font-bold text-foreground">{vehicle.next_service_date ? formatDate(vehicle.next_service_date) : "—"}</span>
              </div>
            </div>

            <div className="group flex flex-col p-4 rounded-[18px] bg-gradient-to-br from-surface to-muted/20 border border-border/40 shadow-xs hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-500">
                  <Users className="w-4 h-4" />
                </div>
                <span className="text-xs font-semibold text-foreground-secondary uppercase tracking-wider">Capacity</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold text-foreground">{vehicle.seating_capacity || "—"}</span>
                <span className="text-xs font-medium text-foreground-muted">Seats</span>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* ── Main Details Grid (7 Cols Left / 5 Cols Right) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* ── LEFT COLUMN: Specifications & LTO Schedule (7 Cols) ── */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* Vehicle Information Specifications */}
          <Card className="border border-border/60 shadow-sm rounded-[24px] overflow-hidden transition-all hover:shadow-md">
            <CardHeader className="pb-4 border-b border-border/40 bg-gradient-to-r from-muted/20 to-transparent">
              <CardTitle className="text-base font-bold flex items-center gap-3 text-foreground">
                <div className="p-2 rounded-[12px] bg-primary/10 text-primary shadow-xs">
                  <Car className="w-4 h-4" />
                </div>
                Vehicle Specifications
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/40">
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/40">
                  <div className="p-5 flex flex-col gap-1.5 hover:bg-muted/10 transition-colors">
                    <span className="text-xs font-bold text-foreground-muted uppercase tracking-wider flex items-center gap-1.5"><Hash className="w-3.5 h-3.5" /> Plate Number</span>
                    <span className="text-base font-black font-data text-foreground uppercase">{vehicle.plate_number}</span>
                  </div>
                  <div className="p-5 flex flex-col gap-1.5 hover:bg-muted/10 transition-colors">
                    <span className="text-xs font-bold text-foreground-muted uppercase tracking-wider flex items-center gap-1.5"><Tag className="w-3.5 h-3.5" /> Vehicle Type / Name</span>
                    <span className="text-[15px] font-semibold text-foreground">{vehicle.vehicle_name}</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border/40">
                  <div className="p-5 flex flex-col gap-1.5 hover:bg-muted/10 transition-colors">
                    <span className="text-xs font-bold text-foreground-muted uppercase tracking-wider flex items-center gap-1.5"><Layers className="w-3.5 h-3.5" /> Make / Brand</span>
                    <span className="text-sm font-semibold text-foreground">{vehicle.manufacturer || "—"}</span>
                  </div>
                  <div className="p-5 flex flex-col gap-1.5 hover:bg-muted/10 transition-colors">
                    <span className="text-xs font-bold text-foreground-muted uppercase tracking-wider flex items-center gap-1.5"><Car className="w-3.5 h-3.5" /> Series / Model</span>
                    <span className="text-sm font-semibold text-foreground">{vehicle.model || "—"}</span>
                  </div>
                  <div className="p-5 flex flex-col gap-1.5 hover:bg-muted/10 transition-colors">
                    <span className="text-xs font-bold text-foreground-muted uppercase tracking-wider flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Year Model</span>
                    <span className="text-sm font-semibold text-foreground">{vehicle.year || "—"}</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border/40">
                  <div className="p-5 flex flex-col gap-1.5 hover:bg-muted/10 transition-colors">
                    <span className="text-xs font-bold text-foreground-muted uppercase tracking-wider">Color</span>
                    <span className="text-sm font-semibold text-foreground">{vehicle.color || "—"}</span>
                  </div>
                  <div className="p-5 flex flex-col gap-1.5 hover:bg-muted/10 transition-colors">
                    <span className="text-xs font-bold text-foreground-muted uppercase tracking-wider">Category</span>
                    <span className="text-sm font-semibold text-foreground">{vehicle.vehiclecategories?.category_name || "—"}</span>
                  </div>
                  <div className="p-5 flex flex-col gap-1.5 hover:bg-muted/10 transition-colors">
                    <span className="text-xs font-bold text-foreground-muted uppercase tracking-wider">Fuel Type</span>
                    <span className="text-sm font-semibold text-foreground">{vehicle.fuel_type}</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/40 bg-muted/5">
                  <div className="p-5 flex flex-col gap-1.5 hover:bg-muted/10 transition-colors">
                    <span className="text-xs font-bold text-foreground-muted uppercase tracking-wider flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5" /> Purchase Date</span>
                    <span className="text-sm font-semibold text-foreground">{vehicle.purchase_date ? formatDate(vehicle.purchase_date) : "—"}</span>
                  </div>
                  <div className="p-5 flex flex-col gap-1.5 hover:bg-muted/10 transition-colors">
                    <span className="text-xs font-bold text-foreground-muted uppercase tracking-wider flex items-center gap-1.5"><DollarSign className="w-3.5 h-3.5" /> Purchase Price</span>
                    <span className="text-sm font-semibold text-foreground">{vehicle.purchase_price ? formatCurrency(vehicle.purchase_price) : "—"}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* LTO Renewal Schedule Banner Card */}
          {ltoSchedule?.success && (
            <Card className={`border shadow-sm rounded-[24px] overflow-hidden ${
              ltoSchedule.status === "Overdue"
                ? "bg-gradient-to-r from-danger/10 to-danger/5 border-danger/20"
                : ltoSchedule.status === "Due This Week" || ltoSchedule.status === "Due in 7 Days"
                ? "bg-gradient-to-r from-warning/10 to-warning/5 border-warning/20"
                : "bg-gradient-to-r from-success/10 to-success/5 border-success/20"
            }`}>
              <CardHeader className={`pb-4 border-b ${
                ltoSchedule.status === "Overdue" ? "border-danger/10" : ltoSchedule.status.includes("Due") ? "border-warning/10" : "border-success/10"
              }`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <CardTitle className={`text-base font-bold flex items-center gap-3 ${
                     ltoSchedule.status === "Overdue" ? "text-danger" : ltoSchedule.status.includes("Due") ? "text-warning" : "text-success"
                  }`}>
                    <div className={`p-2 rounded-[12px] shadow-xs ${
                      ltoSchedule.status === "Overdue" ? "bg-danger/10" : ltoSchedule.status.includes("Due") ? "bg-warning/10" : "bg-success/10"
                    }`}>
                      <IdCard className="w-4 h-4" />
                    </div>
                    Philippine LTO Renewal
                  </CardTitle>
                <div className="flex items-center gap-3">
                  <RenewRegistrationDialog
                    canManage={can("vehicles", "update")}
                    vehicleId={vehicleId}
                    currentExpiry={vehicle.registration_expiry ? formatDate(vehicle.registration_expiry) : null}
                    orCrDoc={orCrDoc}
                  />
                  <Badge
                    variant={
                      ltoSchedule.status === "Overdue"
                        ? "danger"
                        : ltoSchedule.status === "Due This Week" || ltoSchedule.status === "Due in 7 Days"
                        ? "warning"
                        : "success"
                    }
                    className="px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider shadow-sm"
                  >
                    {ltoSchedule.status}
                  </Badge>
                </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-black/5 dark:divide-white/5">
                  <div className="p-5 flex flex-col gap-1.5">
                    <span className="text-[11px] font-bold opacity-70 uppercase tracking-wider">Renewal Window</span>
                    <span className="text-[15px] font-bold">{ltoSchedule.formatted_window}</span>
                  </div>
                  <div className="p-5 flex flex-col gap-1.5">
                    <span className="text-[11px] font-bold opacity-70 uppercase tracking-wider">Target Month</span>
                    <span className="text-sm font-semibold">{ltoSchedule.month} (Digit: {vehicle.plate_number.replace(/\D/g, "").slice(-1)})</span>
                  </div>
                  <div className="p-5 flex flex-col gap-1.5">
                    <span className="text-[11px] font-bold opacity-70 uppercase tracking-wider">Schedule</span>
                    <span className="text-sm font-semibold">{ltoSchedule.window_label}</span>
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
          <Card className="border border-border/60 shadow-sm rounded-[24px] overflow-hidden transition-all hover:shadow-md">
            <CardHeader className="pb-4 border-b border-border/40 bg-muted/10">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-bold flex items-center gap-3 text-foreground">
                  <div className="p-2 rounded-[12px] bg-primary/10 text-primary shadow-xs">
                    <FileText className="w-4 h-4" />
                  </div>
                  Compliance Scans
                </CardTitle>
                <Badge variant="outline" className="text-[11px] rounded-full px-2.5 py-0.5 border-border/80 font-semibold bg-surface">
                  {docs.filter((d) => d.file_url).length} Attached
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-5 space-y-5 bg-muted/5">
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
        message={`Are you sure you want to archive ${vehicle.plate_number}? This vehicle will be hidden from active lists.`}
        confirmLabel="Archive vehicle"
        variant="archive"
        onConfirm={() => archiveMutation.mutate()}
        loading={archiveMutation.isPending}
      />

      {/* Enlarged Zoom Preview Modal */}
      <Dialog open={!!previewModalUrl} onOpenChange={() => setPreviewModalUrl(null)}>
        <DialogContent className="max-w-4xl p-0 overflow-hidden bg-surface border-border/80 shadow-2xl rounded-[24px]">
          <DialogHeader className="p-5 border-b border-border/40 bg-muted/20">
            <DialogTitle className="text-base font-bold flex items-center gap-3">
              <div className="p-1.5 rounded-lg bg-primary/10 text-primary shadow-xs">
                <FileImage className="w-4 h-4" />
              </div>
              Document Verification Zoom
            </DialogTitle>
          </DialogHeader>
          <div className="p-4 bg-muted/10">
            <div className="relative flex items-center justify-center max-h-[75vh] overflow-hidden bg-black/5 rounded-[16px] border border-border/60 shadow-inner">
              {previewModalUrl && (
                <img
                  src={previewModalUrl}
                  alt="Document Full Preview"
                  className="w-full h-full object-contain"
                />
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
