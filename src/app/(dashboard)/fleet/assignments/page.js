"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { DataTable } from "@/components/tables/data-table";
import { HeroHeader, heroButtonPrimaryClass, heroButtonOutlineClass } from "@/components/ui/hero-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "@/components/ui/toast";
import { cn, formatDate } from "@/lib/utils";
import {
  UserCog,
  Link2,
  Unlink,
  UserCheck,
  Pencil,
  Trash2,
  TriangleAlert,
  Infinity as InfinityIcon,
  CarFront,
  Users,
  Calendar,
  Sparkles,
  Layers,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  Info,
  Clock,
  CheckCircle2,
  Shuffle,
  CalendarDays,
} from "lucide-react";
import {
  getDriverAssignments,
  assignDriverVehicle,
  releaseDriverAssignment,
} from "@/services/driver-assignment.service";
import {
  getSubstituteSchedules,
  createSubstituteSchedule,
  updateSubstituteSchedule,
  deleteSubstituteSchedule,
} from "@/services/substitute-driver.service";
import { getDrivers } from "@/services/driver.service";
import { getVehicles } from "@/services/vehicle.service";
import { useRequireRole, can } from "@/lib/auth/role-guard";
import { useAuth } from "@/hooks/use-auth";

const assignmentColumnHelper = createColumnHelper();
const substituteColumnHelper = createColumnHelper();

function personLabel(row) {
  if (!row) return "Unknown Driver";
  const first = row.first_name || row.employees?.first_name || "";
  const last = row.last_name || row.employees?.last_name || "";
  const fullName = `${first} ${last}`.trim();
  return fullName || `Driver #${row.driver_id ?? row.substitute_driver_id ?? "—"}`;
}

function personInitials(row) {
  const first = (row.first_name || row.employees?.first_name || "")[0] || "";
  const last = (row.last_name || row.employees?.last_name || "")[0] || "";
  return (first + last).toUpperCase() || "DR";
}

function vehiclePlate(row) {
  return row.plate_number || `V#${row.vehicle_id}`;
}

function vehicleName(row) {
  return row.vehicle_name || row.model || "Fleet Vehicle";
}

function vehicleLabel(row) {
  return [row.plate_number, row.vehicle_name || row.model].filter(Boolean).join(" · ") || `Vehicle #${row.vehicle_id}`;
}

function getRelativeAssignedDuration(assignedFrom) {
  if (!assignedFrom) return null;
  const start = new Date(assignedFrom);
  const now = new Date();
  const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "Assigned today";
  if (diffDays === 1) return "1 day active";
  if (diffDays < 30) return `${diffDays} days active`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths === 1) return "1 month active";
  return `${diffMonths} months active`;
}

function getScheduleStatus(schedule) {
  const todayKey = new Date().toISOString().slice(0, 10);
  const from = schedule.effective_from;
  const until = schedule.effective_until;

  if (until && until < todayKey) {
    return { label: "Expired", tone: "secondary", activeToday: false };
  }
  if (from && from > todayKey) {
    return { label: "Upcoming", tone: "info", activeToday: false };
  }
  if (!until) {
    return { label: "Open-Ended (Active)", tone: "primary", activeToday: true, openEnded: true };
  }
  return { label: "Active Today", tone: "success", activeToday: true };
}

export default function AssignmentsPage() {
  useRequireRole();
  const { employee } = useAuth();
  const canAssign = can(employee, "driver_assignments", "create");
  const canSubstitute = can(employee, "substitute_driver_schedules", "create");

  const [activeTab, setActiveTab] = useState("overview");
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [presetAssign, setPresetAssign] = useState({ driver_id: "", vehicle_id: "" });

  // Data queries
  const { data: assignmentsData, isLoading: loadingAssignments, isError: errorAssignments, error: errA, refetch: refetchAssignments } = useQuery({
    queryKey: ["driver-assignments", "module"],
    queryFn: () => getDriverAssignments(),
  });

  const { data: substitutesData, isLoading: loadingSubstitutes, isError: errorSubstitutes, error: errS, refetch: refetchSubstitutes } = useQuery({
    queryKey: ["substitute-schedules", "module"],
    queryFn: () => getSubstituteSchedules(),
  });

  const { data: vehiclesData, isLoading: loadingVehicles } = useQuery({
    queryKey: ["vehicles", "assignments-page"],
    queryFn: () => getVehicles(),
  });

  const { data: driversData, isLoading: loadingDrivers } = useQuery({
    queryKey: ["drivers", "assignments-page"],
    queryFn: () => getDrivers(),
  });

  const assignments = useMemo(() => assignmentsData?.assignments ?? [], [assignmentsData]);
  const schedules = useMemo(() => substitutesData?.schedules ?? [], [substitutesData]);
  const vehicles = useMemo(() => (Array.isArray(vehiclesData) ? vehiclesData : []), [vehiclesData]);
  const drivers = useMemo(() => (Array.isArray(driversData) ? driversData : []), [driversData]);

  // Derived KPI metrics
  const activePairingsCount = assignments.length;
  const totalVehiclesCount = vehicles.length;
  const assignedVehicleIds = useMemo(() => new Set(assignments.map((a) => a.vehicle_id)), [assignments]);
  const assignedDriverIds = useMemo(() => new Set(assignments.map((a) => a.driver_id)), [assignments]);

  const unassignedVehicles = useMemo(
    () => vehicles.filter((v) => !assignedVehicleIds.has(v.vehicle_id) && v.deleted_at == null),
    [vehicles, assignedVehicleIds]
  );

  const unassignedAvailableDrivers = useMemo(
    () => drivers.filter((d) => !assignedDriverIds.has(d.driver_id) && d.driver_status === "Available" && d.deleted_at == null),
    [drivers, assignedDriverIds]
  );

  const activeSubstitutesCount = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10);
    return schedules.filter((s) => {
      if (s.effective_until && s.effective_until < todayKey) return false;
      if (s.effective_from && s.effective_from > todayKey) return false;
      return true;
    }).length;
  }, [schedules]);

  const coveragePercent = totalVehiclesCount > 0
    ? Math.round((activePairingsCount / totalVehiclesCount) * 100)
    : 0;

  const handleQuickMatch = (vehicleId, driverId) => {
    setPresetAssign({
      vehicle_id: vehicleId ? String(vehicleId) : "",
      driver_id: driverId ? String(driverId) : "",
    });
    setAssignDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* ── Page Header with Actions ─────────────────────────────────── */}
      <HeroHeader
        icon={UserCog}
        title="Driver Assignments"
        badge="Fleet Operations"
        description="Custodial driver-vehicle pairings and temporary substitute coverage."
        actions={
          <div className="flex items-center gap-2.5">
            {canSubstitute && (
              <Button
                variant="outline"
                size="sm"
                className={cn("h-9 rounded-xl", heroButtonOutlineClass)}
                onClick={() => setScheduleDialogOpen(true)}
              >
                <UserCheck className="w-3.5 h-3.5 mr-1.5 text-foreground-secondary" /> Add Substitute
              </Button>
            )}
            {canAssign && (
              <Button
                size="sm"
                className={cn("h-9 rounded-xl shadow-xs", heroButtonPrimaryClass)}
                onClick={() => {
                  setPresetAssign({ driver_id: "", vehicle_id: "" });
                  setAssignDialogOpen(true);
                }}
              >
                <Link2 className="w-3.5 h-3.5 mr-1.5" /> Assign Driver
              </Button>
            )}
          </div>
        }
      />

      {/* ── Tactical KPI Ribbon (StatGrid) ────────────────────────────── */}
      <StatGrid cols={4}>
        <StatCard
          icon={ShieldCheck}
          label="Active Custodial Pairings"
          value={activePairingsCount}
          valueNote={`${activePairingsCount} assigned`}
          trend="Designated accountability for fuel & maintenance"
          tone="primary"
        />
        <StatCard
          icon={Layers}
          label="Fleet Custody Coverage"
          value={`${coveragePercent}%`}
          valueNote={`${activePairingsCount} / ${totalVehiclesCount || 0} units`}
          trend={coveragePercent >= 80 ? "Healthy fleet assignment rate" : "Unassigned units available"}
          tone={coveragePercent >= 80 ? "success" : coveragePercent >= 50 ? "warning" : "neutral"}
        />
        <StatCard
          icon={UserCheck}
          label="Active Substitutes"
          value={activeSubstitutesCount}
          valueNote={`${schedules.length} total scheduled`}
          trend="Temporary coverage for unavailable custodians"
          tone="info"
        />
        <StatCard
          icon={CarFront}
          label="Unassigned Fleet Units"
          value={unassignedVehicles.length}
          valueNote={`${unassignedAvailableDrivers.length} free drivers`}
          trend={unassignedVehicles.length > 0 ? "Ready for custodial pairing" : "All fleet units assigned"}
          tone={unassignedVehicles.length > 0 ? "warning" : "success"}
          interactive={unassignedVehicles.length > 0}
          onClick={() => setActiveTab("matchmaker")}
        />
      </StatGrid>

      {/* ── Workspace Tabs & Views ────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-1 pb-1">
          {/* Architectural Segmented Island Tab Controller */}
          <div className="p-1 rounded-[20px] bg-muted/40 dark:bg-muted/20 border border-border/80 shadow-2xs backdrop-blur-md inline-flex flex-wrap items-center gap-1">
            <TabsList className="bg-transparent p-0 h-auto gap-1 border-0 shadow-none">
              {/* Tab 1: Overview */}
              <TabsTrigger
                value="overview"
                className="rounded-[15px] px-4 py-2 text-xs font-semibold text-foreground-secondary hover:text-foreground hover:bg-surface/50 data-[state=active]:bg-surface data-[state=active]:text-foreground data-[state=active]:font-bold data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/70 transition-all duration-200 gap-2 cursor-pointer"
              >
                <Layers className="w-3.5 h-3.5 text-foreground-muted" />
                <span>Overview</span>
              </TabsTrigger>

              {/* Tab 2: Custodial Pairings */}
              <TabsTrigger
                value="pairings"
                className="rounded-[15px] px-4 py-2 text-xs font-semibold text-foreground-secondary hover:text-foreground hover:bg-surface/50 data-[state=active]:bg-surface data-[state=active]:text-foreground data-[state=active]:font-bold data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/70 transition-all duration-200 gap-2 cursor-pointer"
              >
                <Link2 className="w-3.5 h-3.5 text-foreground-muted" />
                <span>Custodial Pairings</span>
                <span
                  className={cn(
                    "font-data font-semibold text-[11px] px-2 py-0.5 rounded-full border transition-all",
                    assignments.length > 0
                      ? "bg-primary/10 text-primary border-primary/20"
                      : "bg-muted text-foreground-muted border-border/60"
                  )}
                >
                  {assignments.length}
                </span>
              </TabsTrigger>

              {/* Tab 3: Substitute Coverage */}
              <TabsTrigger
                value="substitutes"
                className="rounded-[15px] px-4 py-2 text-xs font-semibold text-foreground-secondary hover:text-foreground hover:bg-surface/50 data-[state=active]:bg-surface data-[state=active]:text-foreground data-[state=active]:font-bold data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/70 transition-all duration-200 gap-2 cursor-pointer"
              >
                <UserCheck className="w-3.5 h-3.5 text-foreground-muted" />
                <span>Substitute Coverage</span>
                <span
                  className={cn(
                    "font-data font-semibold text-[11px] px-2 py-0.5 rounded-full border transition-all",
                    schedules.length > 0
                      ? "bg-info/10 text-info-700 dark:text-info border-info/20"
                      : "bg-muted text-foreground-muted border-border/60"
                  )}
                >
                  {schedules.length}
                </span>
              </TabsTrigger>

              {/* Tab 4: Matchmaking Assistant */}
              <TabsTrigger
                value="matchmaker"
                className="rounded-[15px] px-4 py-2 text-xs font-semibold text-foreground-secondary hover:text-foreground hover:bg-surface/50 data-[state=active]:bg-surface data-[state=active]:text-foreground data-[state=active]:font-bold data-[state=active]:shadow-xs data-[state=active]:border data-[state=active]:border-border/70 transition-all duration-200 gap-2 cursor-pointer group"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-500 transition-transform group-hover:scale-110" />
                <span>Matchmaking Assistant</span>
                {unassignedVehicles.length > 0 ? (
                  <span className="font-data font-bold text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                    {unassignedVehicles.length} unassigned
                  </span>
                ) : (
                  <span className="font-data font-semibold text-[11px] px-2 py-0.5 rounded-full bg-muted text-foreground-muted border border-border/60">
                    0
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Live Registry Context Indicator */}
          <div className="hidden sm:flex items-center gap-2.5 px-3.5 py-2 rounded-2xl bg-surface border border-border/80 shadow-2xs text-xs">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="text-foreground-secondary font-medium">
              Registry Live · <strong className="text-foreground font-semibold font-data">{activePairingsCount}</strong> Custodians Assigned
            </span>
          </div>
        </div>

        {/* ── TAB 1: Dual Overview (Hub) ──────────────────────────────── */}
        <TabsContent value="overview" className="space-y-6 mt-0">
          <PairingsSection
            assignments={assignments}
            isLoading={loadingAssignments}
            isError={errorAssignments}
            error={errA}
            refetch={refetchAssignments}
            canManage={canAssign}
            onOpenAssign={() => {
              setPresetAssign({ driver_id: "", vehicle_id: "" });
              setAssignDialogOpen(true);
            }}
          />
          <SubstitutesSection
            schedules={schedules}
            isLoading={loadingSubstitutes}
            isError={errorSubstitutes}
            error={errS}
            refetch={refetchSubstitutes}
            canManage={canSubstitute}
            onOpenSchedule={() => setScheduleDialogOpen(true)}
          />
        </TabsContent>

        {/* ── TAB 2: Custodial Pairings Focused View ──────────────────── */}
        <TabsContent value="pairings" className="mt-0">
          <PairingsSection
            assignments={assignments}
            isLoading={loadingAssignments}
            isError={errorAssignments}
            error={errA}
            refetch={refetchAssignments}
            canManage={canAssign}
            onOpenAssign={() => {
              setPresetAssign({ driver_id: "", vehicle_id: "" });
              setAssignDialogOpen(true);
            }}
          />
        </TabsContent>

        {/* ── TAB 3: Substitute Coverage Focused View ─────────────────── */}
        <TabsContent value="substitutes" className="mt-0">
          <SubstitutesSection
            schedules={schedules}
            isLoading={loadingSubstitutes}
            isError={errorSubstitutes}
            error={errS}
            refetch={refetchSubstitutes}
            canManage={canSubstitute}
            onOpenSchedule={() => setScheduleDialogOpen(true)}
          />
        </TabsContent>

        {/* ── TAB 4: Matchmaking Assistant ────────────────────────────── */}
        <TabsContent value="matchmaker" className="mt-0">
          <MatchmakingAssistant
            unassignedVehicles={unassignedVehicles}
            unassignedDrivers={unassignedAvailableDrivers}
            canManage={canAssign}
            onQuickMatch={handleQuickMatch}
          />
        </TabsContent>
      </Tabs>

      {/* ── Assign Driver Dialog ──────────────────────────────────────── */}
      <AssignDriverDialog
        open={assignDialogOpen}
        onOpenChange={setAssignDialogOpen}
        canManage={canAssign}
        preset={presetAssign}
        assignments={assignments}
        vehicles={vehicles}
        drivers={drivers}
      />

      {/* ── Schedule Substitute Dialog ────────────────────────────────── */}
      <ScheduleDialog
        mode="create"
        open={scheduleDialogOpen}
        onOpenChange={setScheduleDialogOpen}
        canManage={canSubstitute}
        vehicles={vehicles}
        drivers={drivers}
      />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION A: CUSTODIAL PAIRINGS
   ══════════════════════════════════════════════════════════════════════════ */

function PairingsSection({ assignments, isLoading, isError, error, refetch, canManage, onOpenAssign }) {
  return (
    <div className="rounded-[28px] border border-border/80 bg-muted/20 p-2 shadow-xs transition-all">
      <Card className="border border-border/60 bg-surface shadow-xs rounded-[24px] overflow-hidden">
        <CardContent className="p-0">
          <div className="p-5 border-b border-border/50 bg-surface/50 backdrop-blur-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 text-primary">
                <Link2 className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold tracking-tight text-foreground">Custodial Pairings</h2>
                  <Badge variant="outline" className="font-data text-xs px-2 py-0.5">
                    {assignments.length} active
                  </Badge>
                </div>
                <p className="text-xs text-foreground-secondary mt-0.5">
                  Designated custodians accountable for vehicle maintenance, fuel logs, and inspection readiness.
                </p>
              </div>
            </div>
            {canManage && (
              <Button
                size="sm"
                className={cn("h-9 rounded-xl shadow-xs self-start sm:self-auto", heroButtonPrimaryClass)}
                onClick={onOpenAssign}
              >
                <Link2 className="w-3.5 h-3.5 mr-1.5" /> Assign Driver
              </Button>
            )}
          </div>
          <ActivePairingsTable assignments={assignments} isLoading={isLoading} isError={isError} error={error} refetch={refetch} canManage={canManage} />
        </CardContent>
      </Card>
    </div>
  );
}

function ActivePairingsTable({ assignments, isLoading, isError, error, refetch, canManage }) {
  const queryClient = useQueryClient();
  const [releasing, setReleasing] = useState(null);

  const releaseMutation = useMutation({
    mutationFn: (assignmentId) => releaseDriverAssignment(assignmentId, "Released"),
    onSuccess: () => {
      toast.success("Assignment released");
      setReleasing(null);
      queryClient.invalidateQueries({ queryKey: ["driver-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["transport-requests"] });
    },
    onError: (err) => {
      toast.error(err.message || "Failed to release assignment");
      setReleasing(null);
    },
  });

  const columns = useMemo(
    () => [
      assignmentColumnHelper.accessor((row) => personLabel(row), {
        id: "driver",
        header: "Designated Driver",
        cell: ({ row }) => {
          const r = row.original;
          const name = personLabel(r);
          const initials = personInitials(r);
          return (
            <div className="flex items-center gap-3 py-1">
              <Avatar className="h-9 w-9 rounded-xl border border-border/80 bg-muted/60 text-foreground font-semibold text-xs shrink-0">
                <AvatarFallback className="rounded-xl bg-primary/10 text-primary font-bold">{initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="font-semibold text-sm text-foreground truncate">{name}</p>
                <span className="text-[11px] font-data text-foreground-muted block">
                  ID: #{r.driver_id}
                </span>
              </div>
            </div>
          );
        },
      }),
      assignmentColumnHelper.accessor((row) => vehicleLabel(row), {
        id: "vehicle",
        header: "Assigned Vehicle",
        cell: ({ row }) => {
          const r = row.original;
          const plate = vehiclePlate(r);
          const model = vehicleName(r);
          return (
            <div className="space-y-1 py-1">
              <div className="flex items-center gap-2">
                <span className="font-data font-bold text-xs px-2.5 py-0.5 rounded-md bg-muted/80 border border-border/80 text-foreground tracking-wider uppercase inline-flex items-center gap-1.5 shadow-2xs">
                  <CarFront className="w-3.5 h-3.5 text-foreground-muted" />
                  {plate}
                </span>
              </div>
              <p className="text-xs text-foreground-secondary truncate max-w-[200px]">{model}</p>
            </div>
          );
        },
      }),
      assignmentColumnHelper.accessor("vehicle_status", {
        header: "Vehicle Status",
        cell: (info) =>
          info.getValue() ? (
            <StatusBadge status={info.getValue()} type="vehicle" />
          ) : (
            <span className="text-foreground-muted">—</span>
          ),
      }),
      assignmentColumnHelper.accessor("assigned_from", {
        header: "Assignment Duration",
        cell: (info) => {
          const val = info.getValue();
          const relative = getRelativeAssignedDuration(val);
          return (
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5 text-xs font-data text-foreground">
                <Calendar className="w-3.5 h-3.5 text-foreground-muted" />
                <span>{formatDate(val)}</span>
              </div>
              {relative && <span className="text-[11px] text-foreground-muted block">{relative}</span>}
            </div>
          );
        },
      }),
      assignmentColumnHelper.accessor("notes", {
        header: "Notes",
        cell: (info) => (
          <span className="text-xs text-foreground-secondary block max-w-[200px] truncate" title={info.getValue() || ""}>
            {info.getValue() ? (
              <span className="italic bg-muted/40 px-2 py-0.5 rounded text-foreground-secondary">{info.getValue()}</span>
            ) : (
              <span className="text-foreground-muted">—</span>
            )}
          </span>
        ),
      }),
      ...(canManage
        ? [
            assignmentColumnHelper.display({
              id: "actions",
              header: "",
              cell: ({ row }) => (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs font-medium text-foreground-secondary hover:text-danger hover:bg-danger/10 cursor-pointer rounded-lg transition-colors"
                  onClick={() => setReleasing(row.original)}
                >
                  <Unlink className="w-3.5 h-3.5 mr-1.5" /> Release
                </Button>
              ),
            }),
          ]
        : []),
    ],
    [canManage]
  );

  if (isError) {
    return (
      <EmptyState
        icon={TriangleAlert}
        title="Could not load assignments"
        description={error?.message || "Something went wrong reading the pairing registry."}
        action={<Button onClick={() => refetch()}>Try again</Button>}
      />
    );
  }

  return (
    <>
      <DataTable
        columns={columns}
        data={assignments}
        searchPlaceholder="Search pairings by driver or plate..."
        emptyTitle="No active pairings"
        emptyDescription="Assign drivers to vehicles so accountability for fuel, cleanliness, and condition is clear."
        isLoading={isLoading}
      />
      <ConfirmDialog
        open={!!releasing}
        onOpenChange={(open) => !open && setReleasing(null)}
        title={`Release custodial pairing for ${releasing ? vehiclePlate(releasing) : "vehicle"}?`}
        message={`${releasing ? personLabel(releasing) : "This driver"} will no longer be responsible for ${releasing ? vehicleLabel(releasing) : "this vehicle"}. The pairing record is closed and archived; scheduled dispatches remain unaffected.`}
        confirmLabel="Release Custody"
        variant="warning"
        loading={releaseMutation.isPending}
        onConfirm={() => releasing && releaseMutation.mutate(releasing.assignment_id)}
      />
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION B: SUBSTITUTE SCHEDULES
   ══════════════════════════════════════════════════════════════════════════ */

function SubstitutesSection({ schedules, isLoading, isError, error, refetch, canManage, onOpenSchedule }) {
  return (
    <div className="rounded-[28px] border border-border/80 bg-muted/20 p-2 shadow-xs transition-all">
      <Card className="border border-border/60 bg-surface shadow-xs rounded-[24px] overflow-hidden">
        <CardContent className="p-0">
          <div className="p-5 border-b border-border/50 bg-surface/50 backdrop-blur-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-info/10 border border-info/20 flex items-center justify-center shrink-0 text-info">
                <UserCheck className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold tracking-tight text-foreground">Substitute Schedules</h2>
                  <Badge variant="outline" className="font-data text-xs px-2 py-0.5">
                    {schedules.length} scheduled
                  </Badge>
                </div>
                <p className="text-xs text-foreground-secondary mt-0.5">
                  Temporary driver coverage so vehicles stay available when their designated custodian is unavailable.
                </p>
              </div>
            </div>
            {canManage && (
              <Button
                size="sm"
                className={cn("h-9 rounded-xl shadow-xs self-start sm:self-auto", heroButtonOutlineClass)}
                onClick={onOpenSchedule}
              >
                <UserCheck className="w-3.5 h-3.5 mr-1.5" /> Add Substitute
              </Button>
            )}
          </div>
          <SubstitutesTable schedules={schedules} isLoading={isLoading} isError={isError} error={error} refetch={refetch} canManage={canManage} />
        </CardContent>
      </Card>
    </div>
  );
}

function SubstitutesTable({ schedules, isLoading, isError, error, refetch, canManage }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["substitute-schedules"] });
    queryClient.invalidateQueries({ queryKey: ["reservation-recommendation"] });
    queryClient.invalidateQueries({ queryKey: ["transport-requests"] });
  };

  const removeMutation = useMutation({
    mutationFn: (scheduleId) => deleteSubstituteSchedule(scheduleId),
    onSuccess: () => {
      toast.success("Substitute schedule removed");
      setRemoving(null);
      invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to remove substitute schedule");
      setRemoving(null);
    },
  });

  const columns = useMemo(
    () => [
      substituteColumnHelper.accessor((row) => vehicleLabel(row), {
        id: "vehicle",
        header: "Vehicle Covered",
        cell: ({ row }) => {
          const r = row.original;
          const plate = vehiclePlate(r);
          const model = vehicleName(r);
          return (
            <div className="space-y-1 py-1">
              <div className="flex items-center gap-2">
                <span className="font-data font-bold text-xs px-2.5 py-0.5 rounded-md bg-muted/80 border border-border/80 text-foreground tracking-wider uppercase inline-flex items-center gap-1.5 shadow-2xs">
                  <CarFront className="w-3.5 h-3.5 text-foreground-muted" />
                  {plate}
                </span>
              </div>
              <p className="text-xs text-foreground-secondary truncate max-w-[200px]">{model}</p>
            </div>
          );
        },
      }),
      substituteColumnHelper.accessor((row) => personLabel(row), {
        id: "substitute",
        header: "Substitute Driver",
        cell: ({ row }) => {
          const r = row.original;
          const name = personLabel(r);
          const initials = personInitials(r);
          return (
            <div className="flex items-center gap-3 py-1">
              <Avatar className="h-9 w-9 rounded-xl border border-border/80 bg-muted/60 text-foreground font-semibold text-xs shrink-0">
                <AvatarFallback className="rounded-xl bg-info/10 text-info font-bold">{initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="font-semibold text-sm text-foreground truncate">{name}</p>
                <span className="text-[11px] font-data text-foreground-muted block">
                  ID: #{r.substitute_driver_id}
                </span>
              </div>
            </div>
          );
        },
      }),
      substituteColumnHelper.accessor("effective_from", {
        header: "Coverage Timeline",
        cell: ({ row }) => {
          const s = row.original;
          const status = getScheduleStatus(s);
          return (
            <div className="space-y-1 py-1">
              <div className="flex items-center gap-1.5 text-xs font-data text-foreground whitespace-nowrap">
                <CalendarDays className="w-3.5 h-3.5 text-foreground-muted shrink-0" />
                {s.effective_until == null ? (
                  <span className="flex items-center gap-1">
                    <span>{formatDate(s.effective_from)}</span>
                    <ArrowRight className="w-3 h-3 text-foreground-muted" />
                    <span className="inline-flex items-center gap-1 font-semibold text-primary">
                      <InfinityIcon className="w-3.5 h-3.5" /> open-ended
                    </span>
                  </span>
                ) : (
                  <span>
                    {formatDate(s.effective_from)} – {formatDate(s.effective_until)}
                  </span>
                )}
              </div>
              <div>
                <Badge
                  variant={status.tone}
                  className="text-[10px] px-2 py-0 font-medium tracking-tight"
                >
                  {status.label}
                </Badge>
              </div>
            </div>
          );
        },
      }),
      substituteColumnHelper.accessor("notes", {
        header: "Notes",
        cell: (info) => (
          <span className="text-xs text-foreground-secondary block max-w-[200px] truncate" title={info.getValue() || ""}>
            {info.getValue() ? (
              <span className="italic bg-muted/40 px-2 py-0.5 rounded text-foreground-secondary">{info.getValue()}</span>
            ) : (
              <span className="text-foreground-muted">—</span>
            )}
          </span>
        ),
      }),
      ...(canManage
        ? [
            substituteColumnHelper.display({
              id: "actions",
              header: "",
              cell: ({ row }) => (
                <div className="flex items-center gap-1 justify-end">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-lg cursor-pointer text-foreground-secondary hover:text-foreground hover:bg-muted"
                    aria-label="Edit substitute schedule"
                    onClick={() => setEditing(row.original)}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-lg cursor-pointer text-foreground-muted hover:text-danger hover:bg-danger/10"
                    aria-label="Remove substitute schedule"
                    onClick={() => setRemoving(row.original)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ),
            }),
          ]
        : []),
    ],
    [canManage]
  );

  if (isError) {
    return (
      <EmptyState
        icon={TriangleAlert}
        title="Could not load substitute schedules"
        description={error?.message || "Something went wrong reading substitute coverage."}
        action={<Button onClick={() => refetch()}>Try again</Button>}
      />
    );
  }

  return (
    <>
      <DataTable
        columns={columns}
        data={schedules}
        searchPlaceholder="Search substitute coverage by driver or vehicle..."
        emptyTitle="No substitute schedules"
        emptyDescription="When a designated driver is unavailable, schedule a substitute here so the vehicle stays recommendable."
        isLoading={isLoading}
      />
      <ScheduleDialog
        mode="edit"
        open={Boolean(editing)}
        onOpenChange={(op) => !op && setEditing(null)}
        canManage={canManage}
        schedule={editing}
        onClose={() => setEditing(null)}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove this substitute schedule?"
        message={
          removing
            ? `${personLabel(removing)} will stop covering ${vehicleLabel(removing)}. The vehicle will not be recommended until another substitute is scheduled.`
            : ""
        }
        confirmLabel="Remove Schedule"
        variant="warning"
        loading={removeMutation.isPending}
        onConfirm={() => removing && removeMutation.mutate(removing.substitute_id)}
      />
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION C: MATCHMAKING ASSISTANT (FAST PAIRING STUDIO)
   ══════════════════════════════════════════════════════════════════════════ */

function MatchmakingAssistant({ unassignedVehicles, unassignedDrivers, canManage, onQuickMatch }) {
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [selectedDriver, setSelectedDriver] = useState(null);

  const handlePairSelected = () => {
    if (selectedVehicle && selectedDriver) {
      onQuickMatch(selectedVehicle.vehicle_id, selectedDriver.driver_id);
    }
  };

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-2xl border border-primary/20 bg-primary/5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">Intelligent Matchmaking Assistant</h3>
            <p className="text-xs text-foreground-secondary mt-0.5">
              Select an unassigned fleet vehicle and an available driver to create a custodial pairing with one click.
            </p>
          </div>
        </div>
        {canManage && (
          <Button
            size="sm"
            disabled={!selectedVehicle || !selectedDriver}
            onClick={handlePairSelected}
            className={cn("h-9 rounded-xl shadow-xs shrink-0", heroButtonPrimaryClass)}
          >
            <Shuffle className="w-3.5 h-3.5 mr-1.5" /> Pair Selected ({selectedVehicle ? vehiclePlate(selectedVehicle) : "—"} + {selectedDriver ? personLabel(selectedDriver) : "—"})
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left: Unassigned Vehicles */}
        <Card className="border border-border/80 shadow-xs rounded-3xl overflow-hidden">
          <div className="p-4 border-b border-border/50 bg-muted/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CarFront className="w-4 h-4 text-primary" />
              <h4 className="text-sm font-bold text-foreground">Unassigned Fleet Units</h4>
            </div>
            <Badge variant="outline" className="font-data text-xs">
              {unassignedVehicles.length} available
            </Badge>
          </div>
          <CardContent className="p-3 max-h-[420px] overflow-y-auto space-y-2">
            {unassignedVehicles.length === 0 ? (
              <div className="p-8 text-center text-xs text-foreground-muted">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-success" />
                All fleet vehicles currently have assigned custodial drivers.
              </div>
            ) : (
              unassignedVehicles.map((v) => {
                const isSelected = selectedVehicle?.vehicle_id === v.vehicle_id;
                return (
                  <div
                    key={v.vehicle_id}
                    onClick={() => setSelectedVehicle(isSelected ? null : v)}
                    className={cn(
                      "p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 text-left",
                      isSelected
                        ? "border-primary bg-primary/10 shadow-xs ring-1 ring-primary/40"
                        : "border-border/60 bg-surface hover:border-border hover:bg-muted/30"
                    )}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-data font-bold text-xs px-2 py-0.5 rounded bg-muted border border-border/80 text-foreground tracking-wider uppercase">
                          {vehiclePlate(v)}
                        </span>
                        <StatusBadge status={v.vehicle_status || "Available"} type="vehicle" />
                      </div>
                      <p className="text-xs font-medium text-foreground truncate">{vehicleName(v)}</p>
                      <p className="text-[11px] text-foreground-muted">
                        Capacity: {v.seating_capacity || 4} passengers · Type: {v.vehicle_type || "Standard"}
                      </p>
                    </div>
                    <div className="shrink-0">
                      {isSelected ? (
                        <span className="h-6 w-6 rounded-full bg-primary text-surface flex items-center justify-center text-xs">
                          ✓
                        </span>
                      ) : (
                        <span className="text-xs text-primary font-medium hover:underline">Select</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Right: Unassigned Available Drivers */}
        <Card className="border border-border/80 shadow-xs rounded-3xl overflow-hidden">
          <div className="p-4 border-b border-border/50 bg-muted/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              <h4 className="text-sm font-bold text-foreground">Available Drivers (No Vehicle)</h4>
            </div>
            <Badge variant="outline" className="font-data text-xs">
              {unassignedDrivers.length} available
            </Badge>
          </div>
          <CardContent className="p-3 max-h-[420px] overflow-y-auto space-y-2">
            {unassignedDrivers.length === 0 ? (
              <div className="p-8 text-center text-xs text-foreground-muted">
                <Users className="w-8 h-8 mx-auto mb-2 text-foreground-muted" />
                No unassigned drivers currently available.
              </div>
            ) : (
              unassignedDrivers.map((d) => {
                const isSelected = selectedDriver?.driver_id === d.driver_id;
                const name = personLabel(d);
                const initials = personInitials(d);
                return (
                  <div
                    key={d.driver_id}
                    onClick={() => setSelectedDriver(isSelected ? null : d)}
                    className={cn(
                      "p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 text-left",
                      isSelected
                        ? "border-primary bg-primary/10 shadow-xs ring-1 ring-primary/40"
                        : "border-border/60 bg-surface hover:border-border hover:bg-muted/30"
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar className="h-9 w-9 rounded-xl border border-border/80 bg-muted/60 text-foreground font-semibold text-xs shrink-0">
                        <AvatarFallback className="rounded-xl bg-primary/10 text-primary font-bold">{initials}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-xs font-bold text-foreground truncate">{name}</p>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={d.driver_status || "Available"} type="driver" />
                          <span className="text-[11px] font-data text-foreground-muted">
                            Class {d.license_class || "3"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0">
                      {isSelected ? (
                        <span className="h-6 w-6 rounded-full bg-primary text-surface flex items-center justify-center text-xs">
                          ✓
                        </span>
                      ) : (
                        <span className="text-xs text-primary font-medium hover:underline">Select</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION D: ASSIGN DRIVER DIALOG (ENHANCED PAIRING STUDIO)
   ══════════════════════════════════════════════════════════════════════════ */

function AssignDriverDialog({ open, onOpenChange, canManage, preset, assignments = [], vehicles = [], drivers = [] }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ driver_id: "", vehicle_id: "", notes: "" });
  const [displacing, setDisplacing] = useState(null);

  // Sync preset when modal opens
  const [lastOpen, setLastOpen] = useState(false);
  if (open && !lastOpen) {
    setLastOpen(true);
    setForm({
      driver_id: preset?.driver_id || "",
      vehicle_id: preset?.vehicle_id || "",
      notes: "",
    });
    setDisplacing(null);
  } else if (!open && lastOpen) {
    setLastOpen(false);
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["driver-assignments"] });
    queryClient.invalidateQueries({ queryKey: ["transport-requests"] });
    queryClient.invalidateQueries({ queryKey: ["vehicles"] });
    queryClient.invalidateQueries({ queryKey: ["drivers"] });
  };

  const assignMutation = useMutation({
    mutationFn: (vars) =>
      assignDriverVehicle({
        driver_id: Number(vars.driver_id),
        vehicle_id: Number(vars.vehicle_id),
        notes: vars.notes || undefined,
        force: vars.force,
      }),
    onSuccess: () => {
      toast.success("Custodial pairing saved successfully");
      setForm({ driver_id: "", vehicle_id: "", notes: "" });
      setDisplacing(null);
      onOpenChange(false);
      invalidate();
    },
    onError: (err) => {
      if (err.status === 409 && err.data?.requires_force) {
        setDisplacing({ message: err.message, current: err.data.current_assignment });
        return;
      }
      toast.error(err.message || "Failed to save assignment");
    },
  });

  const driverChoices = useMemo(() => {
    return drivers.map((d) => {
      const assigned = assignments.find((a) => a.driver_id === d.driver_id);
      return {
        value: String(d.driver_id),
        label: personLabel(d),
        status: d.driver_status,
        currentVehicle: assigned ? vehiclePlate(assigned) : null,
      };
    });
  }, [drivers, assignments]);

  const vehicleChoices = useMemo(() => {
    return vehicles.map((v) => {
      const assigned = assignments.find((a) => a.vehicle_id === v.vehicle_id);
      return {
        value: String(v.vehicle_id),
        label: vehicleLabel(v),
        plate: vehiclePlate(v),
        status: v.vehicle_status,
        currentDriver: assigned ? personLabel(assigned) : null,
      };
    });
  }, [vehicles, assignments]);

  // Live conflict detection before submission
  const selectedVehicleObj = vehicleChoices.find((v) => v.value === form.vehicle_id);
  const selectedDriverObj = driverChoices.find((d) => d.value === form.driver_id);

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.driver_id || !form.vehicle_id) {
      toast.error("Select both a driver and a vehicle.");
      return;
    }
    assignMutation.mutate(form);
  }

  if (!canManage) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg p-0 overflow-hidden rounded-3xl bg-surface border border-border/80 shadow-2xl">
          <DialogHeader className="p-6 pb-4 border-b border-border/50 bg-muted/20">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                <Link2 className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-foreground">Assign Driver to Vehicle</DialogTitle>
                <DialogDescription className="text-xs text-foreground-secondary mt-0.5">
                  Establishes designated custodial accountability for maintenance, logs, and condition.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {/* Driver Picker */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground">Designated Driver</Label>
              <Select value={form.driver_id || undefined} onValueChange={(v) => setForm({ ...form, driver_id: v })}>
                <SelectTrigger className="w-full text-left font-normal h-10 rounded-xl">
                  <SelectValue placeholder="Select a driver" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {driverChoices.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      <div className="flex items-center justify-between gap-3 w-full py-0.5">
                        <span className="font-medium text-foreground">{c.label}</span>
                        {c.currentVehicle && (
                          <span className="text-[10px] font-data text-foreground-muted bg-muted px-1.5 py-0.5 rounded">
                            holds {c.currentVehicle}
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedDriverObj?.currentVehicle && (
                <p className="text-[11px] text-foreground-muted flex items-center gap-1">
                  <Info className="w-3 h-3 text-info shrink-0" />
                  Driver currently holds <strong className="font-semibold">{selectedDriverObj.currentVehicle}</strong>. That pairing will close automatically.
                </p>
              )}
            </div>

            {/* Vehicle Picker */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground">Fleet Vehicle</Label>
              <Select value={form.vehicle_id || undefined} onValueChange={(v) => setForm({ ...form, vehicle_id: v })}>
                <SelectTrigger className="w-full text-left font-normal h-10 rounded-xl">
                  <SelectValue placeholder="Select a vehicle" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {vehicleChoices.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      <div className="flex items-center justify-between gap-3 w-full py-0.5">
                        <span className="font-medium text-foreground">{c.label}</span>
                        {c.currentDriver && (
                          <span className="text-[10px] text-amber-700 dark:text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded">
                            held by {c.currentDriver}
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedVehicleObj?.currentDriver && (
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-[11px] flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                  <span>
                    Vehicle currently assigned to <strong className="font-semibold">{selectedVehicleObj.currentDriver}</strong>. Committing will prompt for reassignment confirmation.
                  </span>
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="assignment_notes" className="text-xs font-semibold text-foreground">Notes (optional)</Label>
                <div className="flex items-center gap-1">
                  {["Regular swap", "Permanent assignment"].map((presetText) => (
                    <button
                      key={presetText}
                      type="button"
                      onClick={() => setForm({ ...form, notes: presetText })}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 hover:bg-muted text-foreground-muted hover:text-foreground cursor-pointer transition-colors"
                    >
                      {presetText}
                    </button>
                  ))}
                </div>
              </div>
              <Input
                id="assignment_notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="e.g. Regular unit swap, new onboarding"
                className="h-10 rounded-xl text-xs"
              />
            </div>

            {/* Live Pairing Preview */}
            {selectedDriverObj && selectedVehicleObj && (
              <div className="p-3.5 rounded-2xl bg-primary/5 border border-primary/20 space-y-2">
                <span className="text-[11px] font-bold text-primary uppercase tracking-wider block">
                  Pairing Preview
                </span>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <div className="font-semibold text-foreground truncate">{selectedDriverObj.label}</div>
                  <div className="flex items-center gap-1.5 text-primary shrink-0">
                    <Link2 className="w-4 h-4" />
                  </div>
                  <div className="font-semibold text-foreground truncate">{selectedVehicleObj.plate}</div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-border/50">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl text-xs h-9">
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={assignMutation.isPending || !form.driver_id || !form.vehicle_id}
                className={cn("rounded-xl text-xs h-9 font-semibold", heroButtonPrimaryClass)}
              >
                {assignMutation.isPending ? "Saving..." : "Save Assignment"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!displacing}
        onOpenChange={(open) => !open && setDisplacing(null)}
        title="Reassign this vehicle?"
        message={displacing?.message || "This vehicle is currently assigned to another driver. Overriding will close their active pairing."}
        confirmLabel="Reassign Vehicle"
        variant="warning"
        loading={assignMutation.isPending}
        onConfirm={() => displacing && assignMutation.mutate({ ...form, force: true })}
      />
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION E: SCHEDULE SUBSTITUTE DIALOG
   ══════════════════════════════════════════════════════════════════════════ */

function ScheduleDialog({ mode = "create", open, onOpenChange, canManage, schedule, onClose, vehicles = [], drivers = [] }) {
  const queryClient = useQueryClient();
  const isEdit = mode === "edit";
  const [form, setForm] = useState({ vehicle_id: "", substitute_driver_id: "", from: "", until: "", notes: "" });

  const [seededFor, setSeededFor] = useState(null);
  if (isEdit && schedule && seededFor !== schedule.substitute_id) {
    setSeededFor(schedule.substitute_id);
    setForm({
      vehicle_id: String(schedule.vehicle_id),
      substitute_driver_id: String(schedule.substitute_driver_id),
      from: schedule.effective_from || "",
      until: schedule.effective_until || "",
      notes: schedule.notes || "",
    });
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["substitute-schedules"] });
    queryClient.invalidateQueries({ queryKey: ["reservation-recommendation"] });
    queryClient.invalidateQueries({ queryKey: ["transport-requests"] });
  };

  const mutation = useMutation({
    mutationFn: () =>
      isEdit
        ? updateSubstituteSchedule(schedule.substitute_id, {
            substitute_driver_id: Number(form.substitute_driver_id),
            effective_from: form.from,
            ...(form.until ? { effective_until: form.until } : {}),
            notes: form.notes || undefined,
          })
        : createSubstituteSchedule({
            vehicle_id: Number(form.vehicle_id),
            substitute_driver_id: Number(form.substitute_driver_id),
            ...(form.from ? { effective_from: form.from } : {}),
            ...(form.until ? { effective_until: form.until } : {}),
            ...(form.notes ? { notes: form.notes } : {}),
          }),
    onSuccess: () => {
      toast.success(isEdit ? "Substitute schedule updated" : "Substitute driver scheduled");
      onOpenChange(false);
      onClose?.();
      invalidate();
    },
    onError: (err) => toast.error(err.message || "Failed to save substitute schedule"),
  });

  const driverChoices = useMemo(() => {
    // Only available drivers without an assigned custodial vehicle
    return drivers.map((d) => ({
      value: String(d.driver_id),
      label: personLabel(d),
    }));
  }, [drivers]);

  const vehicleChoices = useMemo(() => {
    return vehicles.map((v) => ({
      value: String(v.vehicle_id),
      label: vehicleLabel(v),
    }));
  }, [vehicles]);

  const setDatePreset = (days) => {
    const today = new Date();
    const fromStr = today.toISOString().slice(0, 10);
    if (days === 0) {
      setForm({ ...form, from: fromStr, until: "" });
    } else {
      const target = new Date(today.getTime() + days * 24 * 60 * 60 * 1000);
      setForm({ ...form, from: fromStr, until: target.toISOString().slice(0, 10) });
    }
  };

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.substitute_driver_id || (!isEdit && !form.vehicle_id)) {
      toast.error("Select both a vehicle and a substitute driver.");
      return;
    }
    mutation.mutate();
  }

  if (!canManage) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden rounded-3xl bg-surface border border-border/80 shadow-2xl">
        <DialogHeader className="p-6 pb-4 border-b border-border/50 bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-info/10 border border-info/20 flex items-center justify-center text-info shrink-0">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-foreground">
                {isEdit ? "Edit Substitute Schedule" : "Schedule Substitute Driver"}
              </DialogTitle>
              <DialogDescription className="text-xs text-foreground-secondary mt-0.5">
                Temporary coverage when a vehicle&apos;s designated driver is unavailable.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {!isEdit && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground">Vehicle</Label>
              <Select value={form.vehicle_id || undefined} onValueChange={(v) => setForm({ ...form, vehicle_id: v })}>
                <SelectTrigger className="w-full text-left font-normal h-10 rounded-xl">
                  <SelectValue placeholder="Select a vehicle" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {vehicleChoices.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-foreground">Substitute Driver</Label>
            <Select
              value={form.substitute_driver_id || undefined}
              onValueChange={(v) => setForm({ ...form, substitute_driver_id: v })}
            >
              <SelectTrigger className="w-full text-left font-normal h-10 rounded-xl">
                <SelectValue placeholder="Select substitute driver" />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {driverChoices.length === 0 ? (
                  <SelectItem value="__none__" disabled>No drivers available</SelectItem>
                ) : (
                  driverChoices.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-foreground">Coverage Range</Label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setDatePreset(0)}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 hover:bg-muted text-foreground-muted hover:text-foreground cursor-pointer transition-colors"
                >
                  Open-Ended
                </button>
                <button
                  type="button"
                  onClick={() => setDatePreset(7)}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 hover:bg-muted text-foreground-muted hover:text-foreground cursor-pointer transition-colors"
                >
                  7 Days
                </button>
                <button
                  type="button"
                  onClick={() => setDatePreset(30)}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 hover:bg-muted text-foreground-muted hover:text-foreground cursor-pointer transition-colors"
                >
                  30 Days
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <DatePicker
                id="sub_from"
                label={isEdit ? "From" : "From (today)"}
                value={form.from}
                onChange={(val) => setForm({ ...form, from: val || "" })}
              />
              <DatePicker
                id="sub_until"
                label="Until (optional)"
                value={form.until}
                onChange={(val) => setForm({ ...form, until: val || "" })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sub_notes" className="text-xs font-semibold text-foreground">Notes (optional)</Label>
            <Input
              id="sub_notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="e.g. Covering while custodian is suspended or on leave"
              className="h-10 rounded-xl text-xs"
            />
          </div>

          <div className="flex items-center justify-between gap-3 pt-3 border-t border-border/50">
            <span className="text-[11px] text-foreground-muted flex items-center gap-1">
              <InfinityIcon className="w-3 h-3 text-info" /> Blank Until = open-ended
            </span>
            <div className="flex items-center gap-2.5">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl text-xs h-9">
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={mutation.isPending || !form.substitute_driver_id || (!isEdit && !form.vehicle_id)}
                className={cn("rounded-xl text-xs h-9 font-semibold", heroButtonPrimaryClass)}
              >
                {mutation.isPending ? "Saving..." : isEdit ? "Save Changes" : "Schedule Substitute"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
