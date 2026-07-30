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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createDriver } from "@/services/driver.service";
import { getBranches } from "@/services/vehicle.service";
import {
  ArrowLeft, Loader2, User, IdCard, CheckCircle2, ChevronRight,
  Upload, FileImage, Eye, ZoomIn, AlertCircle, Check
} from "lucide-react";
import { toast } from "@/components/ui/toast";
import Link from "next/link";
import { useRequireRole } from "@/lib/auth/role-guard";

const driverSchema = z.object({
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address").or(z.literal("")).optional(),
  phone: z.string().optional(),
  branch_id: z.coerce.number().optional().nullable(),
  position: z.string().default("Driver"),
  license_number: z.string().min(1, "License number is required"),
  license_expiry: z.string().optional(),
  license_type: z.string().optional(),
  license_class: z.string().optional(),
  years_of_experience: z.coerce.number().min(0).default(0),
  driver_status: z.string().default("Available"),
  license_image_url: z.string().optional(),
});

export default function NewDriverPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager"]);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);

  // License Image Preview state
  const [licenseImagePreview, setLicenseImagePreview] = useState(null);
  const [enlargeModalOpen, setEnlargeModalOpen] = useState(false);

  const { data: branches = [] } = useQuery({
    queryKey: ["branches"],
    queryFn: getBranches,
  });

  const form = useForm({
    resolver: zodResolver(driverSchema),
    defaultValues: {
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      branch_id: null,
      position: "Driver",
      license_number: "",
      license_expiry: "",
      license_type: "Professional",
      license_class: "B",
      years_of_experience: 0,
      driver_status: "Available",
      license_image_url: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: createDriver,
    onSuccess: (data) => {
      toast.success("Driver created successfully");
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      queryClient.invalidateQueries({ queryKey: ["driver-stats"] });
      router.push(data?.driver_id ? `/drivers/${data.driver_id}` : "/drivers");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to create driver");
    },
  });

  // Handle Local Image Upload & Preview
  const handleFileUpload = (e) => {
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
        toast.success("License image attached for verification preview!");
      };
      reader.readAsDataURL(file);
    }
  };

  async function handleNextStep() {
    const valid = await form.trigger(["first_name", "last_name", "email", "phone"]);
    if (valid) setStep(2);
  }

  const onSubmit = (data) => {
    const payload = {
      first_name: data.first_name.trim(),
      last_name: data.last_name.trim(),
      license_number: data.license_number.trim(),
      years_of_experience: data.years_of_experience ?? 0,
      driver_status: data.driver_status || "Available",
      position: data.position || "Driver",
      license_image_url: licenseImagePreview || data.license_image_url || null,
    };

    if (data.email?.trim()) payload.email = data.email.trim();
    if (data.phone?.trim()) payload.phone = data.phone.trim();
    if (data.branch_id) payload.branch_id = Number(data.branch_id);
    if (data.license_expiry) payload.license_expiry = data.license_expiry;
    if (data.license_type) payload.license_type = data.license_type;
    if (data.license_class) payload.license_class = data.license_class;

    createMutation.mutate(payload);
  };

  const values = form.watch();
  const isSubmitting = createMutation.isPending;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* ── Header ── */}
      <div className="flex items-center gap-4">
        <Link href="/drivers" className="text-foreground-secondary hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Add New Driver</h1>
          <p className="text-foreground-secondary mt-1">Register a new driver and double-check their Driver's License card</p>
        </div>
      </div>

      {/* ── Step Indicator ── */}
      <div className="flex items-center gap-2 max-w-xl">
        {[
          { num: 1, label: "Personal Info", icon: User },
          { num: 2, label: "License & Double Check", icon: IdCard },
        ].map((s, i) => (
          <div key={s.num} className="flex items-center gap-2 flex-1">
            <div
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium transition-colors w-full ${
                step === s.num
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : step > s.num
                  ? "bg-success/10 text-success border border-success/20"
                  : "bg-muted text-foreground-muted"
              }`}
            >
              {step > s.num ? <CheckCircle2 className="w-4 h-4" /> : <s.icon className="w-4 h-4" />}
              <span>{s.label}</span>
            </div>
            {i < 1 && <ChevronRight className="w-4 h-4 text-foreground-muted flex-shrink-0" />}
          </div>
        ))}
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Main Form Fields */}
          <div className={`${step === 2 && licenseImagePreview ? "lg:col-span-7" : "lg:col-span-12"} space-y-6`}>
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-semibold">
                  {step === 1 ? "Personal & Employment Details" : "Driver's License Details & Verification"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {step === 1 && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="first_name">First Name *</Label>
                        <Input id="first_name" {...form.register("first_name")} placeholder="e.g. Juan" />
                        {form.formState.errors.first_name && (
                          <p className="text-xs text-danger">{form.formState.errors.first_name.message}</p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="last_name">Last Name *</Label>
                        <Input id="last_name" {...form.register("last_name")} placeholder="e.g. Dela Cruz" />
                        {form.formState.errors.last_name && (
                          <p className="text-xs text-danger">{form.formState.errors.last_name.message}</p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="email">Email Address</Label>
                        <Input id="email" type="email" {...form.register("email")} placeholder="driver@example.com" />
                        {form.formState.errors.email && (
                          <p className="text-xs text-danger">{form.formState.errors.email.message}</p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="phone">Phone Number</Label>
                        <Input id="phone" {...form.register("phone")} placeholder="+63 912 345 6789" />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="branch_id">Assigned Branch</Label>
                        <Select
                          value={values.branch_id ? String(values.branch_id) : "none"}
                          onValueChange={(val) => form.setValue("branch_id", val === "none" ? null : Number(val))}
                        >
                          <SelectTrigger><SelectValue placeholder="Select branch (optional)" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Headquarters / Unassigned</SelectItem>
                            {branches.map((b) => (
                              <SelectItem key={b.branch_id} value={String(b.branch_id)}>
                                {b.branch_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="position">Position Title</Label>
                        <Input id="position" {...form.register("position")} placeholder="Driver" />
                      </div>
                    </div>
                  </>
                )}

                {step === 2 && (
                  <>
                    {/* ── LICENSE FILE UPLOAD & URL SECTION ── */}
                    <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold uppercase tracking-wider text-foreground">
                          Upload Driver's License Card Image (For Double Checking)
                        </Label>
                        {licenseImagePreview && (
                          <span className="text-xs text-success font-medium flex items-center gap-1">
                            <Check className="w-3.5 h-3.5" /> License Preview Attached
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {/* Upload File Input */}
                        <div className="relative border-2 border-dashed border-border hover:border-primary/50 rounded-xl p-3 text-center transition-colors bg-surface">
                          <input
                            type="file"
                            accept="image/*,.pdf"
                            onChange={handleFileUpload}
                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                          />
                          <div className="flex items-center justify-center gap-2 text-xs text-foreground-secondary">
                            <Upload className="w-4 h-4 text-primary" />
                            <span>Upload Scan / Photo</span>
                          </div>
                        </div>

                        {/* Image URL input */}
                        <Input
                          placeholder="Or paste License Image URL..."
                          value={values.license_image_url || ""}
                          onChange={(e) => {
                            const url = e.target.value;
                            form.setValue("license_image_url", url);
                            if (url.startsWith("http") || url.startsWith("data:")) {
                              setLicenseImagePreview(url);
                            }
                          }}
                          className="h-10 text-xs"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="license_number">License Number *</Label>
                        <Input
                          id="license_number"
                          {...form.register("license_number")}
                          placeholder="e.g. N01-23-456789"
                          className="font-mono"
                        />
                        {form.formState.errors.license_number && (
                          <p className="text-xs text-danger">{form.formState.errors.license_number.message}</p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="license_expiry">License Expiry Date</Label>
                        <Input id="license_expiry" type="date" {...form.register("license_expiry")} />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="license_type">License Type</Label>
                        <Input
                          id="license_type"
                          value="Professional Driver"
                          readOnly
                          className="bg-muted text-foreground font-medium cursor-not-allowed"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="years_of_experience">Years Experience</Label>
                        <Input id="years_of_experience" type="number" min="0" {...form.register("years_of_experience")} />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="license_class">Vehicle License Class *</Label>
                      <Select
                        value={values.license_class || "B"}
                        onValueChange={(val) => form.setValue("license_class", val)}
                      >
                        <SelectTrigger className="w-full text-left font-normal truncate">
                          <SelectValue placeholder="Select Vehicle Class" className="truncate block" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="B">Class B — Passenger Cars & Light Vehicles</SelectItem>
                          <SelectItem value="B1">Class B1 — Light Vans & Commercial Vehicles</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="driver_status">Initial Driver Status</Label>
                      <Select
                        value={values.driver_status || "Available"}
                        onValueChange={(val) => form.setValue("driver_status", val)}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Available">Available</SelectItem>
                          <SelectItem value="Off Duty">Off Duty</SelectItem>
                          <SelectItem value="On Leave">On Leave</SelectItem>
                          <SelectItem value="Suspended">Suspended</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}

                {/* ── Form Navigation Buttons ── */}
                <div className="flex items-center justify-between pt-4 border-t border-border">
                  {step === 2 ? (
                    <Button type="button" variant="outline" onClick={() => setStep(1)} disabled={isSubmitting}>
                      Back
                    </Button>
                  ) : (
                    <div />
                  )}
                  {step === 1 ? (
                    <Button type="button" onClick={handleNextStep}>
                      Next — License & Double Check <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  ) : (
                    <Button type="submit" disabled={isSubmitting}>
                      {isSubmitting ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Registering Driver...</>
                      ) : (
                        <><CheckCircle2 className="w-4 h-4 mr-1" /> Create Driver</>
                      )}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── SIDE-BY-SIDE PREVIEW & DOUBLE CHECK PANEL (Step 2) ── */}
          {step === 2 && licenseImagePreview && (
            <div className="lg:col-span-5 space-y-4">
              <Card className="border-0 shadow-sm sticky top-6">
                <CardHeader className="pb-3 border-b border-border">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Eye className="w-4 h-4 text-primary" /> License Image Double Check
                    </CardTitle>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-primary"
                      onClick={() => setEnlargeModalOpen(true)}
                    >
                      <ZoomIn className="w-3.5 h-3.5 mr-1" /> Enlarge
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-4 space-y-4">
                  {/* High Resolution Preview */}
                  <div className="relative rounded-xl overflow-hidden border border-border bg-black/5 aspect-[16/10] flex items-center justify-center group">
                    <img
                      src={licenseImagePreview}
                      alt="Driver License Preview"
                      className="object-contain w-full h-full"
                    />
                    <div
                      className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
                      onClick={() => setEnlargeModalOpen(true)}
                    >
                      <span className="text-white text-xs font-semibold flex items-center gap-1.5 bg-black/60 px-3 py-1.5 rounded-lg backdrop-blur-sm">
                        <ZoomIn className="w-4 h-4" /> Click to Zoom & Verify
                      </span>
                    </div>
                  </div>

                  {/* Field Verification Checklist */}
                  <div className="bg-muted/40 rounded-xl p-3.5 border border-border space-y-2 text-xs">
                    <p className="font-semibold text-foreground flex items-center justify-between">
                      <span>Field Verification Checklist</span>
                      <span className="text-[10px] text-foreground-muted">Double Check Inputted Values</span>
                    </p>

                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center justify-between py-1 border-b border-border/50">
                        <span className="text-foreground-muted">Name:</span>
                        <span className="font-medium text-foreground">
                          {values.first_name || "—"} {values.last_name || "—"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-1 border-b border-border/50">
                        <span className="text-foreground-muted">License #:</span>
                        <span className="font-mono font-medium text-foreground">
                          {values.license_number || "—"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-1 border-b border-border/50">
                        <span className="text-foreground-muted">Class & Type:</span>
                        <span className="font-medium text-foreground">
                          Class {values.license_class} • {values.license_type}
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-1">
                        <span className="text-foreground-muted">Expiry Date:</span>
                        <span className="font-medium text-foreground">
                          {values.license_expiry || "Not Specified"}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </form>

      {/* ── ENLARGED LICENSE ZOOM MODAL ── */}
      <Dialog open={enlargeModalOpen} onOpenChange={setEnlargeModalOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <IdCard className="w-5 h-5 text-primary" /> Driver License Verification Preview
            </DialogTitle>
          </DialogHeader>
          <div className="p-2 flex items-center justify-center max-h-[70vh] overflow-auto bg-black/5 rounded-xl border border-border">
            {licenseImagePreview ? (
              <img
                src={licenseImagePreview}
                alt="License Full Preview"
                className="max-h-[65vh] w-auto object-contain rounded-lg shadow-md"
              />
            ) : (
              <p className="text-sm text-foreground-muted py-12">No license image loaded.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
