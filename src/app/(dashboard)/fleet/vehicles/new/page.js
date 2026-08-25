"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createVehicle, updateVehicle, getVehicle, getVehicleCategories } from "@/services/vehicle.service";
import { scanDocumentWithAi } from "@/services/ai.service";
import { calculateLtoRenewalSchedule } from "@/lib/lto-renewal";
import { toDateInput } from "@/lib/dates";
import {
  Loader2,
  Upload,
  FileText,
  CheckCircle2,
  ShieldCheck,
  IdCard,
  ZoomIn,
  Sparkles,
  Scan,
  AlertCircle,
  Check,
  Car,
  Tag,
  Calendar,
  Wrench,
  ShieldAlert,
  Zap,
  FileImage,
} from "lucide-react";
import { toast } from "@/components/ui/toast";
import { useRequireRole } from "@/lib/auth/role-guard";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { FloatingField, FloatingSelect } from "@/components/ui/field";
import { SelectItem } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { HeroHeader, heroButtonOutlineClass, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { cn } from "@/lib/utils";
import { PageEntrance, CARD_SHADOW } from "@/components/ui/page-entrance";
import { StickyActionBar } from "@/components/ui/sticky-actions";

import { vehicleSchema } from "@/lib/validation/schemas";

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
        toast.success(`AI scanned ${documentType.replace("_", " ")} successfully!`);
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

    // Apply document physical specifications to form (excluding Category and Status)
    if (data.plate_number) form.setValue("plate_number", data.plate_number, { shouldValidate: true });
    if (data.vehicle_type) form.setValue("vehicle_name", data.vehicle_type, { shouldValidate: true });
    else if (data.vehicle_name) form.setValue("vehicle_name", data.vehicle_name, { shouldValidate: true });
    if (data.manufacturer) form.setValue("manufacturer", data.manufacturer, { shouldValidate: true });
    // The form has one combined "Series / Model" field. Prefer the model name and,
    // when the OR/CR carries a distinct series value (e.g. model "HIACE" /
    // series "COMMUTER"), append it so nothing is lost.
    if (data.model || data.series) {
      const model = (data.model || "").trim().toUpperCase();
      const series = (data.series || "").trim().toUpperCase();
      form.setValue("model", series && series !== model ? `${model} ${series}`.trim() : (model || series), {
        shouldValidate: true,
      });
    }
    if (data.year) form.setValue("year", Number(data.year), { shouldValidate: true });
    if (data.color) form.setValue("color", data.color, { shouldValidate: true });
    if (data.fuel_type) form.setValue("fuel_type", data.fuel_type, { shouldValidate: true });
    if (data.seating_capacity) form.setValue("seating_capacity", Number(data.seating_capacity), { shouldValidate: true });

    if (data.registration_number && scanResult.document_type === "OR_CR") {
      setOrCrDoc((prev) => ({ ...prev, document_number: data.registration_number }));
    }
    if (data.insurance_policy_number && scanResult.document_type === "Insurance") {
      setInsuranceDoc((prev) => ({ ...prev, document_number: data.insurance_policy_number }));
    }

    toast.success("Document specifications applied to form!");
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
    defaultValues: {
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
      next_service_date: "",
      next_service_mileage: undefined,
      service_interval_km: undefined,
      service_interval_days: undefined,
    },
  });

  useEffect(() => {
    if (vehicle) {
      form.reset({
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
        purchase_date: toDateInput(vehicle.purchase_date),
        insurance_expiry: toDateInput(vehicle.insurance_expiry),
        next_service_date: toDateInput(vehicle.next_service_date),
        next_service_mileage: vehicle.next_service_mileage || undefined,
        service_interval_km: vehicle.service_interval_km || undefined,
        service_interval_days: vehicle.service_interval_days || undefined,
      });

      if (Array.isArray(vehicle.documents)) {
        const orCr = vehicle.documents.find((d) => d.document_type === "OR_CR");
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating local doc draft from the loaded vehicle record
        if (orCr) setOrCrDoc({ document_number: orCr.document_number || "", file_url: orCr.file_url || "" });

        const ins = vehicle.documents.find((d) => d.document_type === "Insurance");
        if (ins) setInsuranceDoc({ document_number: ins.document_number || "", file_url: ins.file_url || "" });
      }
    }
  }, [vehicle, form]);

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
        toast.success("Document scan attached!");
      };
      reader.readAsDataURL(file);
    }
  };

  const onSubmit = (data) => {
    setSubmitError("");
    const documentsPayload = [];
    if (orCrDoc.file_url || orCrDoc.document_number) {
      documentsPayload.push({
        document_type: "OR_CR",
        document_number: orCrDoc.document_number || "OR-CR-UNSPECIFIED",
        file_url: orCrDoc.file_url || null,
      });
    }
    if (insuranceDoc.file_url || insuranceDoc.document_number || data.insurance_expiry) {
      documentsPayload.push({
        document_type: "Insurance",
        document_number: insuranceDoc.document_number || "INS-POLICY-UNSPECIFIED",
        file_url: insuranceDoc.file_url || null,
        // The API's only expiry key is expiry_date — issue_date/expiration_date
        // were silently dropped, leaving Insurance rows without an expiry.
        expiry_date: data.insurance_expiry || null,
      });
    }

    const payload = { ...data, documents: documentsPayload };
    if (isEdit) {
      updateMutation.mutate({ id: vehicleId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  const formActions = (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => router.push("/fleet/vehicles")}
        className={cn("rounded-xl", heroButtonOutlineClass)}
      >
        Cancel
      </Button>
      <Button
        type="button"
        onClick={form.handleSubmit(onSubmit)}
        disabled={isSubmitting}
        className={cn("rounded-xl px-5 h-10 shadow-xs font-bold", heroButtonPrimaryClass)}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving Vehicle...
          </>
        ) : (
          <>
            <CheckCircle2 className="w-4 h-4 mr-2" /> Save &amp; Register Vehicle
          </>
        )}
      </Button>
    </>
  );

  return (
    <PageEntrance className="space-y-6 w-full pb-28">
      {/* ── Top Hero Header Bar ── */}
      <HeroHeader
        icon={Car}
        title={isEdit ? "Edit Vehicle" : "Add New Vehicle"}
        badge={isEdit ? "Update Vehicle Record" : "Fleet Registration"}
        description={isEdit ? `Editing ${vehicle?.plate_number || "vehicle"}` : "Register a new vehicle and upload compliance document scans."}
        actions={formActions}
      />
      <StickyActionBar>{formActions}</StickyActionBar>

      {submitError && (
        <div className="p-4 rounded-xl bg-danger/10 border border-danger/20 text-sm text-danger flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-danger shrink-0" />
          <span>{submitError}</span>
        </div>
      )}

      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* ── LEFT COLUMN: Vehicle Details & Specifications (7 Cols) ── */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* CARD 1: GENERAL INFORMATION */}
            <Card className={cn("border-0 rounded-3xl overflow-hidden", CARD_SHADOW)}>
              <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
                <CardTitle className="text-sm font-extrabold flex items-center gap-2 text-foreground">
                  <Car className="w-4 h-4 text-primary" />
                  General Information
                </CardTitle>
                <CardDescription className="text-xs">
                  Plate number, make, model, and physical specifications.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2">
                  <FloatingField label="Plate No." icon={Car} required error={form.formState.errors.plate_number?.message}>
                    <input
                      id="plate_number"
                      {...form.register("plate_number")}
                      placeholder="NBO 1234 / ABC-1234"
                      className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/60 py-1 font-data uppercase"
                    />
                  </FloatingField>

                  <FloatingField label="Vehicle Type / Name" icon={Tag} required error={form.formState.errors.vehicle_name?.message}>
                    <input
                      id="vehicle_name"
                      {...form.register("vehicle_name")}
                      placeholder="VAN / SUV / SEDAN / BUS"
                      className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/60 py-1"
                    />
                  </FloatingField>

                  <FloatingField label="Make / Brand" icon={Car}>
                    <input
                      id="manufacturer"
                      {...form.register("manufacturer")}
                      placeholder="TOYOTA / HONDA / MITSUBISHI"
                      className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/60 py-1"
                    />
                  </FloatingField>

                  <FloatingField label="Series / Model" icon={Car}>
                    <input
                      id="model"
                      {...form.register("model")}
                      placeholder="HIACE COMMUTER / L300"
                      className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/60 py-1"
                    />
                  </FloatingField>

                  <FloatingField label="Year Model" icon={Calendar}>
                    <input
                      id="year"
                      type="number"
                      {...form.register("year")}
                      placeholder="2023"
                      className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/60 py-1 font-data"
                    />
                  </FloatingField>

                  <FloatingField label="Color" icon={Sparkles}>
                    <input
                      id="color"
                      {...form.register("color")}
                      placeholder="WHITE PEARL / SILVER"
                      className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/60 py-1"
                    />
                  </FloatingField>
                </div>
              </CardContent>
            </Card>

            {/* CARD 2: CLASSIFICATION & CAPACITY */}
            <Card className={cn("border-0 rounded-3xl overflow-hidden", CARD_SHADOW)}>
              <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
                <CardTitle className="text-sm font-extrabold flex items-center gap-2 text-foreground">
                  <Tag className="w-4 h-4 text-blue-500" />
                  Classification &amp; Capacity
                </CardTitle>
                <CardDescription className="text-xs">
                  Category assignment, passenger seating capacity, and operational status.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2">
                  <Controller
                    control={form.control}
                    name="category_id"
                    render={({ field }) => (
                      <FloatingSelect
                        label="Vehicle Category"
                        icon={Tag}
                        value={field.value?.toString() || ""}
                        onValueChange={(val) => field.onChange(val ? Number(val) : "")}
                        placeholder="Select category"
                      >
                        {categories.map((cat) => (
                          <SelectItem key={cat.category_id} value={cat.category_id.toString()}>
                            {cat.category_name}
                          </SelectItem>
                        ))}
                      </FloatingSelect>
                    )}
                  />

                  <FloatingField label="Fuel Type" icon={Zap}>
                    <input
                      id="fuel_type"
                      {...form.register("fuel_type")}
                      placeholder="DIESEL / GASOLINE"
                      className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/60 py-1"
                    />
                  </FloatingField>

                  <FloatingField label="Passenger Capacity" icon={Tag}>
                    <input
                      id="seating_capacity"
                      type="number"
                      {...form.register("seating_capacity")}
                      placeholder="15"
                      className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/60 py-1 font-data"
                    />
                  </FloatingField>

                  <Controller
                    control={form.control}
                    name="vehicle_status"
                    render={({ field }) => (
                      <FloatingSelect
                        label="Status"
                        icon={AlertCircle}
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <SelectItem value="Available">Available</SelectItem>
                        <SelectItem value="In Use">In Use</SelectItem>
                        <SelectItem value="Under Maintenance">Under Maintenance</SelectItem>
                        <SelectItem value="Out of Service">Out of Service</SelectItem>
                        <SelectItem value="Reserved">Reserved</SelectItem>
                        <SelectItem value="Registration Expired">Registration Expired</SelectItem>
                      </FloatingSelect>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            {/* CARD 3: LTO REGISTRATION & PREVENTIVE MAINTENANCE */}
            <Card className={cn("border-0 rounded-3xl overflow-hidden", CARD_SHADOW)}>
              <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
                <CardTitle className="text-sm font-extrabold flex items-center gap-2 text-foreground">
                  <Calendar className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  LTO Renewal &amp; Maintenance Schedule
                </CardTitle>
                <CardDescription className="text-xs">
                  Automated PH LTO registration window and preventive maintenance intervals.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {/* LTO Schedule Banner */}
                {ltoSchedule?.success ? (
                  <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[11px] text-foreground-secondary block">LTO Registration Renewal Window</span>
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
                        <span className="text-foreground-secondary block text-[11px]">Renewal Month</span>
                        <span className="font-semibold text-foreground">{ltoSchedule.month} (Digit: {watchedPlate.replace(/\D/g, "").slice(-1)})</span>
                      </div>
                      <div>
                        <span className="text-foreground-secondary block text-[11px]">Renewal Window</span>
                        <span className="font-semibold text-foreground">{ltoSchedule.window_label}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-muted/20 border border-border text-xs text-foreground-secondary italic">
                    {watchedPlate
                      ? ltoSchedule?.error || "Unable to determine renewal schedule."
                      : "Enter a valid plate number above (e.g. ABC-1234) to compute the LTO registration renewal schedule."}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 border-t border-border pt-4">
                  <div>
                    <DatePicker
                      id="insurance_expiry"
                      label="Insurance Policy Expiry"
                      value={form.watch("insurance_expiry")}
                      onChange={(val) => form.setValue("insurance_expiry", val)}
                    />
                    <p className="text-[11px] text-foreground-muted mt-1.5">
                      Expired documents are allowed — status will reflect compliance risk.
                    </p>
                  </div>

                  <FloatingField label="Service Interval (km)" icon={Wrench}>
                    <input
                      id="service_interval_km"
                      type="number"
                      {...form.register("service_interval_km")}
                      placeholder="5000"
                      className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden placeholder:text-foreground-muted/60 py-1 font-data"
                    />
                  </FloatingField>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── RIGHT COLUMN: Compliance Document Scans (5 Cols) ── */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* CARD 4: LTO OR/CR DOCUMENT SCAN */}
            <Card className={cn("border-0 rounded-3xl overflow-hidden", CARD_SHADOW)}>
              <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-extrabold flex items-center gap-2 text-foreground">
                    <FileImage className="w-4 h-4 text-primary" /> Official Receipt / CR (OR/CR)
                  </CardTitle>
                  {orCrDoc.file_url && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-primary"
                      onClick={() => setPreviewModalUrl(orCrDoc.file_url)}
                    >
                      <ZoomIn className="w-3.5 h-3.5 mr-1" /> Zoom
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                <div className="p-3.5 rounded-xl bg-surface border border-border space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-primary" /> OR/CR Scan Attachment
                    </Label>
                    {orCrDoc.file_url && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleAiScan("OR_CR", orCrDoc.file_url)}
                        disabled={scanningDocType === "OR_CR"}
                        className="h-8 text-xs font-semibold px-3 bg-info text-white hover:bg-info/90 rounded-xl shadow-xs transition-all flex items-center gap-1.5"
                      >
                        {scanningDocType === "OR_CR" ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin text-white" /> Scanning...
                          </>
                        ) : (
                          <>
                            <Zap className="w-3.5 h-3.5 mr-1 text-white" /> Scan &amp; Auto-Fill OR/CR
                          </>
                        )}
                      </Button>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="relative border-2 border-dashed border-border hover:border-primary/50 rounded-2xl p-4 text-center transition-all bg-muted/20 cursor-pointer group hover:bg-hover hover:shadow-[0_0_0_4px_color-mix(in_srgb,var(--primary)_8%,transparent)]">
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        onChange={(e) => handleFileUpload(e, setOrCrDoc)}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                      <div className="flex flex-col items-center justify-center gap-1.5 text-xs text-foreground-secondary">
                        <Upload className="w-5 h-5 text-primary group-hover:scale-110 transition-transform" />
                        <span className="font-semibold text-foreground">Upload OR/CR Scan</span>
                        <span className="text-[11px] text-foreground-muted">PNG, JPG, PDF up to 10MB</span>
                      </div>
                    </div>

                    <Input
                      placeholder="CR / Registration Number..."
                      value={orCrDoc.document_number}
                      onChange={(e) => setOrCrDoc((prev) => ({ ...prev, document_number: e.target.value }))}
                      className="h-9 text-xs rounded-xl"
                    />
                  </div>
                </div>

                {orCrDoc.file_url ? (
                  <div
                    className="rounded-xl overflow-hidden border border-border bg-black/5 aspect-[16/10] relative group cursor-pointer flex items-center justify-center"
                    onClick={() => setPreviewModalUrl(orCrDoc.file_url)}
                  >
                    <img src={orCrDoc.file_url} alt="OR/CR Document" className="w-full h-full object-contain" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[11px] font-medium gap-1">
                      <ZoomIn className="w-3.5 h-3.5" /> Click to Enlarge
                    </div>
                  </div>
                ) : (
                  <div className="p-6 rounded-2xl bg-muted/20 border border-border text-center text-xs text-foreground-muted">
                    No OR/CR Document Scan Attached
                  </div>
                )}
              </CardContent>
            </Card>

            {/* CARD 5: INSURANCE POLICY DOCUMENT SCAN */}
            <Card className={cn("border-0 rounded-3xl overflow-hidden", CARD_SHADOW)}>
              <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-extrabold flex items-center gap-2 text-foreground">
                    <FileImage className="w-4 h-4 text-primary" /> Insurance Policy Certificate
                  </CardTitle>
                  {insuranceDoc.file_url && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-primary"
                      onClick={() => setPreviewModalUrl(insuranceDoc.file_url)}
                    >
                      <ZoomIn className="w-3.5 h-3.5 mr-1" /> Zoom
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                <div className="p-3.5 rounded-xl bg-surface border border-border space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-primary" /> Insurance Policy Scan
                    </Label>
                    {insuranceDoc.file_url && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleAiScan("Insurance", insuranceDoc.file_url)}
                        disabled={scanningDocType === "Insurance"}
                        className="h-8 text-xs font-semibold px-3 bg-info text-white hover:bg-info/90 rounded-xl shadow-xs transition-all flex items-center gap-1.5"
                      >
                        {scanningDocType === "Insurance" ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin text-white" /> Scanning...
                          </>
                        ) : (
                          <>
                            <Zap className="w-3.5 h-3.5 mr-1 text-white" /> Scan &amp; Auto-Fill Insurance
                          </>
                        )}
                      </Button>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="relative border-2 border-dashed border-border hover:border-primary/50 rounded-2xl p-4 text-center transition-all bg-muted/20 cursor-pointer group hover:bg-hover hover:shadow-[0_0_0_4px_color-mix(in_srgb,var(--primary)_8%,transparent)]">
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        onChange={(e) => handleFileUpload(e, setInsuranceDoc)}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                      <div className="flex flex-col items-center justify-center gap-1.5 text-xs text-foreground-secondary">
                        <Upload className="w-5 h-5 text-primary group-hover:scale-110 transition-transform" />
                        <span className="font-semibold text-foreground">Upload Insurance Scan</span>
                        <span className="text-[11px] text-foreground-muted">PNG, JPG, PDF up to 10MB</span>
                      </div>
                    </div>

                    <Input
                      placeholder="Insurance Policy Number..."
                      value={insuranceDoc.document_number}
                      onChange={(e) => setInsuranceDoc((prev) => ({ ...prev, document_number: e.target.value }))}
                      className="h-9 text-xs rounded-xl"
                    />
                  </div>
                </div>

                {insuranceDoc.file_url ? (
                  <div
                    className="rounded-xl overflow-hidden border border-border bg-black/5 aspect-[16/10] relative group cursor-pointer flex items-center justify-center"
                    onClick={() => setPreviewModalUrl(insuranceDoc.file_url)}
                  >
                    <img src={insuranceDoc.file_url} alt="Insurance Document" className="w-full h-full object-contain" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[11px] font-medium gap-1">
                      <ZoomIn className="w-3.5 h-3.5" /> Click to Enlarge
                    </div>
                  </div>
                ) : (
                  <div className="p-6 rounded-2xl bg-muted/20 border border-border text-center text-xs text-foreground-muted">
                    No Insurance Certificate Scan Attached
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </form>

      {/* ── ENLARGED ZOOM MODAL ── */}
      <Dialog open={!!previewModalUrl} onOpenChange={() => setPreviewModalUrl(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <IdCard className="w-5 h-5 text-primary" /> Document Scan Verification Zoom
            </DialogTitle>
          </DialogHeader>
          <div className="p-2 flex items-center justify-center max-h-[70vh] overflow-auto bg-black/5 rounded-3xl border border-border">
            {previewModalUrl && (
              <img src={previewModalUrl} alt="Document Zoom" className="max-h-[65vh] w-auto object-contain rounded-lg shadow-md" />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── SCAN REVIEW MODAL ── */}
      <Dialog open={scanReviewModalOpen} onOpenChange={setScanReviewModalOpen}>
        <DialogContent className="max-w-md rounded-2xl p-6 border border-border shadow-xl bg-surface">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div className="space-y-1">
              <DialogTitle className="text-base font-bold text-foreground">AI Extracted Document Data</DialogTitle>
              <DialogDescription className="text-xs text-foreground-muted">
                Review extracted fields from your scanned document before applying to form.
              </DialogDescription>
            </div>
          </div>

          <div className="space-y-3 py-3 text-xs">
            {scanResult?.extracted_data && Object.keys(scanResult.extracted_data).length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wider">Extracted Details</span>
                  {scanResult.is_ai_vision_used ? (
                    <Badge variant="primary" className="text-[10px] px-2 py-0.5 gap-1">
                      <Sparkles className="w-3 h-3" /> AI Vision Enhanced
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px] px-2 py-0.5">
                      OCR Scanned
                    </Badge>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-2 bg-hover/30 p-3.5 rounded-3xl border border-border/60 max-h-[300px] overflow-y-auto">
                  {Object.entries(scanResult.extracted_data)
                    .filter(([key]) => !["category", "category_id", "status", "vehicle_status", "model"].includes(key.toLowerCase()))
                    .map(([key, val]) => (
                      <div key={key} className="flex items-center justify-between border-b border-border/40 pb-1.5 pt-0.5 last:border-b-0 last:pb-0">
                        <span className="text-foreground-muted font-medium capitalize text-xs">
                          {key.toLowerCase() === "series" ? "Series / Model" : key.replace(/_/g, " ")}:
                        </span>
                        <span className="font-bold text-foreground text-xs text-right font-data">
                          {String(val || "—")}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            ) : (
              <div className="p-6 text-center text-foreground-muted bg-hover/20 rounded-3xl border border-dashed border-border">
                <p className="text-xs font-semibold text-foreground">No readable fields extracted</p>
                <p className="text-[11px] text-foreground-muted mt-1">Please ensure the document image is clear or fill in the vehicle details manually.</p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 pt-2 border-t border-border/60">
            <Button variant="outline" size="sm" onClick={() => setScanReviewModalOpen(false)} className="rounded-xl h-9">
              Cancel
            </Button>
            <Button size="sm" onClick={applyAiExtractedData} className="rounded-xl h-9 px-4 font-medium gap-1.5 shadow-xs">
              <CheckCircle2 className="w-4 h-4" />
              Apply Extracted Data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageEntrance>
  );
}
