"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { getDriver, deleteDriver } from "@/services/driver.service";
import { DetailSkeleton } from "@/components/ui/skeleton";
import { AssignedVehicleCard } from "@/components/drivers/assigned-vehicle-card";
import { useRoleAccess } from "@/hooks/use-role-access";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials, formatDate } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import {
  User, IdCard, CalendarDays, Star, Phone, Mail,
  MapPin, Award, TrendingUp, ArrowLeft, Pencil, Archive,
  Clock, ShieldCheck, FileText, AlertCircle, CheckCircle2,
  Heart, Upload, Truck, Eye, ZoomIn, FileImage, ShieldAlert,
  Globe, Calendar, Briefcase, Activity
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
  const { can } = useRoleAccess();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  // License Image Zoom Modal
  const [previewModalUrl, setPreviewModalUrl] = useState(null);

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

  if (isLoading) return <DetailSkeleton />;

  if (isError || !driver) {
    return (
      <div className="space-y-4 max-w-4xl mx-auto py-12">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
        <Card className="border-0 shadow-sm text-center p-12 rounded-2xl">
          <CardContent className="space-y-3">
            <AlertCircle className="w-12 h-12 text-danger mx-auto" />
            <p className="text-lg font-bold text-foreground">Driver Record Not Found</p>
            <p className="text-xs text-foreground-secondary">{error?.message || "This driver profile may have been archived or deleted."}</p>
            <Button className="mt-4 rounded-xl" onClick={() => router.push("/drivers")}>Back to Drivers List</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const emp = driver.employees || {};
  const trips = driver.trips || [];
  const licenseImage = driver.face_image_url || emp.avatar_url || driver.license_image_url || null;
  const licenseBackImage = driver.license_back_image_url || null;

  // Dispatch Readiness Evaluations
  const isLicenseValid = driver.license_expiry
    ? new Date(driver.license_expiry) > new Date()
    : true;
  const isStatusAvailable = driver.driver_status === "Available";
  const hasNoActiveTrip = !trips.some((t) => t.trip_status === "In Progress" || t.trip_status === "Assigned");
  const isReadyForDispatch = isLicenseValid && isStatusAvailable && hasNoActiveTrip;

  return (
    <div className="space-y-6 w-full pb-6">
      {/* ── Top Header Banner Card ── */}
      <div className="bg-surface border border-border p-6 rounded-2xl shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="icon" className="rounded-xl shrink-0" onClick={() => router.push("/drivers")}>
              <ArrowLeft className="w-5 h-5 text-foreground-secondary" />
            </Button>
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16 ring-4 ring-primary/10">
                <AvatarFallback className="bg-primary/10 text-primary text-xl font-bold">
                  {getInitials(`${emp.first_name || ""} ${emp.last_name || ""}`)}
                </AvatarFallback>
              </Avatar>
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-2xl font-bold text-foreground">
                    {emp.first_name} {emp.last_name}
                  </h1>
                  <Badge variant={statusColors[driver.driver_status] || "secondary"} className="rounded-full px-3 py-0.5 text-xs font-semibold">
                    {driver.driver_status || "Available"}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-xs text-foreground-secondary mt-1 flex-wrap font-medium">
                  <span>Employee ID: #{emp.employee_id || driver.employee_id}</span>
                  <span>•</span>
                  <span className="font-data uppercase">License: {driver.license_number}</span>
                  <span>•</span>
                  <span>Class {driver.license_class || "B"}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2.5 shrink-0">
            <Button variant="outline" onClick={() => router.push(`/drivers/${id}/edit`)} className="rounded-xl text-xs h-9">
              <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit Profile
            </Button>
            <Button
              variant="outline"
              className="rounded-xl text-xs h-9 text-danger border-danger/30 hover:bg-danger/10"
              onClick={() => setConfirmDelete(true)}
            >
              <Archive className="w-3.5 h-3.5 mr-1.5" /> Archive Profile
            </Button>
          </div>
        </div>

        {/* Quick KPI Stat Highlights */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-border/60">
          <div className="p-3 rounded-xl bg-muted/20 border border-border/50">
            <span className="text-[11px] text-foreground-secondary block">Dispatch Readiness</span>
            <span className={`text-xs font-bold ${isReadyForDispatch ? "text-success" : "text-warning"}`}>
              {isReadyForDispatch ? "Ready for Dispatch" : "Not Ready"}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-muted/20 border border-border/50">
            <span className="text-[11px] text-foreground-secondary block">Total Trips Completed</span>
            <span className="text-xs font-bold text-foreground">{driver.total_trips || trips.length} Trips</span>
          </div>
          <div className="p-3 rounded-xl bg-muted/20 border border-border/50">
            <span className="text-[11px] text-foreground-secondary block">Driving Experience</span>
            <span className="text-xs font-bold text-foreground">{driver.years_of_experience ?? 0} Years</span>
          </div>
          <div className="p-3 rounded-xl bg-muted/20 border border-border/50">
            <span className="text-[11px] text-foreground-secondary block">Safety Rating</span>
            <span className="text-xs font-bold text-amber-600 dark:text-amber-400">
              {driver.performance_score ? (driver.performance_score * 20).toFixed(0) : "85"}/100 Score
            </span>
          </div>
        </div>
      </div>

      {/* ── Profile Navigation Tabs ── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-surface border border-border p-1.5 rounded-2xl grid grid-cols-2 md:grid-cols-5 gap-1.5 w-full shadow-xs">
          <TabsTrigger value="overview" className="rounded-xl text-xs font-semibold py-2">
            <User className="w-3.5 h-3.5 mr-1.5" /> Overview
          </TabsTrigger>
          <TabsTrigger value="shifts" className="rounded-xl text-xs font-semibold py-2">
            <Clock className="w-3.5 h-3.5 mr-1.5" /> Shift &amp; Readiness
          </TabsTrigger>
          <TabsTrigger value="trips" className="rounded-xl text-xs font-semibold py-2">
            <Truck className="w-3.5 h-3.5 mr-1.5" /> Trips ({trips.length})
          </TabsTrigger>
          <TabsTrigger value="documents" className="rounded-xl text-xs font-semibold py-2">
            <FileImage className="w-3.5 h-3.5 mr-1.5" /> Documents &amp; Scans
          </TabsTrigger>
          <TabsTrigger value="emergency" className="rounded-xl text-xs font-semibold py-2">
            <ShieldAlert className="w-3.5 h-3.5 mr-1.5 text-amber-500" /> Emergency Contact
          </TabsTrigger>
        </TabsList>

        {/* ── TAB 1: OVERVIEW ── */}
        <TabsContent value="overview" className="space-y-6 mt-0">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* Left 7 Cols: Personal & License Details */}
            <div className="lg:col-span-7 space-y-6">
              
              {/* Personal Information */}
              <Card className="border-0 shadow-sm rounded-2xl">
                <CardHeader className="pb-3 border-b border-border/60">
                  <CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
                    <div className="p-2 rounded-xl bg-primary/10 text-primary">
                      <User className="w-4 h-4" />
                    </div>
                    Personal Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4 space-y-3 text-xs">
                  <div className="flex justify-between py-2 border-b border-border/40">
                    <span className="text-foreground-muted">Full Name</span>
                    <span className="font-semibold text-foreground">{emp.first_name} {emp.last_name}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border/40">
                    <span className="text-foreground-muted">Email Address</span>
                    <span className="font-semibold text-foreground">{emp.email || "—"}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border/40">
                    <span className="text-foreground-muted">Phone Number</span>
                    <span className="font-semibold text-foreground">{emp.phone || "—"}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border/40">
                    <span className="text-foreground-muted">Birthdate</span>
                    <span className="font-semibold text-foreground">{driver.birthdate ? formatDate(driver.birthdate) : "—"}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border/40">
                    <span className="text-foreground-muted">Sex</span>
                    <span className="font-semibold text-foreground">{driver.sex || "—"}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border/40">
                    <span className="text-foreground-muted">Nationality</span>
                    <span className="font-semibold text-foreground">{driver.nationality || "Filipino"}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-foreground-muted">Residential Address</span>
                    <span className="font-semibold text-foreground text-right">{driver.address || "—"}</span>
                  </div>
                </CardContent>
              </Card>

              {/* License & Credentials */}
              <Card className="border-0 shadow-sm rounded-2xl">
                <CardHeader className="pb-3 border-b border-border/60">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
                      <div className="p-2 rounded-xl bg-blue-500/10 text-blue-500">
                        <IdCard className="w-4 h-4" />
                      </div>
                      License &amp; Credentials
                    </CardTitle>
                    {licenseImage && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-primary"
                        onClick={() => setPreviewModalUrl(licenseImage)}
                      >
                        <ZoomIn className="w-3.5 h-3.5 mr-1" /> View Front License
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-4 space-y-3 text-xs">
                  <div className="flex justify-between py-2 border-b border-border/40">
                    <span className="text-foreground-muted">License Number</span>
                    <span className="font-bold font-data text-foreground">{driver.license_number}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border/40">
                    <span className="text-foreground-muted">Vehicle License Class</span>
                    <span className="font-semibold text-foreground">Class {driver.license_class || "B"}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border/40">
                    <span className="text-foreground-muted">License Type</span>
                    <span className="font-semibold text-foreground">{driver.license_type || "Professional"}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border/40">
                    <span className="text-foreground-muted">Expiration Date</span>
                    <span className={isLicenseValid ? "font-semibold text-foreground" : "font-semibold text-danger"}>
                      {driver.license_expiry ? formatDate(driver.license_expiry) : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-foreground-muted">Driving Experience</span>
                    <span className="font-semibold text-foreground">{driver.years_of_experience ?? 0} Years</span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right 5 Cols: Emergency Contact Quick View & Performance */}
            <div className="lg:col-span-5 space-y-6">
              
              {/* Emergency Contact Quick View */}
              <Card className="border border-amber-500/20 shadow-sm rounded-2xl bg-amber-500/5">
                <CardHeader className="pb-3 border-b border-amber-500/10 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
                    <ShieldAlert className="w-4 h-4 text-amber-500" /> Emergency Contact
                  </CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => setActiveTab("emergency")} className="h-6 text-[11px] text-amber-600 dark:text-amber-400">
                    View Details ➔
                  </Button>
                </CardHeader>
                <CardContent className="pt-3 space-y-2.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-foreground-muted">Contact Name:</span>
                    <span className="font-bold text-foreground">{driver.emergency_contact_name || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-foreground-muted">Phone Number:</span>
                    <span className="font-semibold text-foreground">{driver.emergency_contact_phone || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-foreground-muted">Address:</span>
                    <span className="font-semibold text-foreground truncate max-w-[160px]">{driver.emergency_contact_address || "—"}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Performance & Score */}
              <Card className="border-0 shadow-sm rounded-2xl">
                <CardHeader className="pb-3 border-b border-border/60">
                  <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
                    <Award className="w-4 h-4 text-primary" /> Performance &amp; Safety Rating
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4 space-y-4 text-xs">
                  <div className="flex items-center gap-3.5 p-4 rounded-xl bg-primary/5 border border-primary/10">
                    <Star className="w-7 h-7 text-amber-500 fill-amber-500 shrink-0" />
                    <div>
                      <p className="text-2xl font-bold text-foreground">
                        {driver.performance_score ? (driver.performance_score * 20).toFixed(0) : "85"}/100
                      </p>
                      <p className="text-foreground-secondary text-[11px]">Safety &amp; Efficiency Score</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-center">
                    <div className="p-3 rounded-xl bg-muted/30 border border-border/50">
                      <p className="text-base font-bold text-foreground">{driver.total_trips || trips.length}</p>
                      <p className="text-[11px] text-foreground-muted">Total Trips</p>
                    </div>
                    <div className="p-3 rounded-xl bg-muted/30 border border-border/50">
                      <p className="text-base font-bold text-foreground">{driver.total_distance ? `${Math.round(driver.total_distance)} km` : "0 km"}</p>
                      <p className="text-[11px] text-foreground-muted">Total Distance</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ── TAB 2: SHIFT & READINESS ── */}
        <TabsContent value="shifts" className="space-y-6 mt-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <AssignedVehicleCard
              side="driver"
              id={Number(id)}
              canManage={can("driver_assignments", "create")}
            />

            <Card className="border-0 shadow-sm rounded-2xl">
              <CardHeader className="pb-3 border-b border-border/60">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" /> Shift Schedule Assignment
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <div className="p-4 rounded-xl bg-muted/30 space-y-2 border border-border">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground">Standard Morning Shift</span>
                    <Badge variant="outline" className="rounded-full">06:00 AM – 02:00 PM</Badge>
                  </div>
                  <p className="text-xs text-foreground-secondary">
                    Driver is scheduled for morning dispatch operations. Maximum driving limit of 8 consecutive hours.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm rounded-2xl md:col-span-2">
              <CardHeader className="pb-3 border-b border-border/60">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-primary" /> Dispatch Readiness Evaluation
                  </CardTitle>
                  <Badge variant={isReadyForDispatch ? "success" : "danger"} className="rounded-full px-3">
                    {isReadyForDispatch ? "Ready for Dispatch" : "Not Ready"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-4 space-y-3 text-xs">
                <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border/50">
                  <span className="flex items-center gap-2 font-medium">
                    {isLicenseValid ? <CheckCircle2 className="w-4 h-4 text-success" /> : <AlertCircle className="w-4 h-4 text-danger" />}
                    Driver License Validity
                  </span>
                  <span className={isLicenseValid ? "text-success font-bold" : "text-danger font-bold"}>
                    {isLicenseValid ? "Valid & Active" : "Expired License"}
                  </span>
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border/50">
                  <span className="flex items-center gap-2 font-medium">
                    {isStatusAvailable ? <CheckCircle2 className="w-4 h-4 text-success" /> : <AlertCircle className="w-4 h-4 text-warning" />}
                    Operational Status Check
                  </span>
                  <span className="font-bold text-foreground">{driver.driver_status || "Available"}</span>
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border/50">
                  <span className="flex items-center gap-2 font-medium">
                    {hasNoActiveTrip ? <CheckCircle2 className="w-4 h-4 text-success" /> : <AlertCircle className="w-4 h-4 text-warning" />}
                    Active Trip Assignment Overlap
                  </span>
                  <span className="font-bold text-foreground">{hasNoActiveTrip ? "No Active Trip" : "Currently On Trip"}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── TAB 3: TRIP HISTORY ── */}
        <TabsContent value="trips" className="mt-0">
          <Card className="border-0 shadow-sm rounded-2xl">
            <CardHeader className="pb-3 border-b border-border/60">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Truck className="w-4 h-4 text-primary" /> Completed &amp; Assigned Trip History
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {trips.length > 0 ? (
                <div className="space-y-3 text-xs">
                  {trips.map((trip) => (
                    <div
                      key={trip.trip_id}
                      className="p-4 rounded-xl border border-border bg-surface flex flex-col md:flex-row md:items-center md:justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-foreground">Trip #{trip.trip_id}</span>
                          <Badge variant="outline" className="rounded-full">{trip.trip_status}</Badge>
                        </div>
                        <p className="text-foreground-secondary">
                          {trip.origin_name || "Depot"} ➔ {trip.destination_name || "Destination"}
                        </p>
                      </div>
                      <div className="text-right text-foreground-muted">
                        <p>{trip.scheduled_departure ? formatDate(trip.scheduled_departure) : "—"}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-foreground-muted text-xs">
                  No trip history records found for this driver.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TAB 4: DOCUMENTS & SCANS ── */}
        <TabsContent value="documents" className="mt-0 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Front License Card */}
            <Card className="border-0 shadow-sm rounded-2xl overflow-hidden">
              <CardHeader className="pb-3 border-b border-border/60 bg-muted/20 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <FileImage className="w-4 h-4 text-primary" /> Front of Driver License
                </CardTitle>
                {licenseImage && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs rounded-xl"
                    onClick={() => setPreviewModalUrl(licenseImage)}
                  >
                    <ZoomIn className="w-3.5 h-3.5 mr-1" /> Zoom Front
                  </Button>
                )}
              </CardHeader>
              <CardContent className="p-4">
                {licenseImage ? (
                  <div className="space-y-3">
                    <div
                      className="rounded-xl overflow-hidden border border-border bg-black/5 aspect-[16/10] relative group cursor-pointer flex items-center justify-center"
                      onClick={() => setPreviewModalUrl(licenseImage)}
                    >
                      <img src={licenseImage} alt="Front License Card" className="w-full h-full object-contain" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-medium gap-1">
                        <ZoomIn className="w-4 h-4" /> Click to Enlarge Front
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-10 text-foreground-muted space-y-2">
                    <FileText className="w-8 h-8 mx-auto opacity-40" />
                    <p className="text-xs font-medium">No Front License scan uploaded</p>
                    <Button variant="outline" size="sm" className="rounded-xl" onClick={() => router.push(`/drivers/${id}/edit`)}>
                      <Upload className="w-3.5 h-3.5 mr-1" /> Upload Front Scan
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Back License Card */}
            <Card className="border-0 shadow-sm rounded-2xl overflow-hidden">
              <CardHeader className="pb-3 border-b border-border/60 bg-muted/20 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <FileImage className="w-4 h-4 text-primary" /> Back of Driver License
                </CardTitle>
                {licenseBackImage && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs rounded-xl"
                    onClick={() => setPreviewModalUrl(licenseBackImage)}
                  >
                    <ZoomIn className="w-3.5 h-3.5 mr-1" /> Zoom Back
                  </Button>
                )}
              </CardHeader>
              <CardContent className="p-4">
                {licenseBackImage ? (
                  <div className="space-y-3">
                    <div
                      className="rounded-xl overflow-hidden border border-border bg-black/5 aspect-[16/10] relative group cursor-pointer flex items-center justify-center"
                      onClick={() => setPreviewModalUrl(licenseBackImage)}
                    >
                      <img src={licenseBackImage} alt="Back License Card" className="w-full h-full object-contain" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-medium gap-1">
                        <ZoomIn className="w-4 h-4" /> Click to Enlarge Back
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-10 text-foreground-muted space-y-2">
                    <FileText className="w-8 h-8 mx-auto opacity-40" />
                    <p className="text-xs font-medium">No Back License scan uploaded</p>
                    <Button variant="outline" size="sm" className="rounded-xl" onClick={() => router.push(`/drivers/${id}/edit`)}>
                      <Upload className="w-3.5 h-3.5 mr-1" /> Upload Back Scan
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── TAB 5: EMERGENCY CONTACT ── */}
        <TabsContent value="emergency" className="mt-0">
          <Card className="border border-amber-500/20 shadow-sm max-w-xl bg-amber-500/5 rounded-2xl">
            <CardHeader className="pb-3 border-b border-amber-500/10 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
                <ShieldAlert className="w-4 h-4 text-amber-500" /> Emergency Next of Kin Contact
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => router.push(`/drivers/${id}/edit`)} className="h-7 text-xs text-primary rounded-xl">
                <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
              </Button>
            </CardHeader>
            <CardContent className="p-5 space-y-3.5 text-xs">
              <div className="flex justify-between py-2 border-b border-border/40">
                <span className="text-foreground-muted">Contact Person Name</span>
                <span className="font-bold text-foreground">{driver.emergency_contact_name || "—"}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border/40">
                <span className="text-foreground-muted">Contact Phone (TEL. NO.)</span>
                <span className="font-semibold text-foreground">{driver.emergency_contact_phone || "—"}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-foreground-muted">Residential Address</span>
                <span className="font-semibold text-foreground text-right">{driver.emergency_contact_address || "—"}</span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Confirmation Dialog for Archiving */}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Archive Driver Profile"
        description={`Are you sure you want to archive ${emp.first_name} ${emp.last_name}? They will be marked inactive.`}
        confirmText="Archive Driver"
        onConfirm={() => deleteMutation.mutate()}
        loading={deleteMutation.isPending}
      />

      {/* Enlarge Image Modal */}
      <Dialog open={!!previewModalUrl} onOpenChange={() => setPreviewModalUrl(null)}>
        <DialogContent className="max-w-3xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <IdCard className="w-5 h-5 text-primary" /> License Document Verification Zoom
            </DialogTitle>
          </DialogHeader>
          <div className="p-2 flex items-center justify-center max-h-[70vh] overflow-auto bg-black/5 rounded-xl border border-border">
            {previewModalUrl && (
              <img src={previewModalUrl} alt="License Zoom" className="max-h-[65vh] w-auto object-contain rounded-lg shadow-md" />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
