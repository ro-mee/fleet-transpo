"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DetailSkeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getDriver, updateDriver, verifyDriverLicense } from "@/services/driver.service";
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
  Phone,
  Mail,
  UserCheck,
  ShieldAlert,
  ShieldCheck,
  RotateCw,
  Zap,
  FileText,
  FileImage,
  Eye,
  EyeOff,
} from "lucide-react";
import Link from "next/link";
import { AddressPickerField } from "@/components/address/address-picker-field";
import { useRequireRole } from "@/lib/auth/role-guard";
import { driverEditSchema } from "@/lib/validation/schemas";
import { LEGAL_DRIVING_AGE } from "@/lib/validation/age";
import { rotateBase64Image } from "@/lib/images";
import { FloatingField, FloatingSelect } from "@/components/ui/field";
import { DatePicker } from "@/components/ui/date-picker";
import { HeroHeader, heroButtonOutlineClass, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { StickyActionBar } from "@/components/ui/sticky-actions";
import { PageEntrance } from "@/components/ui/page-entrance";
import { cn } from "@/lib/utils";
import { normalizeLicenseType } from "@/lib/drivers/license-eligibility";

export default function EditDriverPage() {
  useRequireRole();
  const router = useRouter();
  const { id } = useParams();
  const queryClient = useQueryClient();

  const [licenseImagePreview, setLicenseImagePreview] = useState(null);
  const [licenseBackImagePreview, setLicenseBackImagePreview] = useState(null);
  const [enlargeModalUrl, setEnlargeModalUrl] = useState(null);
  const [showLicenseNumber, setShowLicenseNumber] = useState(false);

  const [isScanningFront, setIsScanningFront] = useState(false);
  const [isScanningBack, setIsScanningBack] = useState(false);

  // The addresses picked through the cascade on THIS visit, held outside the
  // form. Null means the operator has not picked one, which is what leaves the
  // stored text and the registry row it points at untouched — see the payload
  // builder at the bottom of this file.
  const [pickedAddress, setPickedAddress] = useState(null);
  const [pickedEmergencyAddress, setPickedEmergencyAddress] = useState(null);

  const { data: driver, isLoading, isError } = useQuery({
    queryKey: ["driver-edit", id],
    queryFn: () => getDriver(id, { includeLicense: true }),
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
      license_type: "",
      license_class: "",
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

  // Which driver the form currently holds, so the seeding below is keyed on
  // IDENTITY rather than on the object — see the effect immediately after.
  const seededDriverId = useRef(null);

  useEffect(() => {
    if (!driver) return;

    // Seeding is per-driver, and `driver_id` is what says which driver that is.
    // Keying this on the `driver` OBJECT instead would make it run on every
    // refetch: React Query hands back a new object for the same row on the
    // post-save invalidation, on a window refocus, and on a reconnect. Each of
    // those ran `form.reset()` and cleared the picks, so anything typed while a
    // save was in flight — or while the operator was simply away from the tab —
    // was discarded without a word. `driver_id` is the row's primary key (`SELECT
    // d.*` in the API route, filtered by it), so it is present on every response.
    //
    // The trade is deliberate: fresher data from the server no longer overwrites
    // what is in the fields. On an edit form that is the right way round — the
    // person typing is the one who knows what they meant to enter.
    //
    // A different id, by contrast, is a different driver and must re-seed. The App
    // Router does not remount between `/drivers/60/edit` and `/drivers/61/edit`,
    // so this comparison is what catches that navigation.
    if (seededDriverId.current === driver.driver_id) return;
    seededDriverId.current = driver.driver_id;

    const emp = driver.employees || {};
    const imgUrl = driver.face_image_url || emp.avatar_url || "";
    const backUrl = driver.license_back_image_url || "";
    if (imgUrl) setLicenseImagePreview(imgUrl);
    if (backUrl) setLicenseBackImagePreview(backUrl);

    // A fresh driver is a fresh edit: any pick made against the previous one must
    // not survive into this one. This is the one moment the picks are cleared —
    // a refetch of the SAME driver leaves a pick from this visit alone.
    //
    // The stored address IS reopened into the picker — the page passes
    // `initialStructured` to `AddressPickerField`, which seeds the dialog from it,
    // and the API resolves the stored `address_id` into that detail via
    // `loadStructuredAddress`. Picking a new one therefore replaces the stored
    // one rather than being the only way to reach it.
    setPickedAddress(null);
    setPickedEmergencyAddress(null);

    form.reset({
      first_name: emp.first_name || "",
      last_name: emp.last_name || "",
      email: emp.email || "",
      phone: emp.phone || "",
      position: emp.position || "Driver",
      license_number: driver.license_number || "",
      license_expiry: driver.license_expiry ? driver.license_expiry.split("T")[0] : "",
      license_type: normalizeLicenseType(driver.license_type) || driver.license_type || "",
      license_class: driver.license_class || "",
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

  // Fill ONLY currently-blank form fields from an extraction result — never
  // overwrites anything already typed. Returns how many fields were filled.
  const fillLicenseFields = (data) => {
    let count = 0;
    const setIfBlank = (name, value) => {
      if (value === null || value === undefined || String(value).trim() === "") return;
      if (String(form.getValues(name) ?? "").trim() !== "") return;
      form.setValue(name, value, { shouldValidate: true });
      count += 1;
    };
    setIfBlank("license_number", data.license_number);
    setIfBlank("license_expiry", data.expiration_date);
    setIfBlank("first_name", data.first_name);
    setIfBlank("last_name", data.last_name);
    setIfBlank("birthdate", data.birthdate);
    setIfBlank("sex", data.sex);
    setIfBlank("address", data.address);
    setIfBlank("nationality", data.nationality);
    setIfBlank("license_class", data.license_class);
    setIfBlank("emergency_contact_name", data.emergency_contact_name);
    setIfBlank("emergency_contact_phone", data.emergency_contact_phone);
    setIfBlank("emergency_contact_address", data.emergency_contact_address);
    return count;
  };

  const handleAiScanFront = async (fileUrlOverride) => {
    const fileUrl = fileUrlOverride || licenseImagePreview || form.getValues("license_image_url");
    if (!fileUrl) {
      toast.error("Please upload or attach a Front Driver's License image first.");
      return;
    }

    setIsScanningFront(true);
    try {
      const res = await scanDocumentWithAi({
        document_type: "Driver_License",
        file_url: fileUrl,
      });

      const filled = res ? fillLicenseFields(res.extracted_data || {}) : 0;
      if (filled > 0) {
        toast.success(`Front License: auto-filled ${filled} field${filled === 1 ? "" : "s"} — please review before saving.`);
      } else if (res?.validation_issues?.length) {
        toast.error(res.validation_issues[0]);
      } else {
        toast.error("Couldn't read new fields from the scan. Enter them manually or re-scan.");
      }
    } catch (err) {
      toast.error(err.message || "Failed to scan driver's license");
    } finally {
      setIsScanningFront(false);
    }
  };

  const handleAiScanBack = async (fileUrlOverride) => {
    const fileUrl = fileUrlOverride || licenseBackImagePreview || form.getValues("license_back_image_url");
    if (!fileUrl) {
      toast.error("Please upload or attach a Back Driver's License image first.");
      return;
    }

    setIsScanningBack(true);
    try {
      const res = await scanDocumentWithAi({
        document_type: "Driver_License_Back",
        file_url: fileUrl,
      });

      const filled = res ? fillLicenseFields(res.extracted_data || {}) : 0;
      if (filled > 0) {
        toast.success(`Back of License: auto-filled ${filled} field${filled === 1 ? "" : "s"} — please review before saving.`);
      } else if (res?.validation_issues?.length) {
        toast.error(res.validation_issues[0]);
      } else {
        toast.error("Couldn't read new fields from the scan. Enter them manually or re-scan.");
      }
    } catch (err) {
      toast.error(err.message || "Failed to scan back of driver's license");
    } finally {
      setIsScanningBack(false);
    }
  };

  const handleFrontUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error("File size must be less than 5MB");
        return;
      }
      if (file.type !== "image/jpeg" && file.type !== "image/png") {
        toast.error("Scan must be a JPEG or PNG image");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result;
        setLicenseImagePreview(result);
        form.setValue("license_image_url", result);
        toast.success("Front License scan updated! Scanning automatically...");
        handleAiScanFront(result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleBackUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error("File size must be less than 5MB");
        return;
      }
      if (file.type !== "image/jpeg" && file.type !== "image/png") {
        toast.error("Scan must be a JPEG or PNG image");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result;
        setLicenseBackImagePreview(result);
        form.setValue("license_back_image_url", result);
        toast.success("Back License scan updated! Scanning automatically...");
        handleAiScanBack(result);
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

  const updateMutation = useMutation({
    mutationFn: (payload) => updateDriver(id, payload),
    onSuccess: () => {
      toast.success("Driver updated successfully");
      queryClient.invalidateQueries({ queryKey: ["driver-edit", id] });
      queryClient.invalidateQueries({ queryKey: ["driver", id] });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      queryClient.invalidateQueries({ queryKey: ["driver-stats"] });
      router.push(`/drivers/${id}`);
    },
    onError: (err) => {
      toast.error(err.message || "Failed to update driver");
    },
  });

  const verificationMutation = useMutation({
    mutationFn: (method) => verifyDriverLicense(id, method),
    onSuccess: () => {
      toast.success("License review recorded");
      queryClient.invalidateQueries({ queryKey: ["driver-edit", id] });
      queryClient.invalidateQueries({ queryKey: ["driver", id] });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
    },
    onError: (err) => toast.error(err.message || "Failed to record license review"),
  });

  const onSubmit = (data) => {
    const payload = {
      first_name: data.first_name.trim(),
      last_name: data.last_name.trim(),
      license_number: data.license_number.trim(),
      years_of_experience: data.years_of_experience ?? 0,
      position: data.position?.trim() || "Driver",
      license_image_url: licenseImagePreview || data.license_image_url || null,
      license_back_image_url: licenseBackImagePreview || data.license_back_image_url || null,
      // Pass null when cleared so backend clears the column rather than ignoring it
      email: data.email?.trim() || null,
      phone: data.phone?.trim() || null,
      license_expiry: data.license_expiry || null,
      license_type: data.license_type || null,
      license_class: data.license_class || null,
      sex: data.sex?.trim() || null,
      birthdate: data.birthdate || null,
      nationality: data.nationality?.trim() || null,
      emergency_contact_name: data.emergency_contact_name?.trim() || null,
      emergency_contact_phone: data.emergency_contact_phone?.trim() || null,
      address: data.address?.trim() || null,
      emergency_contact_address: data.emergency_contact_address?.trim() || null,
    };

    // If driver_status was not modified on this screen, do not send it so the
    // backend's automatic reinstatement check is not bypassed.
    if (data.driver_status && data.driver_status !== driver?.driver_status) {
      payload.driver_status = data.driver_status;
    }

    if (pickedAddress) payload.structured_address = pickedAddress;
    if (pickedEmergencyAddress) payload.emergency_structured_address = pickedEmergencyAddress;

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

  const formActions = (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => router.push(`/drivers/${id}`)}
        className={cn("rounded-xl", heroButtonOutlineClass)}
      >
        Cancel
      </Button>
      <Button
        type="button"
        onClick={form.handleSubmit(onSubmit)}
        disabled={isSaving}
        className={cn("rounded-xl px-5 h-10 shadow-xs font-bold", heroButtonPrimaryClass)}
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
    </>
  );

  return (
    <PageEntrance className="space-y-6 w-full pb-28">
      {/* ── Top Hero Header Bar ── */}
      <HeroHeader
        icon={IdCard}
        title={`Edit Driver: ${driver.employees?.first_name || ""} ${driver.employees?.last_name || ""}`}
        badge="Edit Profile"
        description="Update credentials, emergency contact info, and verify attached LTO license scans."
        actions={formActions}
      />
      <StickyActionBar>{formActions}</StickyActionBar>

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
                      onChange={(val) => form.setValue("birthdate", val, { shouldValidate: true })}
                      minAge={LEGAL_DRIVING_AGE}
                      error={form.formState.errors.birthdate?.message}
                    />
                    <p className="text-[11px] text-foreground-muted mt-1.5">
                      Must be at least {LEGAL_DRIVING_AGE} years old — years past that are not selectable.
                    </p>
                  </div>

                  <Controller
                    control={form.control}
                    name="sex"
                    render={({ field }) => (
                      <FloatingField label="Sex" icon={User}>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger className="w-full bg-transparent border-0 h-auto p-0 focus:ring-0 focus:ring-offset-0 shadow-none text-xs font-semibold text-foreground py-1">
                            <SelectValue placeholder="Select sex" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="M">Male</SelectItem>
                            <SelectItem value="F">Female</SelectItem>
                          </SelectContent>
                        </Select>
                      </FloatingField>
                    )}
                  />

                  <FloatingField label="Nationality" icon={Globe} className="md:col-span-2">
                    <input id="nationality" {...form.register("nationality")} className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1" />
                  </FloatingField>

                  <div className="md:col-span-2">
                    <AddressPickerField
                      id="address_pick"
                      label="Address"
                      value={pickedAddress}
                      onChange={setPickedAddress}
                      stored={values.address}
                      initialStructured={driver?.structured_address ?? null}
                      prefillReason={driver?.structured_address_reason ?? null}
                      disabled={isSaving}
                    />
                  </div>
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
                    <div className="flex w-full items-center gap-2">
                      <input id="license_number" type={showLicenseNumber ? "text" : "password"} autoComplete="off" {...form.register("license_number")} className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1 font-data uppercase" />
                      <button type="button" onClick={() => setShowLicenseNumber((value) => !value)} aria-label={showLicenseNumber ? "Hide license number" : "Show license number"} className="text-foreground-muted hover:text-foreground">
                        {showLicenseNumber ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </FloatingField>

                  <div>
                    <DatePicker
                      id="license_expiry"
                      label="License Expiration Date"
                      required
                      value={form.watch("license_expiry")}
                      onChange={(val) => form.setValue("license_expiry", val, { shouldValidate: true, shouldDirty: true })}
                    />
                    <p className="text-[11px] text-foreground-muted mt-1.5">Enter the separate expiry date printed on the card. Scan suggestions must be checked against the card; the number does not supply this date. The license remains valid through that date in Philippine time.</p>
                    {form.formState.errors.license_expiry?.message && <p className="text-xs text-danger mt-1">{form.formState.errors.license_expiry.message}</p>}
                  </div>

                  <Controller
                    control={form.control}
                    name="license_class"
                    render={({ field }) => (
                      <FloatingField label="LTO License Code" icon={IdCard} required>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger className="w-full bg-transparent border-0 h-auto p-0 focus:ring-0 focus:ring-offset-0 shadow-none text-xs font-semibold text-foreground py-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                        <SelectItem value="B">B — M1 passenger vehicle (up to 8 passenger seats; GVW ≤ 5,000 kg)</SelectItem>
                        <SelectItem value="B1">B1 — M2 passenger vehicle (more than 8 passenger seats; GVW ≤ 5,000 kg)</SelectItem>
                          </SelectContent>
                        </Select>
                      </FloatingField>
                    )}
                  />

                  <Controller
                    control={form.control}
                    name="license_type"
                    render={({ field }) => (
                      <FloatingSelect
                        label="License Type"
                        icon={Briefcase}
                        required
                        value={field.value}
                        onValueChange={field.onChange}
                        placeholder="Select type"
                        error={form.formState.errors.license_type?.message}
                      >
                        {field.value && field.value !== "Professional" && (
                          <SelectItem value={field.value} disabled>{field.value} — unsupported; update from the card</SelectItem>
                        )}
                        <SelectItem value="Professional">Professional</SelectItem>
                      </FloatingSelect>
                    )}
                  />

                  <div className="md:col-span-2 rounded-xl border border-border/70 bg-muted/20 p-3">
                    <p className="text-xs font-semibold">Staff review: {driver?.license_verified_at ? `recorded ${new Date(driver.license_verified_at).toLocaleString()}` : "not verified"}</p>
                    <p className="text-[11px] text-foreground-muted mt-1">Review the number, type, class, and expiry against the physical card or LTO Digital ID. This records your review; it does not query LTO or prove the license remains active.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" disabled={verificationMutation.isPending} onClick={() => verificationMutation.mutate("physical_card")}>Confirm physical card checked</Button>
                      <Button type="button" variant="outline" size="sm" disabled={verificationMutation.isPending} onClick={() => verificationMutation.mutate("lto_digital_id")}>Confirm LTO Digital ID checked</Button>
                    </div>
                  </div>

                  <FloatingField label="Position Title" icon={Briefcase}>
                    <input id="position" {...form.register("position")} className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1" />
                  </FloatingField>

                  <FloatingField label="Years of Experience" icon={Briefcase}>
                    <input id="years_of_experience" type="number" min="0" {...form.register("years_of_experience")} className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1 font-data" />
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
                  <div className="md:col-span-2">
                    <AddressPickerField
                      id="emergency_contact_address_pick"
                      label="Address"
                      value={pickedEmergencyAddress}
                      onChange={setPickedEmergencyAddress}
                      stored={values.emergency_contact_address}
                      initialStructured={driver?.emergency_structured_address ?? null}
                      prefillReason={driver?.emergency_structured_address_reason ?? null}
                      disabled={isSaving}
                    />
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
                      <input type="file" accept="image/jpeg, image/png" onChange={handleFrontUpload} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
                      <div className="flex items-center justify-center gap-2 text-xs text-foreground-secondary">
                        <Upload className="w-4 h-4 text-primary" /> Upload Front Scan
                      </div>
                    </div>
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
                      <input type="file" accept="image/jpeg, image/png" onChange={handleBackUpload} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
                      <div className="flex items-center justify-center gap-2 text-xs text-foreground-secondary">
                        <Upload className="w-4 h-4 text-primary" /> Upload Back Scan
                      </div>
                    </div>
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
    </PageEntrance>
  );
}
