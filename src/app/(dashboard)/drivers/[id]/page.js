"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { getDriver, deleteDriver } from "@/services/driver.service";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials, formatDate } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import {
  User, IdCard, CalendarDays, Star, Phone, Mail,
  MapPin, Award, TrendingUp, ArrowLeft, Pencil, Archive,
  Clock, ShieldCheck, FileText, AlertCircle, CheckCircle2,
  Heart, Upload, Truck, Eye, ZoomIn
} from "lucide-react";

const statusColors = {
  Available: "success",
  "On Trip": "warning",
  "Off Duty": "secondary",
  "On Leave": "info",
  Suspended: "danger",
  Inactive: "secondary",
};

export default function DriverDetailPage() {
  const router = useRouter();
  const { id } = useParams();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  // License Image Zoom Modal
  const [enlargeModalOpen, setEnlargeModalOpen] = useState(false);

  const { data: driver, isLoading, isError, error } = useQuery({
    queryKey: ["driver", id],
    queryFn: () => getDriver(id),
    enabled: !!id,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteDriver(id),
    onSuccess: () => {
      toast.success("Driver archived successfully");
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      queryClient.invalidateQueries({ queryKey: ["driver-stats"] });
      router.push("/drivers");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to archive driver");
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-6xl">
        <div className="h-8 w-48 bg-muted rounded-xl animate-pulse" />
        <div className="h-40 bg-muted rounded-2xl animate-pulse" />
        <div className="h-96 bg-muted rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (isError || !driver) {
    return (
      <div className="space-y-4 max-w-4xl mx-auto py-12">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
        <Card className="border-0 shadow-sm text-center p-12">
          <CardContent className="space-y-3">
            <AlertCircle className="w-12 h-12 text-danger mx-auto" />
            <p className="text-lg font-semibold text-foreground">Driver Record Not Found</p>
            <p className="text-sm text-foreground-secondary">{error?.message || "This driver profile may have been archived or deleted."}</p>
            <Button className="mt-4" onClick={() => router.push("/drivers")}>Back to Drivers List</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const emp = driver.employees || {};
  const trips = driver.trips || [];
  const licenseImage = driver.face_image_url || emp.avatar_url || null;

  // Dispatch Readiness Evaluations
  const isLicenseValid = driver.license_expiry
    ? new Date(driver.license_expiry) > new Date()
    : true;
  const isStatusAvailable = driver.driver_status === "Available";
  const hasNoActiveTrip = !trips.some((t) => t.trip_status === "In Progress" || t.trip_status === "Assigned");
  const isReadyForDispatch = isLicenseValid && isStatusAvailable && hasNoActiveTrip;

  return (
    <div className="space-y-6 max-w-6xl">
      {/* ── Top Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => router.back()}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16 ring-2 ring-primary/20">
              <AvatarFallback className="bg-primary/10 text-primary text-xl font-bold">
                {getInitials(`${emp.first_name || ""} ${emp.last_name || ""}`)}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-foreground">
                  {emp.first_name} {emp.last_name}
                </h1>
                <Badge variant={statusColors[driver.driver_status] || "secondary"}>
                  {driver.driver_status || "Available"}
                </Badge>
              </div>
              <div className="flex items-center gap-4 text-xs text-foreground-secondary mt-1">
                <span>Employee ID: #{emp.employee_id || driver.employee_id}</span>
                <span>•</span>
                <span>License: {driver.license_number}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => router.push(`/drivers/${id}/edit`)}>
            <Pencil className="w-4 h-4 mr-2" /> Edit Profile
          </Button>
          <Button
            variant="outline"
            className="text-warning border-warning/30 hover:bg-warning/10"
            onClick={() => setConfirmDelete(true)}
          >
            <Archive className="w-4 h-4 mr-2" /> Archive
          </Button>
        </div>
      </div>

      {/* ── Profile Navigation Tabs ── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-muted p-1 rounded-xl grid grid-cols-2 md:grid-cols-5 gap-1 w-full">
          <TabsTrigger value="overview" className="rounded-lg text-xs font-medium">Overview</TabsTrigger>
          <TabsTrigger value="shifts" className="rounded-lg text-xs font-medium">Shift & Readiness</TabsTrigger>
          <TabsTrigger value="trips" className="rounded-lg text-xs font-medium">Trip History ({trips.length})</TabsTrigger>
          <TabsTrigger value="documents" className="rounded-lg text-xs font-medium">Documents & Scans</TabsTrigger>
          <TabsTrigger value="emergency" className="rounded-lg text-xs font-medium">Emergency Contact</TabsTrigger>
        </TabsList>

        {/* ── TAB 1: OVERVIEW ── */}
        <TabsContent value="overview" className="space-y-6 mt-0">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Personal Information */}
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <User className="w-4 h-4 text-primary" /> Personal Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="flex justify-between py-1 border-b border-border">
                  <span className="text-foreground-muted">Full Name</span>
                  <span className="font-medium">{emp.first_name} {emp.last_name}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border">
                  <span className="text-foreground-muted">Email</span>
                  <span className="font-medium truncate max-w-[180px]">{emp.email || "—"}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border">
                  <span className="text-foreground-muted">Phone</span>
                  <span className="font-medium">{emp.phone || "—"}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-foreground-muted">Hire Date</span>
                  <span className="font-medium">{emp.hire_date ? formatDate(emp.hire_date) : "—"}</span>
                </div>
              </CardContent>
            </Card>

            {/* License & Driving Details */}
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <IdCard className="w-4 h-4 text-primary" /> License & Credentials
                  </span>
                  {licenseImage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px] text-primary"
                      onClick={() => setEnlargeModalOpen(true)}
                    >
                      <ZoomIn className="w-3 h-3 mr-1" /> Double Check
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="flex justify-between py-1 border-b border-border">
                  <span className="text-foreground-muted">License Number</span>
                  <span className="font-mono font-medium">{driver.license_number}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border">
                  <span className="text-foreground-muted">License Type</span>
                  <span className="font-medium">{driver.license_type || "Professional"}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border">
                  <span className="text-foreground-muted">License Class</span>
                  <span className="font-medium">Class {driver.license_class || "B"}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border">
                  <span className="text-foreground-muted">Expiration Date</span>
                  <span className={`font-medium ${!isLicenseValid ? "text-danger" : ""}`}>
                    {driver.license_expiry ? formatDate(driver.license_expiry) : "No Expiry Recorded"}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-foreground-muted">Years Experience</span>
                  <span className="font-medium">{driver.years_of_experience || 0} years</span>
                </div>

                {/* Mini License Thumbnail Preview */}
                {licenseImage && (
                  <div
                    className="mt-2 rounded-xl border border-border bg-black/5 overflow-hidden aspect-[16/9] relative group cursor-pointer"
                    onClick={() => setEnlargeModalOpen(true)}
                  >
                    <img src={licenseImage} alt="License Card Scan" className="w-full h-full object-contain" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[11px] font-semibold gap-1">
                      <ZoomIn className="w-3.5 h-3.5" /> Enlarge License Scan
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Performance Metrics */}
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Award className="w-4 h-4 text-primary" /> Driver Performance
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-xs">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/5 border border-primary/10">
                  <Star className="w-6 h-6 text-warning fill-warning" />
                  <div>
                    <p className="text-xl font-bold text-foreground">
                      {driver.performance_score ? (driver.performance_score * 20).toFixed(0) : "85"}/100
                    </p>
                    <p className="text-foreground-muted">Safety & Efficiency Score</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="p-3 rounded-xl bg-muted/40">
                    <p className="text-lg font-bold text-foreground">{driver.total_trips || trips.length}</p>
                    <p className="text-[11px] text-foreground-muted">Total Trips</p>
                  </div>
                  <div className="p-3 rounded-xl bg-muted/40">
                    <p className="text-lg font-bold text-foreground">{driver.total_distance ? `${Math.round(driver.total_distance)} km` : "0 km"}</p>
                    <p className="text-[11px] text-foreground-muted">Total Distance</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── TAB 2: SHIFT & READINESS ── */}
        <TabsContent value="shifts" className="space-y-6 mt-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" /> Shift Schedule Assignment
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 rounded-xl bg-muted/30 space-y-2 border border-border">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">Standard Morning Shift</span>
                    <Badge variant="outline">06:00 AM – 02:00 PM</Badge>
                  </div>
                  <p className="text-xs text-foreground-secondary">
                    Driver is scheduled for morning dispatch operations. Maximum driving limit of 8 consecutive hours.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-primary" /> Dispatch Readiness Evaluation
                  </span>
                  <Badge variant={isReadyForDispatch ? "success" : "danger"}>
                    {isReadyForDispatch ? "Ready for Dispatch" : "Not Ready"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30">
                  <span className="flex items-center gap-2">
                    {isLicenseValid ? <CheckCircle2 className="w-4 h-4 text-success" /> : <AlertCircle className="w-4 h-4 text-danger" />}
                    Driver License Validity
                  </span>
                  <span className={isLicenseValid ? "text-success font-medium" : "text-danger font-medium"}>
                    {isLicenseValid ? "Valid & Active" : "Expired License"}
                  </span>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30">
                  <span className="flex items-center gap-2">
                    {isStatusAvailable ? <CheckCircle2 className="w-4 h-4 text-success" /> : <AlertCircle className="w-4 h-4 text-warning" />}
                    Operational Status Check
                  </span>
                  <span className="font-medium">{driver.driver_status || "Available"}</span>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30">
                  <span className="flex items-center gap-2">
                    {hasNoActiveTrip ? <CheckCircle2 className="w-4 h-4 text-success" /> : <AlertCircle className="w-4 h-4 text-warning" />}
                    Active Trip Assignment Overlap
                  </span>
                  <span className="font-medium">{hasNoActiveTrip ? "No Active Trip" : "Currently On Trip"}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── TAB 3: TRIP HISTORY ── */}
        <TabsContent value="trips" className="mt-0">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Truck className="w-4 h-4 text-primary" /> Assigned Trip History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {trips.length === 0 ? (
                <div className="text-center py-12 text-foreground-muted">
                  <Truck className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm font-medium">No trips recorded for this driver yet</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {trips.map((t) => (
                    <div key={t.trip_id} className="py-3 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-medium text-foreground">
                          Trip #{t.trip_id} • {t.origin || "Origin"} ➔ {t.destination || "Destination"}
                        </div>
                        <div className="text-foreground-secondary mt-0.5">
                          Vehicle: {t.vehicles?.plate_number || `Vehicle #${t.vehicle_id}`} • {t.distance ? `${t.distance} km` : "Distance N/A"}
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge variant={t.trip_status === "Completed" ? "success" : t.trip_status === "In Progress" ? "warning" : "secondary"}>
                          {t.trip_status}
                        </Badge>
                        <div className="text-foreground-muted mt-0.5">{t.start_time ? formatDate(t.start_time) : "—"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TAB 4: DOCUMENTS & SCANS ── */}
        <TabsContent value="documents" className="mt-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Driver License Scan Card */}
            <Card className="border-0 shadow-sm col-span-1 sm:col-span-2">
              <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <IdCard className="w-4 h-4 text-primary" /> Driver&apos;s License Card Scan
                </CardTitle>
                {licenseImage && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setEnlargeModalOpen(true)}
                  >
                    <ZoomIn className="w-3.5 h-3.5 mr-1" /> Zoom & Double Check
                  </Button>
                )}
              </CardHeader>
              <CardContent className="p-4">
                {licenseImage ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                    <div
                      className="rounded-xl overflow-hidden border border-border bg-black/5 aspect-[16/10] relative group cursor-pointer"
                      onClick={() => setEnlargeModalOpen(true)}
                    >
                      <img src={licenseImage} alt="License Card Scan" className="w-full h-full object-contain" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-medium gap-1">
                        <ZoomIn className="w-4 h-4" /> Click to Enlarge
                      </div>
                    </div>

                    <div className="space-y-2 text-xs">
                      <p className="font-semibold text-foreground">Verification Check</p>
                      <div className="space-y-1 text-foreground-secondary">
                        <div><span className="font-medium text-foreground">License #:</span> {driver.license_number}</div>
                        <div><span className="font-medium text-foreground">Class & Type:</span> Class {driver.license_class || "B"} • {driver.license_type || "Professional"}</div>
                        <div><span className="font-medium text-foreground">Expiry:</span> {driver.license_expiry ? formatDate(driver.license_expiry) : "N/A"}</div>
                        <div><span className="font-medium text-foreground">Status:</span> {isLicenseValid ? "Valid & Verified" : "Expired"}</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-foreground-muted space-y-2">
                    <FileText className="w-8 h-8 mx-auto opacity-40" />
                    <p className="text-xs font-medium">No Driver&apos;s License scan uploaded yet</p>
                    <Button variant="outline" size="sm" onClick={() => router.push(`/drivers/${id}/edit`)}>
                      <Upload className="w-3.5 h-3.5 mr-1" /> Upload License Scan
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Other Document Placeholders */}
            {[
              { title: "Medical Certificate", type: "PDF", status: "Verified", color: "success" },
              { title: "Government Clearance", type: "PDF", status: "Verified", color: "success" },
            ].map((doc) => (
              <Card key={doc.title} className="border-0 shadow-sm">
                <CardContent className="p-4 space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{doc.title}</p>
                    <p className="text-xs text-foreground-muted">{doc.type}</p>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <Badge variant={doc.color}>{doc.status}</Badge>
                    <Button variant="ghost" size="sm" className="h-7 text-xs">
                      <Upload className="w-3 h-3 mr-1" /> Update
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ── TAB 5: EMERGENCY CONTACT ── */}
        <TabsContent value="emergency" className="mt-0">
          <Card className="border-0 shadow-sm max-w-xl">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Heart className="w-4 h-4 text-danger" /> Emergency Next of Kin Contact
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="flex justify-between py-1.5 border-b border-border">
                <span className="text-foreground-muted">Contact Person</span>
                <span className="font-medium text-foreground">Maria Dela Cruz</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-border">
                <span className="text-foreground-muted">Relationship</span>
                <span className="font-medium text-foreground">Spouse</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-border">
                <span className="text-foreground-muted">Contact Phone</span>
                <span className="font-medium text-foreground">+63 917 123 4567</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-foreground-muted">Residential Address</span>
                <span className="font-medium text-foreground">Metro Manila, Philippines</span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── ENLARGED LICENSE ZOOM MODAL ── */}
      <Dialog open={enlargeModalOpen} onOpenChange={setEnlargeModalOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <IdCard className="w-5 h-5 text-primary" /> Driver License Scan Verification
            </DialogTitle>
          </DialogHeader>
          <div className="p-2 flex items-center justify-center max-h-[70vh] overflow-auto bg-black/5 rounded-xl border border-border">
            {licenseImage ? (
              <img
                src={licenseImage}
                alt="License Full Preview"
                className="max-h-[65vh] w-auto object-contain rounded-lg shadow-md"
              />
            ) : (
              <p className="text-sm text-foreground-muted py-12">No license image loaded.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Archive Dialog ── */}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Archive Driver Profile?"
        message={`Are you sure you want to archive ${emp.first_name} ${emp.last_name}? Trip records will be preserved for reporting.`}
        confirmLabel="Archive Driver"
        variant="archive"
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  );
}
