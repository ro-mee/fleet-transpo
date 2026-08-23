"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { getDriver, deleteDriver, syncDriverAccount } from "@/services/driver.service";
import { DetailSkeleton } from "@/components/ui/skeleton";
import { AssignedVehicleCard } from "@/components/drivers/assigned-vehicle-card";
import { WorkScheduleCard } from "@/components/drivers/work-schedule-card";
import { useRoleAccess } from "@/hooks/use-role-access";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials, formatDate } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  User, IdCard, CalendarDays, Star, Phone, Mail,
  MapPin, Award, TrendingUp, ArrowLeft, Pencil, Archive,
  Clock, ShieldCheck, FileText, AlertCircle, CheckCircle2,
  Heart, Upload, Truck, Eye, ZoomIn, FileImage, ShieldAlert,
  Globe, Calendar, Briefcase, Activity, KeyRound, ChevronRight
} from "lucide-react";

export default function DriverDetailPage() {
  const router = useRouter();
  const { id } = useParams();
  const queryClient = useQueryClient();
  const { can } = useRoleAccess();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [tripPage, setTripPage] = useState(1);

  // Account actions (set/reset password, enable login)
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");

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

  const accountMutation = useMutation({
    mutationFn: () => syncDriverAccount(id, newPassword ? { password: newPassword } : {}),
    onSuccess: (data) => {
      toast.success(data?.account?.has_password ? "Driver login enabled" : "Driver login synced");
      setAccountDialogOpen(false);
      setNewPassword("");
      queryClient.invalidateQueries({ queryKey: ["driver", id] });
    },
    onError: (err) => {
      toast.error(err.message || "Failed to update driver login");
    },
  });

  if (isLoading) return <DetailSkeleton />;

  if (isError || !driver) {
    return (
      <div className="space-y-4 max-w-4xl mx-auto py-12 px-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="rounded-xl">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
        <Card className="border-0 shadow-md text-center p-12 rounded-[24px] bg-surface">
          <CardContent className="space-y-4 flex flex-col items-center">
            <div className="w-20 h-20 rounded-full bg-danger/10 flex items-center justify-center mb-2">
              <AlertCircle className="w-10 h-10 text-danger" />
            </div>
            <p className="text-xl font-bold text-foreground">Driver Record Not Found</p>
            <p className="text-sm text-foreground-secondary max-w-md">{error?.message || "This driver profile may have been archived or deleted."}</p>
            <Button className="mt-6 rounded-xl shadow-sm px-6 h-11" onClick={() => router.push("/drivers")}>Back to Drivers List</Button>
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
    <div className="space-y-6 w-full pb-10">
      {/* ── Top Header Banner Card ── */}
      <div className="relative overflow-hidden bg-surface border border-border/60 p-6 md:p-8 rounded-[24px] shadow-sm">
        {/* Subtle background decoration */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
        
        <div className="relative z-10 space-y-6">
          <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-6">
            <div className="flex items-start gap-5">
              <Button variant="outline" size="icon" className="rounded-2xl shrink-0 border-border/80 shadow-xs hover:bg-muted/50 mt-1" onClick={() => router.push("/drivers")}>
                <ArrowLeft className="w-5 h-5 text-foreground-secondary" />
              </Button>
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
                <Avatar className="h-24 w-24 ring-4 ring-surface shadow-sm rounded-2xl">
                  <AvatarFallback className="bg-gradient-to-br from-primary/10 to-primary/5 text-primary text-3xl font-bold rounded-2xl">
                    {getInitials(`${emp.first_name || ""} ${emp.last_name || ""}`)}
                  </AvatarFallback>
                </Avatar>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h1 className="text-3xl font-bold text-foreground tracking-tight">
                      {emp.first_name} {emp.last_name}
                    </h1>
                    <StatusBadge
                      status={driver.driver_status || "Available"}
                      entity="driver"
                      className="rounded-full px-3.5 py-1 text-xs font-bold shadow-none border-transparent uppercase tracking-wider"
                    />
                  </div>
                  <div className="flex items-center gap-2.5 text-sm text-foreground-secondary flex-wrap font-medium">
                    <span className="flex items-center gap-1.5"><IdCard className="w-4 h-4 text-foreground-muted" /> #{emp.employee_id || driver.employee_id}</span>
                    <span className="text-border text-lg leading-none">•</span>
                    <span className="flex items-center gap-1.5"><FileText className="w-4 h-4 text-foreground-muted" /> <span className="font-data">{driver.license_number}</span></span>
                    <span className="text-border text-lg leading-none">•</span>
                    <span className="flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-foreground-muted" /> Class {driver.license_class || "B"}</span>
                  </div>
                  {driver.account && (
                    <div className="flex items-center gap-2.5 pt-1">
                      <Badge variant={driver.account.has_password ? "success" : "outline"} className={`px-2.5 py-0.5 text-[11px] font-bold ${!driver.account.has_password && "border-dashed text-foreground-muted"}`}>
                        {driver.account.has_password ? "App Login Enabled" : "No Login Active"}
                      </Badge>
                      <span className="text-xs font-medium text-foreground-muted">
                        {driver.account.email ? driver.account.email : "Email not set"}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <Button
                variant={driver.account?.has_password ? "outline" : "default"}
                onClick={() => setAccountDialogOpen(true)}
                className="rounded-xl text-xs h-10 px-4 font-semibold shadow-xs"
              >
                <KeyRound className="w-4 h-4 mr-2" />
                {driver.account?.has_password ? "Manage Login" : "Enable Login"}
              </Button>
              <Button variant="outline" onClick={() => router.push(`/drivers/${id}/edit`)} className="rounded-xl text-xs h-10 px-4 font-semibold shadow-xs border-border/80">
                <Pencil className="w-4 h-4 mr-2" /> Edit Profile
              </Button>
              <Button
                variant="outline"
                className="rounded-xl text-xs h-10 px-4 font-semibold text-danger border-danger/20 hover:bg-danger/5 hover:border-danger/40 transition-colors"
                onClick={() => setConfirmDelete(true)}
              >
                <Archive className="w-4 h-4 mr-2" /> Archive
              </Button>
            </div>
          </div>

          {/* Quick KPI Stat Highlights */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-5 border-t border-border/40">
            <div className="group flex flex-col p-4 rounded-[18px] bg-gradient-to-br from-surface to-muted/20 border border-border/40 shadow-xs hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
              <div className="flex items-center gap-2 mb-2">
                <div className={`p-1.5 rounded-lg ${isReadyForDispatch ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                  <Activity className="w-4 h-4" />
                </div>
                <span className="text-xs font-semibold text-foreground-secondary uppercase tracking-wider">Readiness</span>
              </div>
              <span className={`text-[15px] font-bold ${isReadyForDispatch ? "text-success" : "text-warning"}`}>
                {isReadyForDispatch ? "Ready to Dispatch" : "Not Ready"}
              </span>
            </div>
            
            <div className="group flex flex-col p-4 rounded-[18px] bg-gradient-to-br from-surface to-muted/20 border border-border/40 shadow-xs hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 rounded-lg bg-info/10 text-info">
                  <Truck className="w-4 h-4" />
                </div>
                <span className="text-xs font-semibold text-foreground-secondary uppercase tracking-wider">Experience</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold text-foreground">{driver.total_trips || trips.length}</span>
                <span className="text-xs font-medium text-foreground-muted">trips</span>
              </div>
            </div>
            
            <div className="group flex flex-col p-4 rounded-[18px] bg-gradient-to-br from-surface to-muted/20 border border-border/40 shadow-xs hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-500">
                  <Briefcase className="w-4 h-4" />
                </div>
                <span className="text-xs font-semibold text-foreground-secondary uppercase tracking-wider">Tenure</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold text-foreground">{driver.years_of_experience ?? 0}</span>
                <span className="text-xs font-medium text-foreground-muted">years</span>
              </div>
            </div>
            
            <div className="group flex flex-col p-4 rounded-[18px] bg-gradient-to-br from-surface to-muted/20 border border-border/40 shadow-xs hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500">
                  <Star className="w-4 h-4" />
                </div>
                <span className="text-xs font-semibold text-foreground-secondary uppercase tracking-wider">Safety Score</span>
              </div>
              <div className="flex items-baseline gap-1">
                {driver.performance_score != null ? (
                  <>
                    <span className="text-xl font-bold text-amber-600 dark:text-amber-500">
                      {(driver.performance_score * 20).toFixed(0)}
                    </span>
                    <span className="text-xs font-medium text-amber-600/70 dark:text-amber-500/70">/ 100</span>
                  </>
                ) : (
                  <>
                    <span className="text-xl font-bold text-foreground-muted">—</span>
                    <span className="text-xs font-medium text-foreground-muted">Not enough completed trips</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* ── Profile Navigation Tabs ── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <div className="overflow-x-auto pb-1 scrollbar-thin">
          <TabsList className="bg-muted/40 border border-border/40 p-1.5 rounded-[16px] inline-flex min-w-max shadow-inner">
            <TabsTrigger value="overview" className="rounded-xl text-[13px] font-bold py-2.5 px-5 data-[state=active]:bg-surface data-[state=active]:shadow-sm data-[state=active]:text-primary transition-all">
              <User className="w-4 h-4 mr-2" /> Overview
            </TabsTrigger>
            <TabsTrigger value="shifts" className="rounded-xl text-[13px] font-bold py-2.5 px-5 data-[state=active]:bg-surface data-[state=active]:shadow-sm data-[state=active]:text-primary transition-all">
              <Clock className="w-4 h-4 mr-2" /> Shift &amp; Readiness
            </TabsTrigger>
            <TabsTrigger value="trips" className="rounded-xl text-[13px] font-bold py-2.5 px-5 data-[state=active]:bg-surface data-[state=active]:shadow-sm data-[state=active]:text-primary transition-all">
              <Truck className="w-4 h-4 mr-2" /> Trip History
              <Badge variant="secondary" className="ml-2 px-1.5 py-0 min-w-[20px] h-[18px] text-[10px] rounded-full">{trips.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="documents" className="rounded-xl text-[13px] font-bold py-2.5 px-5 data-[state=active]:bg-surface data-[state=active]:shadow-sm data-[state=active]:text-primary transition-all">
              <FileImage className="w-4 h-4 mr-2" /> Documents
            </TabsTrigger>
            <TabsTrigger value="emergency" className="rounded-xl text-[13px] font-bold py-2.5 px-5 data-[state=active]:bg-surface data-[state=active]:shadow-sm data-[state=active]:text-amber-600 transition-all">
              <ShieldAlert className="w-4 h-4 mr-2" /> Emergency
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ── TAB 1: OVERVIEW ── */}
        <TabsContent value="overview" className="space-y-6 mt-2 focus:outline-none">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* Left 7 Cols: Personal & License Details */}
            <div className="lg:col-span-7 space-y-6">
              
              {/* Personal Information */}
              <Card className="border border-border/60 shadow-sm rounded-[24px] overflow-hidden transition-all hover:shadow-md">
                <CardHeader className="pb-4 border-b border-border/40 bg-gradient-to-r from-muted/20 to-transparent">
                  <CardTitle className="text-base font-bold flex items-center gap-3 text-foreground">
                    <div className="p-2 rounded-[12px] bg-primary/10 text-primary shadow-xs">
                      <User className="w-4 h-4" />
                    </div>
                    Personal Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y divide-border/40">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 sm:px-6 hover:bg-muted/10 transition-colors">
                      <span className="text-xs font-semibold text-foreground-muted flex items-center gap-2 mb-1 sm:mb-0"><User className="w-3.5 h-3.5" /> Full Name</span>
                      <span className="text-sm font-bold text-foreground">{emp.first_name} {emp.last_name}</span>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 sm:px-6 hover:bg-muted/10 transition-colors">
                      <span className="text-xs font-semibold text-foreground-muted flex items-center gap-2 mb-1 sm:mb-0"><Mail className="w-3.5 h-3.5" /> Email Address</span>
                      <span className="text-sm font-semibold text-foreground">{emp.email || "—"}</span>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 sm:px-6 hover:bg-muted/10 transition-colors">
                      <span className="text-xs font-semibold text-foreground-muted flex items-center gap-2 mb-1 sm:mb-0"><Phone className="w-3.5 h-3.5" /> Phone Number</span>
                      <span className="text-sm font-semibold text-foreground">{emp.phone || "—"}</span>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 sm:px-6 hover:bg-muted/10 transition-colors">
                      <span className="text-xs font-semibold text-foreground-muted flex items-center gap-2 mb-1 sm:mb-0"><Calendar className="w-3.5 h-3.5" /> Birthdate</span>
                      <span className="text-sm font-semibold text-foreground">{driver.birthdate ? formatDate(driver.birthdate) : "—"}</span>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 sm:px-6 hover:bg-muted/10 transition-colors">
                      <span className="text-xs font-semibold text-foreground-muted flex items-center gap-2 mb-1 sm:mb-0"><User className="w-3.5 h-3.5" /> Sex</span>
                      <span className="text-sm font-semibold text-foreground">{driver.sex || "—"}</span>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 sm:px-6 hover:bg-muted/10 transition-colors">
                      <span className="text-xs font-semibold text-foreground-muted flex items-center gap-2 mb-1 sm:mb-0"><Globe className="w-3.5 h-3.5" /> Nationality</span>
                      <span className="text-sm font-semibold text-foreground">{driver.nationality || "Filipino"}</span>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between p-4 sm:px-6 hover:bg-muted/10 transition-colors">
                      <span className="text-xs font-semibold text-foreground-muted flex items-center gap-2 mb-1.5 sm:mb-0 shrink-0 mt-0.5"><MapPin className="w-3.5 h-3.5" /> Residential Address</span>
                      <span className="text-sm font-semibold text-foreground sm:text-right sm:max-w-[60%] leading-relaxed">{driver.address || "—"}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* License & Credentials */}
              <Card className="border border-border/60 shadow-sm rounded-[24px] overflow-hidden transition-all hover:shadow-md">
                <CardHeader className="pb-4 border-b border-border/40 bg-gradient-to-r from-blue-500/5 to-transparent">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-bold flex items-center gap-3 text-foreground">
                      <div className="p-2 rounded-[12px] bg-blue-500/10 text-blue-500 shadow-xs">
                        <IdCard className="w-4 h-4" />
                      </div>
                      License &amp; Credentials
                    </CardTitle>
                    {licenseImage && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs font-semibold text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-xl transition-colors"
                        onClick={() => setPreviewModalUrl(licenseImage)}
                      >
                        <ZoomIn className="w-3.5 h-3.5 mr-1.5" /> View Scan
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border/40 border-b border-border/40">
                    <div className="p-5 flex flex-col gap-1.5 hover:bg-muted/10 transition-colors">
                      <span className="text-xs font-semibold text-foreground-muted">License Number</span>
                      <span className="text-base font-bold font-data text-foreground tracking-wide">{driver.license_number}</span>
                    </div>
                    <div className="p-5 flex flex-col gap-1.5 hover:bg-muted/10 transition-colors">
                      <span className="text-xs font-semibold text-foreground-muted">Expiration Date</span>
                      <span className={`text-base font-bold flex items-center gap-2 ${isLicenseValid ? "text-foreground" : "text-danger"}`}>
                        {driver.license_expiry ? formatDate(driver.license_expiry) : "—"}
                        {!isLicenseValid && <AlertCircle className="w-4 h-4 shrink-0" />}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border/40">
                    <div className="p-5 flex flex-col gap-1.5 hover:bg-muted/10 transition-colors">
                      <span className="text-xs font-semibold text-foreground-muted">Class</span>
                      <Badge variant="outline" className="w-max rounded-lg px-2.5 py-0.5 text-xs font-bold border-border/60">Class {driver.license_class || "B"}</Badge>
                    </div>
                    <div className="p-5 flex flex-col gap-1.5 hover:bg-muted/10 transition-colors">
                      <span className="text-xs font-semibold text-foreground-muted">Type</span>
                      <span className="text-sm font-semibold text-foreground">{driver.license_type || "Professional"}</span>
                    </div>
                    <div className="p-5 flex flex-col gap-1.5 hover:bg-muted/10 transition-colors">
                      <span className="text-xs font-semibold text-foreground-muted">Experience</span>
                      <span className="text-sm font-semibold text-foreground">{driver.years_of_experience ?? 0} Years</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right 5 Cols: Emergency Contact Quick View & Performance */}
            <div className="lg:col-span-5 space-y-6">
              
              {/* Emergency Contact Quick View */}
              <Card className="border border-amber-200 shadow-sm rounded-[24px] bg-gradient-to-br from-amber-50 to-orange-50/50 dark:from-amber-950/20 dark:to-orange-950/10 overflow-hidden group">
                <CardHeader className="pb-3 flex flex-row items-center justify-between border-b border-amber-200/50 dark:border-amber-900/30">
                  <CardTitle className="text-sm font-bold flex items-center gap-2 text-amber-800 dark:text-amber-500">
                    <ShieldAlert className="w-4 h-4" /> Emergency Contact
                  </CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => setActiveTab("emergency")} className="h-7 text-xs font-bold text-amber-700 hover:bg-amber-200/40 dark:text-amber-400 rounded-xl">
                    Details <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                  </Button>
                </CardHeader>
                <CardContent className="p-5 space-y-3.5">
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] font-bold text-amber-700/70 dark:text-amber-500/70 uppercase tracking-wider">Contact Name</span>
                    <span className="font-bold text-amber-950 dark:text-amber-100 text-[15px]">{driver.emergency_contact_name || "—"}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] font-bold text-amber-700/70 dark:text-amber-500/70 uppercase tracking-wider">Phone Number</span>
                    <span className="font-semibold text-amber-900 dark:text-amber-200 text-sm">{driver.emergency_contact_phone || "—"}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] font-bold text-amber-700/70 dark:text-amber-500/70 uppercase tracking-wider">Address</span>
                    <span className="font-medium text-amber-900/80 dark:text-amber-200/80 text-xs leading-relaxed">{driver.emergency_contact_address || "—"}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Performance & Score */}
              <Card className="border border-border/60 shadow-sm rounded-[24px] overflow-hidden transition-all hover:shadow-md">
                <CardHeader className="pb-4 border-b border-border/40 bg-muted/10">
                  <CardTitle className="text-sm font-bold flex items-center gap-2.5 text-foreground">
                    <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                      <Award className="w-4 h-4" />
                    </div>
                    Performance Profile
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-center gap-4 p-4 rounded-[16px] bg-gradient-to-r from-amber-500/10 to-transparent border border-amber-500/20 shadow-inner">
                    <div className="p-3 bg-amber-500 rounded-[14px] shadow-sm">
                      <Star className="w-6 h-6 text-white fill-white" />
                    </div>
                    <div>
                      <div className="flex items-baseline gap-1">
                        {driver.performance_score != null ? (
                          <>
                            <span className="text-3xl font-black text-foreground tracking-tight">
                              {(driver.performance_score * 20).toFixed(0)}
                            </span>
                            <span className="text-sm font-bold text-foreground-muted">/ 100</span>
                          </>
                        ) : (
                          <>
                            <span className="text-3xl font-black text-foreground-muted tracking-tight">—</span>
                          </>
                        )}
                      </div>
                      {driver.performance_score != null ? (
                        <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wider mt-0.5">Safety &amp; Efficiency Score</p>
                      ) : (
                        <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mt-0.5">Not enough completed trips</p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-center">
                    <div className="p-4 rounded-[16px] bg-surface border border-border/60 shadow-xs hover:border-primary/20 transition-colors">
                      <p className="text-2xl font-bold text-foreground">{driver.total_trips || trips.length}</p>
                      <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wider mt-1">Total Trips</p>
                    </div>
                    <div className="p-4 rounded-[16px] bg-surface border border-border/60 shadow-xs hover:border-primary/20 transition-colors">
                      <p className="text-2xl font-bold text-foreground">{driver.total_distance ? `${Math.round(driver.total_distance)}` : "0"}</p>
                      <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wider mt-1">Total KM</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ── TAB 2: SHIFT & READINESS ── */}
        <TabsContent value="shifts" className="space-y-6 mt-2 focus:outline-none">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <AssignedVehicleCard
              side="driver"
              id={Number(id)}
              canManage={can("driver_assignments", "create")}
            />

            <WorkScheduleCard
              driverId={Number(id)}
              canEdit={can("driver_work_schedules", "update")}
            />

            <Card className="border border-border/60 shadow-sm rounded-[24px] md:col-span-2 overflow-hidden transition-all hover:shadow-md">
              <CardHeader className="pb-4 border-b border-border/40 bg-muted/10 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-bold flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  Dispatch Readiness Evaluation
                </CardTitle>
                <Badge variant={isReadyForDispatch ? "success" : "danger"} className="rounded-full px-4 py-1 text-xs font-bold uppercase tracking-wider shadow-none">
                  {isReadyForDispatch ? "Ready to Dispatch" : "Not Ready"}
                </Badge>
              </CardHeader>
              <CardContent className="p-0">
                <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border/40">
                  <div className="p-5 flex flex-col gap-2 hover:bg-muted/5 transition-colors">
                    <div className="flex items-center gap-2 font-semibold text-xs text-foreground-muted uppercase tracking-wider">
                      {isLicenseValid ? <CheckCircle2 className="w-4 h-4 text-success" /> : <AlertCircle className="w-4 h-4 text-danger" />}
                      License Validity
                    </div>
                    <span className={`text-base font-bold ${isLicenseValid ? "text-foreground" : "text-danger"}`}>
                      {isLicenseValid ? "Valid & Active" : "Expired License"}
                    </span>
                  </div>

                  <div className="p-5 flex flex-col gap-2 hover:bg-muted/5 transition-colors">
                    <div className="flex items-center gap-2 font-semibold text-xs text-foreground-muted uppercase tracking-wider">
                      {isStatusAvailable ? <CheckCircle2 className="w-4 h-4 text-success" /> : <AlertCircle className="w-4 h-4 text-warning" />}
                      Operational Status
                    </div>
                    <span className="text-base font-bold text-foreground">{driver.driver_status || "Available"}</span>
                  </div>

                  <div className="p-5 flex flex-col gap-2 hover:bg-muted/5 transition-colors">
                    <div className="flex items-center gap-2 font-semibold text-xs text-foreground-muted uppercase tracking-wider">
                      {hasNoActiveTrip ? <CheckCircle2 className="w-4 h-4 text-success" /> : <AlertCircle className="w-4 h-4 text-warning" />}
                      Trip Overlap
                    </div>
                    <span className="text-base font-bold text-foreground">{hasNoActiveTrip ? "No Active Trip" : "Currently On Trip"}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── TAB 3: TRIP HISTORY ── */}
        <TabsContent value="trips" className="mt-2 focus:outline-none">
          <Card className="border border-border/60 shadow-sm rounded-[24px] overflow-hidden transition-all hover:shadow-md">
            <CardHeader className="pb-4 border-b border-border/40 bg-muted/10">
              <CardTitle className="text-sm font-bold flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                  <Truck className="w-4 h-4" />
                </div>
                Completed &amp; Assigned Trip History
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {trips.length > 0 ? (
                <>
                  <div className="divide-y divide-border/40">
                    {trips.slice((tripPage - 1) * 10, tripPage * 10).map((trip) => (
                      <div
                        key={trip.trip_id}
                        onClick={() => router.push(`/trips/${trip.trip_id}`)}
                        className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-muted/10 transition-colors group cursor-pointer"
                      >
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-3">
                          <span className="font-bold text-foreground text-sm flex items-center gap-1.5">
                            <span className="text-primary">#</span>{trip.trip_id}
                          </span>
                          <StatusBadge status={trip.trip_status} entity="trip" />
                        </div>
                        <p className="text-sm font-medium text-foreground-secondary flex items-center gap-2">
                          <MapPin className="w-3.5 h-3.5 text-danger/80" /> {trip.origin_name || "Depot"} 
                          <span className="text-border">➔</span> 
                          <MapPin className="w-3.5 h-3.5 text-success/80" /> {trip.destination_name || "Destination"}
                        </p>
                      </div>
                      <div className="text-left md:text-right flex flex-col gap-1">
                        <span className="text-[11px] font-bold text-foreground-muted uppercase tracking-wider">Scheduled Departure</span>
                        <p className="text-sm font-semibold text-foreground bg-surface border border-border/60 px-3 py-1.5 rounded-xl shadow-xs group-hover:border-primary/20 transition-colors">
                          {trip.scheduled_departure ? formatDate(trip.scheduled_departure) : "—"}
                        </p>
                      </div>
                    </div>
                  ))}
                  </div>
                  {trips.length > 10 && (
                    <div className="p-4 border-t border-border/40 flex items-center justify-between bg-muted/10">
                      <span className="text-xs text-foreground-muted font-medium">
                        Showing {(tripPage - 1) * 10 + 1} - {Math.min(tripPage * 10, trips.length)} of {trips.length} trips
                      </span>
                      <div className="flex items-center gap-2">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="h-8 px-3 rounded-xl shadow-xs text-xs" 
                          disabled={tripPage === 1} 
                          onClick={() => setTripPage(p => Math.max(1, p - 1))}
                        >
                          Previous
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="h-8 px-3 rounded-xl shadow-xs text-xs" 
                          disabled={tripPage * 10 >= trips.length} 
                          onClick={() => setTripPage(p => p + 1)}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
                  <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center">
                    <Truck className="w-8 h-8 text-foreground-muted/40" />
                  </div>
                  <p className="text-sm font-bold text-foreground">No trip history found</p>
                  <p className="text-xs text-foreground-muted max-w-sm">This driver has not completed any trips yet and has no current assignments.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TAB 4: DOCUMENTS & SCANS ── */}
        <TabsContent value="documents" className="mt-2 space-y-6 focus:outline-none">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Front License Card */}
            <Card className="border border-border/60 shadow-sm rounded-[24px] overflow-hidden transition-all hover:shadow-md group/doc">
              <CardHeader className="pb-3 flex flex-row items-center justify-between border-b border-border/40 bg-surface z-10 relative">
                <CardTitle className="text-sm font-bold flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                    <FileImage className="w-4 h-4" />
                  </div>
                  Front of License
                </CardTitle>
                {licenseImage && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs font-semibold rounded-xl opacity-0 group-hover/doc:opacity-100 transition-all shadow-xs"
                    onClick={() => setPreviewModalUrl(licenseImage)}
                  >
                    <ZoomIn className="w-3.5 h-3.5 mr-1" /> Zoom
                  </Button>
                )}
              </CardHeader>
              <CardContent className="p-0 bg-muted/10 relative">
                {licenseImage ? (
                  <div
                    className="aspect-[16/10] relative group cursor-pointer flex items-center justify-center overflow-hidden"
                    onClick={() => setPreviewModalUrl(licenseImage)}
                  >
                    <img src={licenseImage} alt="Front License Card" className="w-full h-full object-cover sm:object-contain group-hover:scale-105 transition-transform duration-500" />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center backdrop-blur-[2px]">
                      <div className="flex items-center gap-2 bg-white/20 text-white font-bold text-sm px-4 py-2 rounded-full backdrop-blur-md shadow-lg border border-white/30 transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
                        <ZoomIn className="w-4 h-4" /> Enlarge Document
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-center space-y-4 aspect-[16/10]">
                    <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center">
                      <FileText className="w-8 h-8 text-foreground-muted/40" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-foreground">No Front Scan</p>
                      <p className="text-xs text-foreground-muted mt-1">Upload the front side of the license.</p>
                    </div>
                    <Button variant="outline" size="sm" className="rounded-xl shadow-xs" onClick={() => router.push(`/drivers/${id}/edit`)}>
                      <Upload className="w-3.5 h-3.5 mr-1.5" /> Upload Scan
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Back License Card */}
            <Card className="border border-border/60 shadow-sm rounded-[24px] overflow-hidden transition-all hover:shadow-md group/doc">
              <CardHeader className="pb-3 flex flex-row items-center justify-between border-b border-border/40 bg-surface z-10 relative">
                <CardTitle className="text-sm font-bold flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                    <FileImage className="w-4 h-4" />
                  </div>
                  Back of License
                </CardTitle>
                {licenseBackImage && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs font-semibold rounded-xl opacity-0 group-hover/doc:opacity-100 transition-all shadow-xs"
                    onClick={() => setPreviewModalUrl(licenseBackImage)}
                  >
                    <ZoomIn className="w-3.5 h-3.5 mr-1" /> Zoom
                  </Button>
                )}
              </CardHeader>
              <CardContent className="p-0 bg-muted/10 relative">
                {licenseBackImage ? (
                  <div
                    className="aspect-[16/10] relative group cursor-pointer flex items-center justify-center overflow-hidden"
                    onClick={() => setPreviewModalUrl(licenseBackImage)}
                  >
                    <img src={licenseBackImage} alt="Back License Card" className="w-full h-full object-cover sm:object-contain group-hover:scale-105 transition-transform duration-500" />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center backdrop-blur-[2px]">
                      <div className="flex items-center gap-2 bg-white/20 text-white font-bold text-sm px-4 py-2 rounded-full backdrop-blur-md shadow-lg border border-white/30 transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
                        <ZoomIn className="w-4 h-4" /> Enlarge Document
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-center space-y-4 aspect-[16/10]">
                    <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center">
                      <FileText className="w-8 h-8 text-foreground-muted/40" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-foreground">No Back Scan</p>
                      <p className="text-xs text-foreground-muted mt-1">Upload the back side of the license.</p>
                    </div>
                    <Button variant="outline" size="sm" className="rounded-xl shadow-xs" onClick={() => router.push(`/drivers/${id}/edit`)}>
                      <Upload className="w-3.5 h-3.5 mr-1.5" /> Upload Scan
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── TAB 5: EMERGENCY CONTACT ── */}
        <TabsContent value="emergency" className="mt-2 focus:outline-none">
          <Card className="border border-amber-200 shadow-sm max-w-2xl bg-gradient-to-br from-amber-50 to-orange-50/50 dark:from-amber-950/20 dark:to-orange-950/10 rounded-[24px] overflow-hidden">
            <CardHeader className="p-6 border-b border-amber-200/50 dark:border-amber-900/30 flex flex-row items-center justify-between bg-surface/50">
              <CardTitle className="text-base font-bold flex items-center gap-3 text-amber-800 dark:text-amber-500">
                <div className="p-2 rounded-[12px] bg-amber-500/10 text-amber-500 shadow-xs">
                  <ShieldAlert className="w-4 h-4" />
                </div>
                Emergency Next of Kin Contact
              </CardTitle>
              <Button variant="outline" size="sm" onClick={() => router.push(`/drivers/${id}/edit`)} className="h-9 text-xs font-bold text-amber-700 hover:bg-amber-100 hover:text-amber-800 border-amber-300 dark:text-amber-400 dark:border-amber-800 rounded-xl transition-colors shadow-xs">
                <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit Info
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-amber-200/40 dark:divide-amber-900/20">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between p-6">
                  <span className="text-xs font-bold text-amber-700/70 dark:text-amber-500/70 uppercase tracking-wider mb-2 sm:mb-0">Contact Person Name</span>
                  <span className="text-[15px] font-bold text-amber-950 dark:text-amber-100">{driver.emergency_contact_name || "—"}</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between p-6">
                  <span className="text-xs font-bold text-amber-700/70 dark:text-amber-500/70 uppercase tracking-wider mb-2 sm:mb-0">Contact Phone (TEL. NO.)</span>
                  <span className="text-[15px] font-semibold text-amber-900 dark:text-amber-200 bg-amber-100/50 dark:bg-amber-900/30 px-3 py-1.5 rounded-xl border border-amber-200/50 dark:border-amber-800/30">{driver.emergency_contact_phone || "—"}</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-start justify-between p-6">
                  <span className="text-xs font-bold text-amber-700/70 dark:text-amber-500/70 uppercase tracking-wider mb-2 sm:mb-0 mt-0.5">Residential Address</span>
                  <span className="text-[15px] font-medium text-amber-900/90 dark:text-amber-200/90 sm:text-right sm:max-w-[60%] leading-relaxed">{driver.emergency_contact_address || "—"}</span>
                </div>
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
        message={`Are you sure you want to archive ${emp.first_name} ${emp.last_name}? They will be marked inactive.`}
        confirmLabel="Archive driver"
        variant="archive"
        onConfirm={() => deleteMutation.mutate()}
        loading={deleteMutation.isPending}
      />

      {/* Enlarge Image Modal */}
      <Dialog open={!!previewModalUrl} onOpenChange={() => setPreviewModalUrl(null)}>
        <DialogContent className="max-w-4xl p-0 overflow-hidden bg-surface border-border/80 shadow-2xl rounded-[24px]">
          <DialogHeader className="p-5 border-b border-border/40 bg-muted/20">
            <DialogTitle className="text-base font-bold flex items-center gap-3">
              <div className="p-1.5 rounded-lg bg-primary/10 text-primary shadow-xs">
                <IdCard className="w-4 h-4" />
              </div>
              Document Verification Zoom
            </DialogTitle>
          </DialogHeader>
          <div className="p-4 bg-muted/10">
            <div className="relative flex items-center justify-center max-h-[75vh] overflow-hidden bg-black/5 rounded-[16px] border border-border/60 shadow-inner">
              {previewModalUrl && (
                <img src={previewModalUrl} alt="Document Zoom" className="w-full h-full object-contain" />
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Account (Enable Login / Set Password) Dialog ── */}
      <Dialog open={accountDialogOpen} onOpenChange={(open) => { setAccountDialogOpen(open); if (!open) setNewPassword(""); }}>
        <DialogContent className="max-w-md p-0 overflow-hidden bg-surface border-border/80 shadow-xl rounded-[24px]">
          <DialogHeader className="p-5 border-b border-border/40 bg-muted/20">
            <DialogTitle className="text-base font-bold flex items-center gap-3">
              <div className="p-1.5 rounded-lg bg-primary/10 text-primary shadow-xs">
                <KeyRound className="w-4 h-4" />
              </div>
              {driver.account?.has_password ? "Manage Driver Password" : "Enable Driver Login"}
            </DialogTitle>
          </DialogHeader>
          <div className="p-6 space-y-5">
            <div className="flex gap-3 p-4 bg-info/5 border border-info/20 rounded-2xl text-xs text-foreground-secondary leading-relaxed">
              <AlertCircle className="w-4 h-4 text-info shrink-0 mt-0.5" />
              <p>
                Enabling a login assigns the <strong>driver</strong> role and lets this
                driver sign in on the web and mobile app. A password is required to protect
                their personal data.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password" className="text-xs font-bold text-foreground-muted uppercase tracking-wider">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Leave blank to keep current password"
                className="h-11 rounded-xl bg-muted/20 border-border/60 focus:bg-surface focus:ring-primary/20 transition-all font-mono"
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-3 p-5 bg-muted/30 border-t border-border/40">
            <Button variant="outline" onClick={() => setAccountDialogOpen(false)} className="rounded-xl px-4 h-10 text-xs font-bold shadow-xs hover:bg-muted/60 border-border/80">Cancel</Button>
            <Button
              onClick={() => accountMutation.mutate()}
              disabled={accountMutation.isPending}
              className="rounded-xl px-5 h-10 text-xs font-bold shadow-sm"
            >
              {driver.account?.has_password ? "Save Password" : "Enable Login"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
