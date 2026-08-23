"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DetailSkeleton } from "@/components/ui/skeleton";
import { getDriver, updateDriver } from "@/services/driver.service";
import { scanDocumentWithAi } from "@/services/ai.service";
import { toast } from "@/components/ui/toast";
import {
  ArrowLeft,
  Loader2,
  Upload,
  ZoomIn,
  IdCard,
  CheckCircle2,
  User,
  Briefcase,
  Calendar,
  Globe,
  MapPin,
  Phone,
  Mail,
  UserCheck,
  ShieldAlert,
  ShieldCheck,
  RotateCw,
  Zap,
  FileText,
  FileImage,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useRequireRole } from "@/lib/auth/role-guard";
import { driverEditSchema } from "@/lib/validation/schemas";
import { rotateBase64Image } from "@/lib/images";
import { FloatingField } from "@/components/ui/field";
import { DatePicker } from "@/components/ui/date-picker";

export default function EditDriverPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager"]);
  const router = useRouter();
  const { id } = useParams();
  const queryClient = useQueryClient();

  const [licenseImagePreview, setLicenseImagePreview] = useState(null);
  const [licenseBackImagePreview, setLicenseBackImagePreview] = useState(null);
  const [enlargeModalUrl, setEnlargeModalUrl] = useState(null);

  const [isScanningFront, setIsScanningFront] = useState(false);
  const [isScanningBack, setIsScanningBack] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [scanReviewModalOpen, setScanReviewModalOpen] = useState(false);

  const { data: driver, isLoading, isError } = useQuery({
    queryKey: ["driver", id],
    queryFn: () => getDriver(id),
    enabled: !!id,
  });

  const form = useForm({
    resolver: zodResolver(driverEditSchema),
    defaultValues: {
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      position: "Driver",
      license_number: "",
      license_expiry: "",
      license_type: "Professional",
      license_class: "B",
      years_of_experience: 0,
      driver_status: "Available",
      license_image_url: "",
      license_back_image_url: "",
      address: "",
      sex: "",
      birthdate: "",
      nationality: "",
      emergency_contact_name: "",
      emergency_contact_address: "",
      emergency_contact_phone: "",
    },
  });

  useEffect(() => {
    if (!driver) return;
    const emp = driver.employees || {};
    const imgUrl = driver.face_image_url || emp.avatar_url || "";
    const backUrl = driver.license_back_image_url || "";
    if (imgUrl) setLicenseImagePreview(imgUrl);
    if (backUrl) setLicenseBackImagePreview(backUrl);

    form.reset({
      first_name: emp.first_name || "",
      last_name: emp.last_name || "",
      email: emp.email || "",
      phone: emp.phone || "",
      position: emp.position || "Driver",
      license_number: driver.license_number || "",
      license_expiry: driver.license_expiry ? driver.license_expiry.split("T")[0] : "",
      license_type: driver.license_type || "Professional",
      license_class: driver.license_class || "B",
      years_of_experience: driver.years_of_experience ?? 0,
      driver_status: driver.driver_status || "Available",
      license_image_url: imgUrl,
      license_back_image_url: backUrl,
      address: driver.address || "",
      sex: driver.sex || "",
      birthdate: driver.birthdate ? driver.birthdate.split("T")[0] : "",
      nationality: driver.nationality || "",
      emergency_contact_name: driver.emergency_contact_name || "",
      emergency_contact_address: driver.emergency_contact_address || "",
      emergency_contact_phone: driver.emergency_contact_phone || "",
    });
  }, [driver, form]);

  const handleFrontUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error("File size must be less than 10MB");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result;
        setLicenseImagePreview(result);
        form.setValue("license_image_url", result);
        toast.success("Front License scan updated!");
      };
      reader.readAsDataURL(file);
    }
  };

  const handleBackUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error("File size must be less than 10MB");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result;
        setLicenseBackImagePreview(result);
        form.setValue("license_back_image_url", result);
        toast.success("Back License scan updated!");
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRotateFront = async () => {
    if (!licenseImagePreview) return;
    const rotated = await rotateBase64Image(licenseImagePreview, 90);
    setLicenseImagePreview(rotated);
    form.setValue("license_image_url", rotated);
    toast.success("Rotated Front License 90°");
  };

  const handleRotateBack = async () => {
    if (!licenseBackImagePreview) return;
    const rotated = await rotateBase64Image(licenseBackImagePreview, 90);
    setLicenseBackImagePreview(rotated);
    form.setValue("license_back_image_url", rotated);
    toast.success("Rotated Back License 90°");
  };

  const handleAiScanFront = async () => {
    const fileUrl = licenseImagePreview || form.getValues("license_image_url");
    if (!fileUrl) {
      toast.error("Please upload or attach a Front Driver's License image first.");
      return;
    }

    setIsScanningFront(true);
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
        document_type: "Driver_License",
        document_text: documentText,
        file_url: fileUrl,
      });

      if (res) {
        setScanResult(res);
        setScanReviewModalOpen(true);
        toast.success("Front Driver's License scanned successfully!");
      }
    } catch (err) {
      toast.error(err.message || "Failed to scan driver's license");
    } finally {
      setIsScanningFront(false);
    }
  };

  const handleAiScanBack = async () => {
    const fileUrl = licenseBackImagePreview || form.getValues("license_back_image_url");
    if (!fileUrl) {
      toast.error("Please upload or attach a Back Driver's License image first.");
      return;
    }

    setIsScanningBack(true);
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
        document_type: "Driver_License_Back",
        document_text: documentText,
        file_url: fileUrl,
      });

      if (res) {
        setScanResult(res);
        setScanReviewModalOpen(true);
        toast.success("Back of Driver's License scanned successfully!");
      }
    } catch (err) {
      toast.error(err.message || "Failed to scan back of driver's license");
    } finally {
      setIsScanningBack(false);
    }
  };

  const applyAiExtractedData = () => {
    if (!scanResult?.extracted_data) return;
    const data = scanResult.extracted_data;

    if (data.license_number) form.setValue("license_number", data.license_number);
    if (data.expiration_date) form.setValue("license_expiry", data.expiration_date);
    if (data.first_name) form.setValue("first_name", data.first_name);
    if (data.last_name) form.setValue("last_name", data.last_name);
    if (data.birthdate) form.setValue("birthdate", data.birthdate);
    if (data.sex) form.setValue("sex", data.sex);
    if (data.address) form.setValue("address", data.address);
    if (data.nationality) form.setValue("nationality", data.nationality);
    if (data.license_class) form.setValue("license_class", data.license_class);
    if (data.emergency_contact_name) form.setValue("emergency_contact_name", data.emergency_contact_name);
    if (data.emergency_contact_phone) form.setValue("emergency_contact_phone", data.emergency_contact_phone);
    if (data.emergency_contact_address) form.setValue("emergency_contact_address", data.emergency_contact_address);

    setScanReviewModalOpen(false);
    toast.success("Extracted license details applied to form!");
  };

  const updateMutation = useMutation({
    mutationFn: (payload) => updateDriver(id, payload),
    onSuccess: () => {
      toast.success("Driver updated successfully");
      queryClient.invalidateQueries({ queryKey: ["driver", id] });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      queryClient.invalidateQueries({ queryKey: ["driver-stats"] });
      router.push(`/drivers/${id}`);
    },
    onError: (err) => {
      toast.error(err.message || "Failed to update driver");
    },
  });

  const onSubmit = (data) => {
    const payload = {
      first_name: data.first_name.trim(),
      last_name: data.last_name.trim(),
      license_number: data.license_number.trim(),
      years_of_experience: data.years_of_experience ?? 0,
      driver_status: data.driver_status || "Available",
      position: data.position || "Driver",
      license_image_url: licenseImagePreview || data.license_image_url || null,
      license_back_image_url: licenseBackImagePreview || data.license_back_image_url || null,
    };

    if (data.email?.trim()) payload.email = data.email.trim();
    if (data.phone?.trim()) payload.phone = data.phone.trim();
    if (data.license_expiry) payload.license_expiry = data.license_expiry;
    if (data.license_type) payload.license_type = data.license_type;
    if (data.license_class) payload.license_class = data.license_class;
    if (data.address?.trim()) payload.address = data.address.trim();
    if (data.sex?.trim()) payload.sex = data.sex.trim();
    if (data.birthdate) payload.birthdate = data.birthdate;
    if (data.nationality?.trim()) payload.nationality = data.nationality.trim();
    if (data.emergency_contact_name?.trim()) payload.emergency_contact_name = data.emergency_contact_name.trim();
    if (data.emergency_contact_address?.trim()) payload.emergency_contact_address = data.emergency_contact_address.trim();
    if (data.emergency_contact_phone?.trim()) payload.emergency_contact_phone = data.emergency_contact_phone.trim();

    updateMutation.mutate(payload);
  };

  // eslint-disable-next-line react-hooks/incompatible-library -- react-hook-form manages its own subscription store
  const values = form.watch();
  const isSaving = updateMutation.isPending;

  if (isLoading) return <DetailSkeleton />;

  if (isError || !driver) {
    return (
      <div className="max-w-3xl mx-auto p-12 text-center space-y-4">
        <p className="text-lg font-semibold text-foreground">Driver Not Found</p>
        <Button onClick={() => router.push("/drivers")}>Back to Drivers List</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full pb-28">
      {/* ── Top Page Banner & Header Bar ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-surface border border-border p-5 rounded-2xl shadow-sm">
        <div className="flex items-center gap-3.5">
          <Button variant="outline" size="icon" className="rounded-xl shrink-0" onClick={() => router.push(`/drivers/${id}`)}>
            <ArrowLeft className="w-5 h-5 text-foreground-secondary" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">
                Edit Driver: {driver.employees?.first_name} {driver.employees?.last_name}
              </h1>
              <span className="bg-primary/10 text-primary text-xs font-semibold px-2.5 py-0.5 rounded-full border border-primary/20">
                Edit Profile
              </span>
            </div>
            <p className="text-xs text-foreground-secondary mt-0.5">
              Update credentials, emergency contact info, and verify attached LTO license scans.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <Button type="button" variant="outline" onClick={() => router.push(`/drivers/${id}`)} className="rounded-xl">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={form.handleSubmit(onSubmit)}
            disabled={isSaving}
            className="rounded-xl px-5 h-10 shadow-sm"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving Changes...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2" /> Save Changes
              </>
            )}
          </Button>
        </div>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* ── LEFT COLUMN: 3 Section Cards (7 Cols) ── */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* CARD 1: PERSONAL INFORMATION */}
            <Card className="border-0 shadow-sm rounded-2xl">
              <CardHeader className="pb-3 border-b border-border/60">
                <CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
                  <div className="p-2 rounded-xl bg-primary/10 text-primary">
                    <User className="w-4 h-4" />
                  </div>
                  Personal Information
                </CardTitle>
                <CardDescription className="text-xs">
                  Basic identification details and contact info.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2">
                  <FloatingField label="First Name" icon={User} required error={form.formState.errors.first_name?.message}>
                    <input id="first_name" {...form.register("first_name")} className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1" />
                  </FloatingField>

                  <FloatingField label="Last Name" icon={User} required error={form.formState.errors.last_name?.message}>
                    <input id="last_name" {...form.register("last_name")} className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1" />
                  </FloatingField>

                  <FloatingField label="Email Address" icon={Mail}>
                    <input id="email" type="email" {...form.register("email")} className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1" />
                  </FloatingField>

                  <FloatingField label="Phone Number" icon={Phone}>
                    <input id="phone" {...form.register("phone")} className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1 font-data" />
                  </FloatingField>

                  <div>
                    <DatePicker
                      id="birthdate"
                      label="Birthdate"
                      value={form.watch("birthdate")}
                      onChange={(val) => form.setValue("birthdate", val)}
                    />
                  </div>

                  <FloatingField label="Sex" icon={User}>
                    <select
                      id="sex"
                      {...form.register("sex")}
                      className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1 cursor-pointer"
                    >
                      <option value="">Select sex</option>
                      <option value="M">Male</option>
                      <option value="F">Female</option>
                    </select>
                  </FloatingField>

                  <FloatingField label="Nationality" icon={Globe} className="md:col-span-2">
                    <input id="nationality" {...form.register("nationality")} className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1" />
                  </FloatingField>

                  <FloatingField label="Address" icon={MapPin} className="md:col-span-2">
                    <input id="address" {...form.register("address")} className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1" />
                  </FloatingField>
                </div>
              </CardContent>
            </Card>

            {/* CARD 2: LICENSE & DUTY STATUS */}
            <Card className="border-0 shadow-sm rounded-2xl">
              <CardHeader className="pb-3 border-b border-border/60">
                <CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
                  <div className="p-2 rounded-xl bg-blue-500/10 text-blue-500">
                    <IdCard className="w-4 h-4" />
                  </div>
                  Driver&apos;s License &amp; Duty Status
                </CardTitle>
                <CardDescription className="text-xs">
                  Official LTO License credentials and employment status.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2">
                  <FloatingField label="License Number" icon={IdCard} required>
                    <input id="license_number" {...form.register("license_number")} className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1 font-data uppercase" />
                  </FloatingField>

                  <div>
                    <DatePicker
                      id="license_expiry"
                      label="License Expiration Date"
                      value={form.watch("license_expiry")}
                      onChange={(val) => form.setValue("license_expiry", val)}
                    />
                    <p className="text-[11px] text-foreground-muted mt-1.5">
                      Expired documents are allowed — status will reflect compliance risk.
                    </p>
                  </div>

                  <FloatingField label="Vehicle License Class" icon={IdCard} required>
                    <select
                      id="license_class"
                      {...form.register("license_class")}
                      className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1 cursor-pointer"
                    >
                      <option value="B">Class B — Passenger Cars &amp; Light Vehicles</option>
                      <option value="B1">Class B1 — Light Vans &amp; Commercial Vehicles</option>
                    </select>
                  </FloatingField>

                  <FloatingField label="License Type" icon={Briefcase}>
                    <input id="license_type" value="Professional Driver" readOnly className="w-full bg-transparent text-xs font-semibold text-foreground-secondary focus:outline-hidden py-1 cursor-not-allowed" />
                  </FloatingField>

                  <FloatingField label="Position Title" icon={Briefcase}>
                    <input id="position" {...form.register("position")} className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1" />
                  </FloatingField>

                  <FloatingField label="Years of Experience" icon={Briefcase}>
                    <input id="years_of_experience" type="number" min="0" {...form.register("years_of_experience")} className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1 font-data" />
                  </FloatingField>

                  <FloatingField label="Duty Status" icon={UserCheck} className="md:col-span-2">
                    <select
                      id="driver_status"
                      {...form.register("driver_status")}
                      className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1 cursor-pointer"
                    >
                      <option value="Available">Available</option>
                      <option value="On Trip">On Trip</option>
                      <option value="Off Duty">Off Duty</option>
                      <option value="On Leave">On Leave</option>
                      <option value="Suspended">Suspended</option>
                    </select>
                  </FloatingField>
                </div>
              </CardContent>
            </Card>

            {/* CARD 3: EMERGENCY CONTACT */}
            <Card className="border border-amber-500/20 shadow-sm rounded-2xl bg-amber-500/5">
              <CardHeader className="pb-3 border-b border-amber-500/10">
                <CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
                  <div className="p-2 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
                    <ShieldAlert className="w-4 h-4" />
                  </div>
                  Emergency Contact Person
                </CardTitle>
                <CardDescription className="text-xs text-foreground-secondary">
                  Primary emergency contact person and phone number.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="emergency_contact_name" className="text-xs font-semibold text-foreground">Emergency Contact Name</Label>
                    <Input id="emergency_contact_name" {...form.register("emergency_contact_name")} className="rounded-xl bg-surface" />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="emergency_contact_phone" className="text-xs font-medium text-foreground-secondary">Contact Number (TEL. NO.)</Label>
                    <Input id="emergency_contact_phone" {...form.register("emergency_contact_phone")} className="rounded-xl bg-surface" />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="emergency_contact_address" className="text-xs font-medium text-foreground-secondary">Address</Label>
                    <Input id="emergency_contact_address" {...form.register("emergency_contact_address")} className="rounded-xl bg-surface" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── RIGHT COLUMN: Front & Back License Scans (5 Cols) ── */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* FRONT LICENSE */}
            <Card className="border-0 shadow-sm rounded-2xl overflow-hidden">
              <CardHeader className="pb-3 border-b border-border/60 bg-muted/20">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
                    <FileImage className="w-4 h-4 text-primary" /> Front of Driver License
                  </CardTitle>
                  {licenseImagePreview && (
                    <div className="flex items-center gap-1">
                      <Button type="button" variant="ghost" size="sm" onClick={handleRotateFront} className="h-7 text-xs">
                        <RotateCw className="w-3.5 h-3.5 mr-1" /> Rotate
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setEnlargeModalUrl(licenseImagePreview)} className="h-7 text-xs text-primary">
                        <ZoomIn className="w-3.5 h-3.5 mr-1" /> Zoom
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                <div className="p-3.5 rounded-xl bg-surface border border-border space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-foreground">Front Scan</Label>
                    {licenseImagePreview && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleAiScanFront}
                        disabled={isScanningFront}
                        className="h-8 text-xs font-semibold px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs transition-all flex items-center gap-1.5"
                      >
                        {isScanningFront ? <Loader2 className="w-3.5 h-3.5 animate-spin text-white" /> : <Zap className="w-3.5 h-3.5 mr-1 text-white" />} Scan Front
                      </Button>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="relative border-2 border-dashed border-border rounded-xl p-3 text-center bg-muted/20 cursor-pointer">
                      <input type="file" accept="image/*" onChange={handleFrontUpload} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
                      <div className="flex items-center justify-center gap-2 text-xs text-foreground-secondary">
                        <Upload className="w-4 h-4 text-primary" /> Upload Front Scan
                      </div>
                    </div>
                    <Input
                      placeholder="Or Front License URL..."
                      value={values.license_image_url || ""}
                      onChange={(e) => {
                        const url = e.target.value;
                        form.setValue("license_image_url", url);
                        if (url.startsWith("http") || url.startsWith("data:")) setLicenseImagePreview(url);
                      }}
                      className="h-9 text-xs rounded-xl"
                    />
                  </div>
                </div>

                {licenseImagePreview ? (
                  <div className="rounded-xl overflow-hidden border border-border bg-black/5 aspect-[16/10] relative group cursor-pointer" onClick={() => setEnlargeModalUrl(licenseImagePreview)}>
                    <img src={licenseImagePreview} alt="Front License" className="w-full h-full object-contain" />
                  </div>
                ) : (
                  <div className="p-6 rounded-xl bg-muted/20 border border-border text-center text-xs text-foreground-muted">
                    No Front License Image Attached
                  </div>
                )}
              </CardContent>
            </Card>

            {/* BACK LICENSE */}
            <Card className="border-0 shadow-sm rounded-2xl overflow-hidden">
              <CardHeader className="pb-3 border-b border-border/60 bg-muted/20">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
                    <FileImage className="w-4 h-4 text-primary" /> Back of Driver License
                  </CardTitle>
                  {licenseBackImagePreview && (
                    <div className="flex items-center gap-1">
                      <Button type="button" variant="ghost" size="sm" onClick={handleRotateBack} className="h-7 text-xs">
                        <RotateCw className="w-3.5 h-3.5 mr-1" /> Rotate
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setEnlargeModalUrl(licenseBackImagePreview)} className="h-7 text-xs text-primary">
                        <ZoomIn className="w-3.5 h-3.5 mr-1" /> Zoom
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                <div className="p-3.5 rounded-xl bg-surface border border-border space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-foreground">Back Scan</Label>
                    {licenseBackImagePreview && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleAiScanBack}
                        disabled={isScanningBack}
                        className="h-8 text-xs font-semibold px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs transition-all flex items-center gap-1.5"
                      >
                        {isScanningBack ? <Loader2 className="w-3.5 h-3.5 animate-spin text-white" /> : <Zap className="w-3.5 h-3.5 mr-1 text-white" />} Scan Back
                      </Button>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="relative border-2 border-dashed border-border rounded-xl p-3 text-center bg-muted/20 cursor-pointer">
                      <input type="file" accept="image/*" onChange={handleBackUpload} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
                      <div className="flex items-center justify-center gap-2 text-xs text-foreground-secondary">
                        <Upload className="w-4 h-4 text-primary" /> Upload Back Scan
                      </div>
                    </div>
                    <Input
                      placeholder="Or Back License URL..."
                      value={values.license_back_image_url || ""}
                      onChange={(e) => {
                        const url = e.target.value;
                        form.setValue("license_back_image_url", url);
                        if (url.startsWith("http") || url.startsWith("data:")) setLicenseBackImagePreview(url);
                      }}
                      className="h-9 text-xs rounded-xl"
                    />
                  </div>
                </div>

                {licenseBackImagePreview ? (
                  <div className="rounded-xl overflow-hidden border border-border bg-black/5 aspect-[16/10] relative group cursor-pointer" onClick={() => setEnlargeModalUrl(licenseBackImagePreview)}>
                    <img src={licenseBackImagePreview} alt="Back License" className="w-full h-full object-contain" />
                  </div>
                ) : (
                  <div className="p-6 rounded-xl bg-muted/20 border border-border text-center text-xs text-foreground-muted">
                    No Back License Image Attached
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </form>

      {/* ── ENLARGED LICENSE ZOOM MODAL ── */}
      <Dialog open={!!enlargeModalUrl} onOpenChange={() => setEnlargeModalUrl(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <IdCard className="w-5 h-5 text-primary" /> Driver License Verification Zoom
            </DialogTitle>
          </DialogHeader>
          <div className="p-2 flex items-center justify-center max-h-[70vh] overflow-auto bg-black/5 rounded-3xl border border-border">
            {enlargeModalUrl && <img src={enlargeModalUrl} alt="License Zoom" className="max-h-[65vh] w-auto object-contain rounded-lg shadow-md" />}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── SCAN REVIEW MODAL ── */}
      <Dialog open={scanReviewModalOpen} onOpenChange={setScanReviewModalOpen}>
        <DialogContent className="max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" /> Driver License Extracted Data
            </DialogTitle>
            <DialogDescription className="text-xs">
              Review extracted fields from your driver&apos;s license scan before applying.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2 text-xs">
            {scanResult?.extracted_data && Object.keys(scanResult.extracted_data).length > 0 ? (
              <div className="space-y-2 bg-muted/30 p-4 rounded-3xl border border-border">
                {Object.entries(scanResult.extracted_data).map(([key, val]) => (
                  <div key={key} className="flex items-center justify-between border-b border-border/40 pb-1.5">
                    <span className="text-foreground-muted capitalize">{key.replace(/_/g, " ")}:</span>
                    <span className="font-semibold text-foreground">{String(val || "—")}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-foreground-muted py-4 text-center">No readable fields extracted.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setScanReviewModalOpen(false)} className="rounded-xl">
              Cancel
            </Button>
            <Button size="sm" onClick={applyAiExtractedData} className="rounded-xl px-4">
              Apply Extracted Data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
