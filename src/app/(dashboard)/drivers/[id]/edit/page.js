"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
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
import { getDriver, updateDriver } from "@/services/driver.service";
import { getBranches } from "@/services/vehicle.service";
import { toast } from "@/components/ui/toast";
import { ArrowLeft, Loader2, Save, Upload, Eye, ZoomIn, IdCard, Check } from "lucide-react";
import Link from "next/link";
import { useRequireRole } from "@/lib/auth/role-guard";

const editDriverSchema = z.object({
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

export default function EditDriverPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager"]);
  const router = useRouter();
  const { id } = useParams();
  const queryClient = useQueryClient();

  const [licenseImagePreview, setLicenseImagePreview] = useState(null);
  const [enlargeModalOpen, setEnlargeModalOpen] = useState(false);

  const { data: driver, isLoading, isError } = useQuery({
    queryKey: ["driver", id],
    queryFn: () => getDriver(id),
    enabled: !!id,
  });

  const { data: branches = [] } = useQuery({
    queryKey: ["branches"],
    queryFn: getBranches,
  });

  const form = useForm({
    resolver: zodResolver(editDriverSchema),
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

  useEffect(() => {
    if (!driver) return;
    const emp = driver.employees || {};
    const imgUrl = driver.face_image_url || emp.avatar_url || "";
    if (imgUrl) setLicenseImagePreview(imgUrl);

    form.reset({
      first_name: emp.first_name || "",
      last_name: emp.last_name || "",
      email: emp.email || "",
      phone: emp.phone || "",
      branch_id: emp.branch_id ? Number(emp.branch_id) : null,
      position: emp.position || "Driver",
      license_number: driver.license_number || "",
      license_expiry: driver.license_expiry ? driver.license_expiry.split("T")[0] : "",
      license_type: driver.license_type || "Professional",
      license_class: driver.license_class || "B",
      years_of_experience: driver.years_of_experience ?? 0,
      driver_status: driver.driver_status || "Available",
      license_image_url: imgUrl,
    });
  }, [driver, form]);

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
        toast.success("License scan updated for preview verification!");
      };
      reader.readAsDataURL(file);
    }
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
    };

    if (data.email?.trim()) payload.email = data.email.trim();
    if (data.phone?.trim()) payload.phone = data.phone.trim();
    payload.branch_id = data.branch_id ? Number(data.branch_id) : null;
    if (data.license_expiry) payload.license_expiry = data.license_expiry;
    if (data.license_type) payload.license_type = data.license_type;
    if (data.license_class) payload.license_class = data.license_class;

    updateMutation.mutate(payload);
  };

  const values = form.watch();
  const isSaving = updateMutation.isPending;

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="h-8 w-48 bg-muted rounded-xl animate-pulse" />
        <div className="h-96 bg-muted rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (isError || !driver) {
    return (
      <div className="max-w-3xl mx-auto p-12 text-center space-y-4">
        <p className="text-lg font-semibold text-foreground">Driver Not Found</p>
        <Button onClick={() => router.push("/drivers")}>Back to Drivers List</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* ── Header ── */}
      <div className="flex items-center gap-4">
        <Link href={`/drivers/${id}`} className="text-foreground-secondary hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Edit Driver Profile</h1>
          <p className="text-foreground-secondary mt-1">
            Update details and double-check license card for {driver.employees?.first_name} {driver.employees?.last_name}
          </p>
        </div>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className={`${licenseImagePreview ? "lg:col-span-7" : "lg:col-span-12"} space-y-6`}>
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-semibold">Driver Information Form</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Personal Info */}
                <section className="space-y-4">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground-secondary">
                    Personal Information
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="first_name">First Name *</Label>
                      <Input id="first_name" {...form.register("first_name")} />
                      {form.formState.errors.first_name && (
                        <p className="text-xs text-danger">{form.formState.errors.first_name.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="last_name">Last Name *</Label>
                      <Input id="last_name" {...form.register("last_name")} />
                      {form.formState.errors.last_name && (
                        <p className="text-xs text-danger">{form.formState.errors.last_name.message}</p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="email">Email Address</Label>
                      <Input id="email" type="email" {...form.register("email")} />
                      {form.formState.errors.email && (
                        <p className="text-xs text-danger">{form.formState.errors.email.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="phone">Phone Number</Label>
                      <Input id="phone" {...form.register("phone")} />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="branch_id">Assigned Branch</Label>
                      <Select
                        value={values.branch_id ? String(values.branch_id) : "none"}
                        onValueChange={(val) => form.setValue("branch_id", val === "none" ? null : Number(val))}
                      >
                        <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
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
                      <Input id="position" {...form.register("position")} />
                    </div>
                  </div>
                </section>

                {/* License & Driving Info */}
                <section className="space-y-4 border-t border-border pt-5">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground-secondary">
                    License Details & Verification Scan
                  </h2>

                  {/* Upload / URL Box */}
                  <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold uppercase tracking-wider text-foreground">
                        Driver's License Image
                      </Label>
                      {licenseImagePreview && (
                        <span className="text-xs text-success font-medium flex items-center gap-1">
                          <Check className="w-3.5 h-3.5" /> License Preview Ready
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="relative border-2 border-dashed border-border hover:border-primary/50 rounded-xl p-3 text-center transition-colors bg-surface">
                        <input
                          type="file"
                          accept="image/*,.pdf"
                          onChange={handleFileUpload}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        />
                        <div className="flex items-center justify-center gap-2 text-xs text-foreground-secondary">
                          <Upload className="w-4 h-4 text-primary" />
                          <span>Update Scan / Photo</span>
                        </div>
                      </div>

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
                      <Input id="license_number" {...form.register("license_number")} className="font-mono" />
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
                    <Label htmlFor="driver_status">Driver Operational Status</Label>
                    <Select
                      value={values.driver_status || "Available"}
                      onValueChange={(val) => form.setValue("driver_status", val)}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Available">Available</SelectItem>
                        <SelectItem value="On Trip">On Trip</SelectItem>
                        <SelectItem value="Off Duty">Off Duty</SelectItem>
                        <SelectItem value="On Leave">On Leave</SelectItem>
                        <SelectItem value="Suspended">Suspended</SelectItem>
                        <SelectItem value="Inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </section>

                {/* Actions */}
                <div className="flex items-center justify-end gap-3 border-t border-border pt-5">
                  <Button type="button" variant="outline" onClick={() => router.back()} disabled={isSaving}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSaving}>
                    {isSaving ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving Changes...</>
                    ) : (
                      <><Save className="w-4 h-4 mr-2" /> Save Changes</>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Side-by-side Preview Panel */}
          {licenseImagePreview && (
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
                        <ZoomIn className="w-4 h-4" /> Click to Zoom
                      </span>
                    </div>
                  </div>

                  <div className="bg-muted/40 rounded-xl p-3.5 border border-border space-y-2 text-xs">
                    <p className="font-semibold text-foreground">Double Check Inputted Info</p>
                    <div className="space-y-1 pt-1 text-foreground-secondary">
                      <div><span className="font-medium text-foreground">Name:</span> {values.first_name} {values.last_name}</div>
                      <div><span className="font-medium text-foreground">License #:</span> {values.license_number}</div>
                      <div><span className="font-medium text-foreground">Class & Type:</span> Class {values.license_class} • {values.license_type}</div>
                      <div><span className="font-medium text-foreground">Expiry:</span> {values.license_expiry || "Not Specified"}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </form>

      {/* Enlarged Modal */}
      <Dialog open={enlargeModalOpen} onOpenChange={setEnlargeModalOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <IdCard className="w-5 h-5 text-primary" /> License Image Zoom
            </DialogTitle>
          </DialogHeader>
          <div className="p-2 flex items-center justify-center max-h-[70vh] overflow-auto bg-black/5 rounded-xl border border-border">
            <img
              src={licenseImagePreview}
              alt="License Full Preview"
              className="max-h-[65vh] w-auto object-contain rounded-lg shadow-md"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
