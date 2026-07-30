"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createVehicle, updateVehicle, getVehicle, getVehicleCategories } from "@/services/vehicle.service";
import { ArrowLeft, Loader2, Upload, FileText, CheckCircle2, ShieldCheck, IdCard, ZoomIn } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { useRequireRole } from "@/lib/auth/role-guard";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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

export default function VehicleFormPage({ params }) {
  useRequireRole(["admin", "system_admin", "fleet_manager"]);
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEdit = params?.id;
  const vehicleId = isEdit ? Number(params.id) : null;
  const [submitError, setSubmitError] = useState("");

  // Document File & URL states
  const [orCrDoc, setOrCrDoc] = useState({ file_url: "", document_number: "" });
  const [insuranceDoc, setInsuranceDoc] = useState({ file_url: "", document_number: "" });
  const [plateStickerDoc, setPlateStickerDoc] = useState({ file_url: "" });

  // Zoom Modal
  const [previewModalUrl, setPreviewModalUrl] = useState(null);

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
      vehicle_status: "Available",
      purchase_price: undefined,
      purchase_date: "",
      insurance_expiry: "",
      registration_expiry: "",
      license_plate_expiry: "",
      next_service_date: "",
      next_service_mileage: undefined,
    },
  });

  const createMutation = useMutation({
    mutationFn: createVehicle,
    onSuccess: () => {
      toast.success("Vehicle and attached documents saved successfully");
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      router.push("/fleet/vehicles");
    },
    onError: (err) => {
      setSubmitError(err.message || "Failed to create vehicle");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => updateVehicle(id, data),
    onSuccess: () => {
      toast.success("Vehicle updated successfully");
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
      router.push(`/fleet/vehicles/${vehicleId}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleFileUpload = (e, setter) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setter((prev) => ({ ...prev, file_url: reader.result }));
      };
      reader.readAsDataURL(file);
    }
  };

  const onSubmit = async (data) => {
    const documents = [];

    // Collect LTO OR/CR Document
    if (orCrDoc.file_url || orCrDoc.document_number || data.registration_expiry) {
      documents.push({
        document_type: "OR_CR",
        document_number: orCrDoc.document_number || "LTO OR/CR Scan",
        file_url: orCrDoc.file_url || null,
        expiry_date: data.registration_expiry || null,
        status: "Active",
      });
    }

    // Collect Insurance Policy Document
    if (insuranceDoc.file_url || insuranceDoc.document_number || data.insurance_expiry) {
      documents.push({
        document_type: "Insurance",
        document_number: insuranceDoc.document_number || "Insurance Policy Scan",
        file_url: insuranceDoc.file_url || null,
        expiry_date: data.insurance_expiry || null,
        status: "Active",
      });
    }

    // Collect Plate Sticker Document
    if (plateStickerDoc.file_url || data.license_plate_expiry) {
      documents.push({
        document_type: "Plate_Sticker",
        document_number: "LTO Plate Sticker",
        file_url: plateStickerDoc.file_url || null,
        expiry_date: data.license_plate_expiry || null,
        status: "Active",
      });
    }

    const payload = {
      ...data,
      documents,
    };

    if (isEdit) {
      updateMutation.mutate({ id: vehicleId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6 w-full">
      {/* ── Header ── */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {isEdit ? "Edit Vehicle" : "Add New Vehicle"}
          </h1>
          <p className="text-foreground-secondary mt-1">
            {isEdit ? `Editing ${vehicle?.plate_number || "vehicle"}` : "Register a new vehicle and upload compliance document scans"}
          </p>
        </div>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* ── LEFT COLUMN: Vehicle Details & Specifications (50% Width) ── */}
          <div className="space-y-6">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Vehicle Details & Specifications</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {submitError && (
                  <div className="p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger">
                    {submitError}
                  </div>
                )}

                {/* General Information */}
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground-secondary mb-3">General Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="plate_number">Plate Number *</Label>
                      <Input id="plate_number" {...form.register("plate_number")} placeholder="ABC-1234" className="font-mono" />
                      {form.formState.errors.plate_number && (
                        <p className="text-xs text-danger">{form.formState.errors.plate_number.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="vehicle_name">Vehicle Name *</Label>
                      <Input id="vehicle_name" {...form.register("vehicle_name")} placeholder="Toyota HiAce Commuter" />
                      {form.formState.errors.vehicle_name && (
                        <p className="text-xs text-danger">{form.formState.errors.vehicle_name.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="manufacturer">Manufacturer</Label>
                      <Input id="manufacturer" {...form.register("manufacturer")} placeholder="Toyota" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="model">Model</Label>
                      <Input id="model" {...form.register("model")} placeholder="HiAce Commuter" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="year">Year</Label>
                      <Input id="year" type="number" {...form.register("year")} placeholder="2024" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="color">Color</Label>
                      <Input id="color" {...form.register("color")} placeholder="White" />
                    </div>
                  </div>
                </div>

                {/* Classification */}
                <div className="border-t border-border pt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground-secondary mb-3">Classification</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="category_id">Vehicle Category</Label>
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
                    <div className="space-y-1.5">
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
                    <div className="space-y-1.5">
                      <Label htmlFor="seating_capacity">Seating Capacity</Label>
                      <Input id="seating_capacity" type="number" {...form.register("seating_capacity")} />
                    </div>
                    <div className="space-y-1.5">
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
                  </div>
                </div>

                {/* Expiry Dates & Service Schedule */}
                <div className="border-t border-border pt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground-secondary mb-3">Compliance & Expiry Dates</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="registration_expiry" className="text-xs">LTO OR/CR Expiry</Label>
                      <Input id="registration_expiry" type="date" {...form.register("registration_expiry")} className="text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="insurance_expiry" className="text-xs">Insurance Expiry</Label>
                      <Input id="insurance_expiry" type="date" {...form.register("insurance_expiry")} className="text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="license_plate_expiry" className="text-xs">Plate Validity Expiry</Label>
                      <Input id="license_plate_expiry" type="date" {...form.register("license_plate_expiry")} className="text-xs" />
                    </div>
                  </div>
                </div>

                {/* Form Action Buttons */}
                <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
                  <Button type="button" variant="outline" onClick={() => router.back()}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                    {isEdit ? "Update Vehicle" : "Create Vehicle"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── RIGHT COLUMN: Separate Document Upload & Preview Panel (50% Width) ── */}
          <div className="space-y-6">
            <Card className="border-0 shadow-sm sticky top-6">
              <CardHeader className="pb-3 border-b border-border">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" /> Vehicle Document Scans
                </CardTitle>
                <p className="text-xs text-foreground-secondary mt-0.5">
                  Attach OR/CR, Insurance Policy, and Plate Sticker scans directly to the vehicle record.
                </p>
              </CardHeader>
              <CardContent className="p-4">
                {/* Grid Layout: Top 2 Columns for LTO & Insurance, Bottom Full-Width Row for License Plate Sticker */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* 1. LTO OR/CR Scan Card (Top Left) */}
                  <div className="p-3.5 rounded-xl bg-muted/30 border border-border space-y-2.5 flex flex-col justify-between">
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <IdCard className="w-4 h-4 text-primary" /> LTO OR/CR Scan
                        </span>
                        {orCrDoc.file_url && (
                          <span className="text-[11px] text-success font-medium flex items-center gap-0.5">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Attached
                          </span>
                        )}
                      </div>
                      <Input
                        placeholder="OR/CR # (e.g. 1234-5678)"
                        value={orCrDoc.document_number}
                        onChange={(e) => setOrCrDoc({ ...orCrDoc, document_number: e.target.value })}
                        className="h-8 text-xs"
                      />
                      <div className="relative border-2 border-dashed border-border hover:border-primary/50 rounded-xl p-2 text-center transition-colors bg-surface cursor-pointer">
                        <input
                          type="file"
                          accept="image/*,.pdf"
                          onChange={(e) => handleFileUpload(e, setOrCrDoc)}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        />
                        <div className="flex items-center justify-center gap-1.5 text-xs text-foreground-secondary">
                          <Upload className="w-3.5 h-3.5 text-primary" />
                          <span className="truncate">{orCrDoc.file_url ? "Change OR/CR" : "Upload OR/CR"}</span>
                        </div>
                      </div>
                    </div>

                    {orCrDoc.file_url && (
                      <div
                        className="mt-2 rounded-lg overflow-hidden border border-border bg-black/5 aspect-[16/10] relative group cursor-pointer"
                        onClick={() => setPreviewModalUrl(orCrDoc.file_url)}
                      >
                        <img src={orCrDoc.file_url} alt="OR/CR Preview" className="w-full h-full object-contain" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[11px] font-medium gap-1">
                          <ZoomIn className="w-3.5 h-3.5" /> Zoom
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 2. Insurance Policy Scan Card (Top Right) */}
                  <div className="p-3.5 rounded-xl bg-muted/30 border border-border space-y-2.5 flex flex-col justify-between">
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <ShieldCheck className="w-4 h-4 text-primary" /> Insurance Policy
                        </span>
                        {insuranceDoc.file_url && (
                          <span className="text-[11px] text-success font-medium flex items-center gap-0.5">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Attached
                          </span>
                        )}
                      </div>
                      <Input
                        placeholder="Policy # (e.g. POL-9988)"
                        value={insuranceDoc.document_number}
                        onChange={(e) => setInsuranceDoc({ ...insuranceDoc, document_number: e.target.value })}
                        className="h-8 text-xs"
                      />
                      <div className="relative border-2 border-dashed border-border hover:border-primary/50 rounded-xl p-2 text-center transition-colors bg-surface cursor-pointer">
                        <input
                          type="file"
                          accept="image/*,.pdf"
                          onChange={(e) => handleFileUpload(e, setInsuranceDoc)}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        />
                        <div className="flex items-center justify-center gap-1.5 text-xs text-foreground-secondary">
                          <Upload className="w-3.5 h-3.5 text-primary" />
                          <span className="truncate">{insuranceDoc.file_url ? "Change Policy" : "Upload Policy"}</span>
                        </div>
                      </div>
                    </div>

                    {insuranceDoc.file_url && (
                      <div
                        className="mt-2 rounded-lg overflow-hidden border border-border bg-black/5 aspect-[16/10] relative group cursor-pointer"
                        onClick={() => setPreviewModalUrl(insuranceDoc.file_url)}
                      >
                        <img src={insuranceDoc.file_url} alt="Insurance Preview" className="w-full h-full object-contain" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[11px] font-medium gap-1">
                          <ZoomIn className="w-3.5 h-3.5" /> Zoom
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 3. License Plate Sticker Card (Bottom Full-Width Row) */}
                  <div className="sm:col-span-2 p-3.5 rounded-xl bg-muted/30 border border-border space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        <FileText className="w-4 h-4 text-primary" /> License Plate Renewal Sticker Photo
                      </span>
                      {plateStickerDoc.file_url && (
                        <span className="text-[11px] text-success font-medium flex items-center gap-0.5">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Attached
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                      <div className="relative border-2 border-dashed border-border hover:border-primary/50 rounded-xl p-3 text-center transition-colors bg-surface cursor-pointer">
                        <input
                          type="file"
                          accept="image/*,.pdf"
                          onChange={(e) => handleFileUpload(e, setPlateStickerDoc)}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        />
                        <div className="flex items-center justify-center gap-1.5 text-xs text-foreground-secondary">
                          <Upload className="w-4 h-4 text-primary" />
                          <span>{plateStickerDoc.file_url ? "Change Sticker Photo" : "Upload License Plate Sticker Photo"}</span>
                        </div>
                      </div>

                      {plateStickerDoc.file_url ? (
                        <div
                          className="rounded-lg overflow-hidden border border-border bg-black/5 aspect-[16/9] relative group cursor-pointer"
                          onClick={() => setPreviewModalUrl(plateStickerDoc.file_url)}
                        >
                          <img src={plateStickerDoc.file_url} alt="Plate Sticker Preview" className="w-full h-full object-contain" />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[11px] font-medium gap-1">
                            <ZoomIn className="w-3.5 h-3.5" /> Zoom Photo
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-foreground-muted italic text-center p-2 bg-muted/20 rounded-lg">
                          Upload LTO plate sticker photo for annual renewal compliance.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </form>

      {/* ── Document Zoom Modal ── */}
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
    </div>
  );
}
