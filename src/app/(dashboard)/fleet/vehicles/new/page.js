"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

  // Fill fields from an AI extraction result. A field is only written when it
  // is empty or still pristine (untouched by the user) — anything staff has
  // typed always wins. Returns how many fields were filled.
  const fillExtractedFields = (data, documentType) => {
    if (typeof data !== "object" || data === null) return 0;
    let count = 0;
    const isBlank = (v) => v === null || v === undefined || String(v).trim() === "";
    const setIfFree = (name, value) => {
      if (isBlank(value)) return;
      if (!isBlank(form.getValues(name)) && form.formState.dirtyFields[name]) return;
      form.setValue(name, value, { shouldValidate: true });
      count += 1;
    };

    setIfFree("plate_number", data.plate_number ? String(data.plate_number).toUpperCase() : null);
    setIfFree("vehicle_name", data.vehicle_type || data.vehicle_name);
    setIfFree("manufacturer", data.manufacturer);

    if (!isBlank(data.model) || !isBlank(data.series)) {
      const model = String(data.model || "").trim().toUpperCase();
      const series = String(data.series || "").trim().toUpperCase();
      const merged = series && series !== model ? `${model} ${series}`.trim() : model || series;
      setIfFree("model", merged);
    }

    setIfFree("year", data.year != null ? Number(data.year) : null);
    setIfFree("color", data.color);
    setIfFree("fuel_type", data.fuel_type);
    setIfFree("seating_capacity", data.seating_capacity != null ? Number(data.seating_capacity) : null);

    if (documentType === "OR_CR" && !isBlank(data.registration_number) && isBlank(orCrDoc.document_number)) {
      setOrCrDoc((prev) => ({ ...prev, document_number: String(data.registration_number).toUpperCase() }));
      count += 1;
    }
    if (
      documentType === "Insurance" &&
      !isBlank(data.insurance_policy_number) &&
      isBlank(insuranceDoc.document_number)
    ) {
      setInsuranceDoc((prev) => ({ ...prev, document_number: String(data.insurance_policy_number).toUpperCase() }));
      count += 1;
    }

    return count;
  };

  const handleAiScan = async (documentType, fileUrl) => {
    if (!fileUrl) {
      toast.error("Please upload a document scan first before scanning with AI.");
      return;
    }
    setScanningDocType(documentType);
    try {
      const res = await scanDocumentWithAi({
        document_type: documentType,
        file_url: fileUrl,
      });
      const filled = res ? fillExtractedFields(res.extracted_data || {}, documentType) : 0;
      if (filled > 0) {
        toast.success(
          `${documentType.replace("_", " ")}: auto-filled ${filled} field${filled === 1 ? "" : "s"} — please review before saving.`
        );
      } else if (res?.validation_issues?.length) {
        toast.error(res.validation_issues[0]);
      } else {
        toast.error(`Couldn't read new fields from the ${documentType.replace("_", " ")} scan. Enter them manually.`);
      }
    } catch (err) {
      toast.error(err.message || "Failed to scan document with AI");
    } finally {
      setScanningDocType(null);
    }
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

  const handleFileUpload = (e, setter, documentType) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setter((prev) => ({ ...prev, file_url: reader.result }));
        toast.success("Document scan attached! Scanning automatically...");
        if (documentType) {
          handleAiScan(documentType, reader.result);
        }
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
                        onChange={(e) => handleFileUpload(e, setOrCrDoc, "OR_CR")}
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
                        onChange={(e) => handleFileUpload(e, setInsuranceDoc, "Insurance")}
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
    </PageEntrance>
  );
}
