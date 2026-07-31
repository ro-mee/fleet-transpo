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
import { scanDocumentWithAi } from "@/services/ai.service";
import { calculateLtoRenewalSchedule } from "@/lib/lto-renewal";
import { ArrowLeft, Loader2, Upload, FileText, CheckCircle2, ShieldCheck, IdCard, ZoomIn, Sparkles, Scan, AlertCircle, Check } from "lucide-react";
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

  // AI Scan State
  const [scanningDocType, setScanningDocType] = useState(null);
  const [scanResult, setScanResult] = useState(null);
  const [scanReviewModalOpen, setScanReviewModalOpen] = useState(false);

  const handleAiScan = async (documentType, fileUrl) => {
    if (!fileUrl) {
      toast.error("Please upload a document scan first before scanning with AI.");
      return;
    }
    setScanningDocType(documentType);
    try {
      let documentText = "";
      try {
        const { createWorker } = await import("tesseract.js");
        const worker = await createWorker("eng");
        const ret = await worker.recognize(fileUrl);
        await worker.terminate();
        documentText = ret.data.text || "";
      } catch (ocrErr) {
        console.warn("Browser Tesseract OCR notice:", ocrErr.message);
      }

      const res = await scanDocumentWithAi({
        document_type: documentType,
        document_text: documentText,
        file_url: fileUrl,
      });
      if (res) {
        setScanResult(res);
        setScanReviewModalOpen(true);
        toast.success(`AI scanned ${documentType.replace('_', ' ')} successfully!`);
      }
    } catch (err) {
      toast.error(err.message || "Failed to scan document with AI");
    } finally {
      setScanningDocType(null);
    }
  };

  const applyAiExtractedData = () => {
    if (!scanResult?.extracted_data) return;
    const data = scanResult.extracted_data;

    if (data.plate_number) form.setValue("plate_number", data.plate_number, { shouldValidate: true });
    if (data.vehicle_type) form.setValue("vehicle_name", data.vehicle_type, { shouldValidate: true });
    else if (data.vehicle_name) form.setValue("vehicle_name", data.vehicle_name, { shouldValidate: true });
    if (data.manufacturer) form.setValue("manufacturer", data.manufacturer);
    if (data.model) form.setValue("model", data.model);
    if (data.year) form.setValue("year", data.year);
    if (data.color) form.setValue("color", data.color);
    if (data.fuel_type) form.setValue("fuel_type", data.fuel_type);
    if (data.seating_capacity) form.setValue("seating_capacity", Number(data.seating_capacity), { shouldValidate: true });
    if (data.insurance_expiry) form.setValue("insurance_expiry", data.insurance_expiry);
    if (data.license_plate_expiry) form.setValue("license_plate_expiry", data.license_plate_expiry);

    if (data.registration_number && scanResult.document_type === "OR_CR") {
      setOrCrDoc((prev) => ({ ...prev, document_number: data.registration_number }));
    }
    if (data.insurance_policy_number && scanResult.document_type === "Insurance") {
      setInsuranceDoc((prev) => ({ ...prev, document_number: data.insurance_policy_number }));
    }

    toast.success("AI extracted document details applied to form!");
    setScanReviewModalOpen(false);
  };

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

  const watchedPlate = form.watch("plate_number");
  const ltoSchedule = calculateLtoRenewalSchedule(watchedPlate || "");

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

    const sanitizedData = {};
    Object.keys(data).forEach((k) => {
      let val = data[k];
      if (val === "" || val === undefined) {
        val = null;
      } else if (typeof val === "number" && isNaN(val)) {
        val = null;
      }
      sanitizedData[k] = val;
    });

    const payload = {
      ...sanitizedData,
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
                      <Label htmlFor="plate_number">Plate No. *</Label>
                      <Input id="plate_number" {...form.register("plate_number")} placeholder="NBO 1234 / ABC-1234" className="font-mono uppercase" />
                      {form.formState.errors.plate_number && (
                        <p className="text-xs text-danger">{form.formState.errors.plate_number.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="vehicle_name">Vehicle Type / Name *</Label>
                      <Input id="vehicle_name" {...form.register("vehicle_name")} placeholder="VAN / SUV / SEDAN / BUS" />
                      {form.formState.errors.vehicle_name && (
                        <p className="text-xs text-danger">{form.formState.errors.vehicle_name.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="manufacturer">Make / Brand</Label>
                      <Input id="manufacturer" {...form.register("manufacturer")} placeholder="TOYOTA / HONDA / MITSUBISHI" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="model">Series / Model</Label>
                      <Input id="model" {...form.register("model")} placeholder="HIACE COMMUTER / L300 / NV350" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="year">Year Model</Label>
                      <Input id="year" type="number" {...form.register("year")} placeholder="2023" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="color">Color</Label>
                      <Input id="color" {...form.register("color")} placeholder="WHITE PEARL / SILVER / BLACK" />
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
                      <Input id="fuel_type" {...form.register("fuel_type")} placeholder="DIESEL / GAS / GASOLINE" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="seating_capacity">Passenger Capacity</Label>
                      <Input id="seating_capacity" type="number" {...form.register("seating_capacity")} placeholder="15" />
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

                {/* Philippine LTO Registration Renewal Schedule & Compliance */}
                <div className="border-t border-border pt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground-secondary mb-3 flex items-center justify-between">
                    <span>LTO Registration Renewal Schedule</span>
                    <span className="text-[10px] text-primary bg-primary/10 px-2 py-0.5 rounded-full font-medium border border-primary/20">
                      Calculated from Plate #
                    </span>
                  </h3>

                  {ltoSchedule?.success ? (
                    <div className="p-3.5 rounded-xl bg-muted/30 border border-border space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-[11px] text-foreground-secondary block">Registration Renewal Window</span>
                          <span className="text-sm font-bold text-foreground">{ltoSchedule.formatted_window}</span>
                        </div>
                        <span
                          className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                            ltoSchedule.status === "Overdue"
                              ? "bg-danger/15 text-danger border border-danger/30"
                              : ltoSchedule.status === "Due This Week" || ltoSchedule.status === "Due in 7 Days"
                              ? "bg-warning/15 text-warning border border-warning/30"
                              : "bg-success/15 text-success border border-success/30"
                          }`}
                        >
                          {ltoSchedule.status}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-border">
                        <div>
                          <span className="text-foreground-secondary block text-[10px]">Renewal Month</span>
                          <span className="font-semibold text-foreground">{ltoSchedule.month} (Digit: {watchedPlate.replace(/\D/g, "").slice(-1)})</span>
                        </div>
                        <div>
                          <span className="text-foreground-secondary block text-[10px]">Renewal Window</span>
                          <span className="font-semibold text-foreground">{ltoSchedule.window_label}</span>
                        </div>
                      </div>
                      <p className="text-[10px] text-foreground-muted italic">
                        Source: Calculated automatically from Plate Number ({watchedPlate}) using PH LTO rules.
                      </p>
                    </div>
                  ) : (
                    <div className="p-3 rounded-xl bg-muted/20 border border-border text-xs text-foreground-secondary italic">
                      {watchedPlate
                        ? ltoSchedule?.error || "Unable to determine renewal schedule from the provided plate number."
                        : "Enter a valid plate number above (e.g. ABC-1234) to compute the LTO registration renewal schedule."}
                    </div>
                  )}

                  <div className="mt-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="insurance_expiry" className="text-xs">Insurance Policy Expiry</Label>
                      <Input id="insurance_expiry" type="date" {...form.register("insurance_expiry")} className="text-xs" />
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
                      <div className="flex gap-2 items-center">
                        <div className="relative flex-1 border-2 border-dashed border-border hover:border-primary/50 rounded-xl p-2 text-center transition-colors bg-surface cursor-pointer">
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
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!orCrDoc.file_url || scanningDocType === "OR_CR"}
                          onClick={() => handleAiScan("OR_CR", orCrDoc.file_url)}
                          className="h-9 px-2.5 text-xs border-primary/30 text-primary hover:bg-primary/5 font-medium gap-1 shrink-0"
                        >
                          {scanningDocType === "OR_CR" ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="w-3.5 h-3.5" />
                          )}
                          <span>Scan with AI</span>
                        </Button>
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

                  {/* 2. Insurance Policy Card (Top Right - Upload Only) */}
                  <div className="p-3.5 rounded-xl bg-muted/30 border border-border space-y-2.5 flex flex-col justify-between">
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <ShieldCheck className="w-4 h-4 text-primary" /> Insurance Policy Scan
                        </span>
                        {insuranceDoc.file_url && (
                          <span className="text-[11px] text-success font-medium flex items-center gap-0.5">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Attached
                          </span>
                        )}
                      </div>
                      <div className="relative border-2 border-dashed border-border hover:border-primary/50 rounded-xl p-3 text-center transition-colors bg-surface cursor-pointer">
                        <input
                          type="file"
                          accept="image/*,.pdf"
                          onChange={(e) => handleFileUpload(e, setInsuranceDoc)}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        />
                        <div className="flex items-center justify-center gap-1.5 text-xs text-foreground-secondary">
                          <Upload className="w-3.5 h-3.5 text-primary" />
                          <span className="truncate">{insuranceDoc.file_url ? "Change Policy Scan" : "Upload Insurance Policy Scan"}</span>
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
                      <div className="space-y-2">
                        <div className="relative border-2 border-dashed border-border hover:border-primary/50 rounded-xl p-3 text-center transition-colors bg-surface cursor-pointer">
                          <input
                            type="file"
                            accept="image/*,.pdf"
                            onChange={(e) => handleFileUpload(e, setPlateStickerDoc)}
                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                          />
                          <div className="flex items-center justify-center gap-1.5 text-xs text-foreground-secondary">
                            <Upload className="w-4 h-4 text-primary" />
                            <span>{plateStickerDoc.file_url ? "Change Sticker Photo" : "Upload Plate Sticker Photo"}</span>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!plateStickerDoc.file_url || scanningDocType === "Plate_Sticker"}
                          onClick={() => handleAiScan("Plate_Sticker", plateStickerDoc.file_url)}
                          className="w-full h-8 text-xs border-primary/30 text-primary hover:bg-primary/5 font-medium gap-1"
                        >
                          {scanningDocType === "Plate_Sticker" ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="w-3.5 h-3.5" />
                          )}
                          <span>Scan Plate Sticker with AI</span>
                        </Button>
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

      {/* ── AI Scan Review Modal ── */}
      <Dialog open={scanReviewModalOpen} onOpenChange={setScanReviewModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center justify-between border-b border-border pb-3">
              <span className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary animate-pulse" />
                AI Document Scan Results — Review & Populate
              </span>
              <div className="flex items-center gap-2">
                {scanResult?.is_ai_vision_used ? (
                  <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-success/15 text-success border border-success/30">
                    Live AI Vision OCR
                  </span>
                ) : (
                  <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-primary/15 text-primary border border-primary/30">
                    Dynamic Image Scan
                  </span>
                )}
                {scanResult?.overall_confidence && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-muted text-foreground-secondary border border-border">
                    {scanResult.overall_confidence}% Confidence
                  </span>
                )}
              </div>
            </DialogTitle>
          </DialogHeader>

          {scanResult && (
            <div className="space-y-4 pt-2">
              {/* Validation Banner if any */}
              {scanResult.validation?.issues?.length > 0 && (
                <div className="p-3 rounded-xl bg-danger/10 border border-danger/20 text-xs text-danger flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">Compliance Validation Warnings:</span>
                    <ul className="list-disc list-inside mt-1 space-y-0.5">
                      {scanResult.validation.issues.map((issue, i) => (
                        <li key={i}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* Extracted Fields Table */}
              <div className="rounded-xl border border-border overflow-hidden bg-surface">
                <div className="bg-muted/40 px-4 py-2 border-b border-border flex items-center justify-between text-xs font-semibold text-foreground-secondary">
                  <span>EXTRACTED FIELD</span>
                  <span>CONFIDENCE & AI VALUE</span>
                </div>
                <div className="divide-y divide-border text-xs">
                  {Object.entries(scanResult.extracted_data || {})
                    .filter(([key]) => key !== "vehicle_type")
                    .map(([key, val]) => {
                      const score = scanResult.confidence_scores?.[key] || scanResult.overall_confidence || 95;
                    const customLabels = {
                      seating_capacity: "Passenger Capacity",
                      registration_number: "Registration / CR No.",
                      vehicle_name: "Vehicle Type / Name",
                      manufacturer: "Make / Brand",
                      model: "Series / Model",
                      year: "Year Model",
                    };
                    const label = customLabels[key] || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                    return (
                      <div key={key} className="px-4 py-2.5 flex items-center justify-between hover:bg-muted/20">
                        <span className="font-medium text-foreground-secondary">{label}</span>
                        <div className="flex items-center gap-3">
                          <span className="font-semibold text-foreground">{String(val)}</span>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                              score >= 90
                                ? "bg-success/10 text-success border border-success/20"
                                : "bg-warning/10 text-warning border border-warning/20"
                            }`}
                          >
                            {score}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
                <Button variant="outline" size="sm" onClick={() => setScanReviewModalOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={applyAiExtractedData} className="gap-1.5">
                  <Check className="w-4 h-4" /> Apply Extracted Data to Form
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
