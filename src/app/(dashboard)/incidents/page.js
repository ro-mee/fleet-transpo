"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { getAllIncidents, getIncidentSummary } from "@/services/driver.service";
import { resolveIncidentCoords } from "@/lib/geo/incident-coords";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { AlertTriangle, Wrench, AlertCircle, MapPin, Eye, Map as MapIcon, Maximize, Minimize, Download, UserCheck, RefreshCw, ExternalLink, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useRequireRole } from "@/lib/auth/role-guard";
import { rolesFor } from "@/lib/auth/permissions";
import { HeroHeader, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { DataTable } from "@/components/tables/data-table";
import { Button } from "@/components/ui/button";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { updateIncident } from "@/services/driver.service";
import { getIncidentWorkbook } from "@/services/report.service";
import { downloadBlob } from "@/lib/export";
import { apiFetch } from "@/lib/api/client";
import { incidentTypeLabel } from "@/lib/incidents/resolution";
import { ImageViewer } from "@/components/ui/image-viewer";
const IncidentMap = dynamic(() => import("@/components/maps/incident-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-muted/40 text-xs font-semibold text-foreground-muted">
      Loading map…
    </div>
  ),
});

const SEVERITY_VARIANT = {
  Minor: "info",
  Moderate: "warning",
  Major: "warning",
  Critical: "danger",
};

export default function IncidentsPage() {
  const { role } = useRequireRole();
  const canAct = rolesFor("incidents", "resolve").includes(role);
  const canRouteMaintenance = rolesFor("incidents", "route_to_maintenance").includes(role);
  const queryClient = useQueryClient();

  const [resolveModal, setResolveModal] = useState({ open: false, incident: null });
  const [actionsTaken, setActionsTaken] = useState("");
  const [fullScreenImage, setFullScreenImage] = useState(null);
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);

  const { data = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["all-incidents"],
    queryFn: () => getAllIncidents(),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const { data: summary = {}, isLoading: summaryLoading } = useQuery({
    queryKey: ["incident-summary"],
    queryFn: () => getIncidentSummary(),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, payload }) => updateIncident(id, payload),
    onSuccess: () => {
      toast.success("Incident resolved successfully");
      queryClient.invalidateQueries({ queryKey: ["all-incidents"] });
      queryClient.invalidateQueries({ queryKey: ["incident-summary"] });
      queryClient.invalidateQueries({ queryKey: ["pending-incidents"] }); // clear sidebar badge
      setResolveModal({ open: false, incident: null });
      setActionsTaken("");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to resolve incident");
    },
  });

  const acknowledgeMutation = useMutation({
    mutationFn: (id) => apiFetch(`/api/incidents/${id}/acknowledge`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Incident acknowledged");
      queryClient.invalidateQueries({ queryKey: ["all-incidents"] });
      queryClient.invalidateQueries({ queryKey: ["incident-summary"] });
      queryClient.invalidateQueries({ queryKey: ["pending-incidents"] });
      queryClient.invalidateQueries({ queryKey: ["incident-detail", resolveModal.incident?.incident_id] });
    },
    onError: (err) => toast.error(err.message || "Failed to acknowledge incident"),
  });

  const groundingMutation = useMutation({
    mutationFn: (id) => apiFetch(`/api/incidents/${id}/grounding`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Vehicle safety actions completed");
      queryClient.invalidateQueries({ queryKey: ["all-incidents"] });
      queryClient.invalidateQueries({ queryKey: ["incident-summary"] });
      queryClient.invalidateQueries({ queryKey: ["incident-detail", resolveModal.incident?.incident_id] });
    },
    onError: (err) => toast.error(err.message || "Vehicle safety actions could not be completed"),
  });

  // Resolver context for the modal: what grounding automation did on this
  // incident's behalf (interrupted dispatches) and any linked repairs.
  const detailQuery = useQuery({
    queryKey: ["incident-detail", resolveModal.incident?.incident_id],
    queryFn: () => apiFetch(`/api/incidents/${resolveModal.incident.incident_id}`),
    enabled: resolveModal.open && !!resolveModal.incident,
  });
  const detailIncident = detailQuery.data || resolveModal.incident;
  const isResolved = String(detailIncident?.status || "").toLowerCase() === "resolved";
  const groundingBlocked = ["Pending", "Failed"].includes(detailIncident?.grounding_status);
  const detailMaintenanceId = detailIncident?.maintenance_id
    || detailIncident?.linked_maintenance_id
    || detailQuery.data?.linked_maintenance?.[0]?.maintenance_id;

  const maintenanceMutation = useMutation({
    mutationFn: (id) => apiFetch(`/api/incidents/${id}/maintenance`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Maintenance work order is ready");
      queryClient.invalidateQueries({ queryKey: ["all-incidents"] });
      queryClient.invalidateQueries({ queryKey: ["incident-summary"] });
      queryClient.invalidateQueries({ queryKey: ["pending-incidents"] });
      queryClient.invalidateQueries({ queryKey: ["incident-detail", resolveModal.incident?.incident_id] });
      queryClient.invalidateQueries({ queryKey: ["maintenance"] });
    },
    onError: (err) => toast.error(err.message || "Maintenance work order could not be created"),
  });

  const incidents = useMemo(() => {
    return (data || []).map((inc) => {
      const coords = resolveIncidentCoords(inc);
      return { ...inc, latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null };
    });
  }, [data]);

  const activeIncidents = useMemo(() => {
    return incidents.filter((i) => (i.status || "").toLowerCase() !== "resolved");
  }, [incidents]);

  const counts = useMemo(() => {
    const c = { Critical: 0, Major: 0, Moderate: 0, Minor: 0, Open: 0, Unacknowledged: 0 };
    incidents.forEach((i) => {
      if (c[i.severity] != null) c[i.severity] += 1;
      if ((i.status || "").toLowerCase() === "open") {
        c.Open += 1;
        if (!i.acknowledged_at) c.Unacknowledged += 1;
      }
    });
    return c;
  }, [incidents]);
  const totalCount = Number.isFinite(Number(summary.total)) ? Number(summary.total) : incidents.length;
  const openCount = Number.isFinite(Number(summary.open)) ? Number(summary.open) : counts.Open;
  const unacknowledgedCount = Number.isFinite(Number(summary.unacknowledged)) ? Number(summary.unacknowledged) : counts.Unacknowledged;
  const criticalMajorOpen = Number.isFinite(Number(summary.critical_major_open))
    ? Number(summary.critical_major_open)
    : incidents.filter((i) => i.status === "Open" && ["Critical", "Major"].includes(i.severity)).length;
  const groundingFailed = Number(summary.grounding_failed) || incidents.filter((i) => i.status === "Open" && i.grounding_status === "Failed").length;

  const columns = [
    {
      key: "incident_type",
      label: "Incident Type",
      sortable: true,
      meta: {
        className: "w-[52%] sm:w-[36%] lg:w-[30%] min-w-0 whitespace-normal align-top",
        headerClassName: "w-[52%] sm:w-[36%] lg:w-[30%]",
      },
      render: (val, row) => (
        <div className="min-w-0 max-w-full">
          <p className="break-words font-bold text-sm text-foreground">{incidentTypeLabel(val)}</p>
          {row.location && (
            <p className="flex items-start gap-1 text-xs text-foreground-muted font-medium mt-0.5">
              <MapPin className="w-3 h-3 text-danger shrink-0 mt-0.5" />
              <span className="min-w-0 break-words">{row.location}</span>
            </p>
          )}
          {row.latitude != null && row.longitude != null && (
            <a
              href={`https://www.google.com/maps?q=${row.latitude},${row.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-full min-w-0 items-center gap-1 text-[11px] font-bold text-primary bg-primary/10 border border-primary/25 rounded-lg px-2 py-1 mt-1.5 hover:bg-primary/15 hover:border-primary transition-colors"
              title="Open exact location in Google Maps to share with emergency services"
            >
              <MapPin className="w-3 h-3 shrink-0" />
              <span className="min-w-0 truncate"><span className="hidden sm:inline">View on Google Maps</span><span className="sm:hidden">Maps</span></span>
            </a>
          )}
          {row.description && (
            <p className="break-words text-xs text-foreground-secondary mt-1 line-clamp-2">{row.description}</p>
          )}
          {row.expense_amount && (
            <span className="inline-flex max-w-full items-center gap-1 break-words text-[10px] font-bold text-danger bg-danger/10 border border-danger/20 rounded px-1.5 py-0.5 mt-1.5 uppercase">
              ₱{Number(row.expense_amount).toLocaleString("en-PH", { minimumFractionDigits: 2 })} Expense
            </span>
          )}
          {Array.isArray(row.assistance_needed) && row.assistance_needed.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {row.assistance_needed.map((need) => (
                <span
                  key={need}
                  className="inline-flex max-w-full items-center gap-1 break-words text-[10px] font-bold text-warning bg-warning/10 border border-warning/20 rounded px-1.5 py-0.5"
                  title="Assistance requested by the driver"
                >
                  <AlertCircle className="w-3 h-3" />
                  {need}
                </span>
              ))}
            </div>
          )}
          {Number(row.photo_count) > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              <span className="inline-flex max-w-full items-center gap-1 text-[10px] font-bold text-info bg-info/10 border border-info/20 rounded px-1.5 py-0.5" title="View in details">
                <Eye className="w-3 h-3" />
                <span className="min-w-0 truncate">{row.photo_count} Photo{Number(row.photo_count) !== 1 ? "s" : ""} <span className="hidden sm:inline">Attached</span></span>
              </span>
            </div>
          )}
        </div>
      ),
    },
    {
      key: "driver",
      label: "Driver",
      meta: {
        className: "hidden sm:table-cell sm:w-[18%] lg:w-[14%] min-w-0 whitespace-normal align-top",
        headerClassName: "hidden sm:table-cell sm:w-[18%] lg:w-[14%]",
      },
      render: (_, row) => {
        const d = row.driver;
        if (!d) return <span className="text-xs text-foreground-muted italic font-medium">—</span>;
        const name = `${d.first_name || ""} ${d.last_name || ""}`.trim();
        const initials = [d.first_name?.[0], d.last_name?.[0]].filter(Boolean).join("").toUpperCase();
        return (
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-muted/60 font-black text-[11px] text-foreground border border-border/40 shadow-2xs sm:h-10 sm:w-10 sm:text-xs">
              {initials || "DR"}
            </div>
            <div className="min-w-0">
              <Link href={`/drivers/${d.driver_id}`} className="block truncate font-bold text-sm text-foreground hover:text-primary transition-colors" title={name}>
                {name}
              </Link>
              <p className="truncate text-xs text-foreground-muted font-medium">Reporting driver</p>
            </div>
          </div>
        );
      },
    },
    {
      key: "vehicle",
      label: "Vehicle",
      meta: {
        className: "hidden lg:table-cell lg:w-[9%] min-w-0 whitespace-normal align-top",
        headerClassName: "hidden lg:table-cell lg:w-[9%]",
      },
      render: (_, row) =>
        row.plate_number ? (
          <span className="inline-flex max-w-full items-center truncate rounded-xl border border-border/80 bg-surface px-2 py-1.5 font-data text-xs font-bold tracking-wide text-foreground shadow-2xs sm:px-3" title={row.plate_number}>
            {row.plate_number}
          </span>
        ) : row.vehicle_id ? (
          <span className="inline-flex max-w-full items-center truncate rounded-xl border border-border/80 bg-surface px-2 py-1.5 font-data text-xs font-bold tracking-wide text-foreground shadow-2xs sm:px-3" title={`Vehicle #${row.vehicle_id}`}>
            #{row.vehicle_id}
          </span>
        ) : (
          <span className="text-xs text-foreground-muted font-medium">—</span>
        ),
    },
    {
      key: "severity",
      label: "Severity",
      sortable: true,
      meta: {
        className: "w-[13%] sm:w-[10%] lg:w-[9%] min-w-0 whitespace-normal align-top",
        headerClassName: "w-[13%] sm:w-[10%] lg:w-[9%]",
      },
      render: (val) => (
        <Badge
          variant={SEVERITY_VARIANT[val] || "secondary"}
          title={val || "Minor"}
          aria-label={`Severity: ${val || "Minor"}`}
          className="max-w-full truncate rounded-full px-1.5 py-1 text-[10px] font-bold lg:px-3 lg:text-xs"
        >
          <span className="lg:hidden">{{ Critical: "Crit", Major: "Major", Moderate: "Mod", Minor: "Min" }[val] || "Min"}</span>
          <span className="hidden lg:inline">{val || "Minor"}</span>
        </Badge>
      ),
    },
    {
      key: "incident_date",
      label: "Date",
      sortable: true,
      meta: {
        className: "hidden lg:table-cell lg:w-[12%] min-w-0 whitespace-normal align-top",
        headerClassName: "hidden lg:table-cell lg:w-[12%]",
      },
      render: (val) => (
        <span className="break-words font-data font-bold text-xs text-foreground">
          {val ? new Date(val).toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      meta: {
        className: "w-[13%] sm:w-[10%] lg:w-[10%] min-w-0 whitespace-normal align-top",
        headerClassName: "w-[13%] sm:w-[10%] lg:w-[10%]",
      },
      render: (val) => {
        const status = val || "Open";
        const compactStatus = { Resolved: "Done", "In Progress": "Active", Pending: "New" }[status] || status;
        return (
          <StatusBadge
            status={status}
            entity="incident"
            title={status}
            aria-label={`Status: ${status}`}
            className="max-w-full truncate rounded-full px-1.5 py-1 text-[10px] font-bold lg:px-3 lg:text-xs"
            label={<><span className="lg:hidden">{compactStatus}</span><span className="hidden lg:inline">{status}</span></>}
          />
        );
      },
    },
    {
      key: "actions",
      label: "",
      meta: {
        className: "w-[22%] sm:w-[26%] lg:w-[16%] min-w-0 whitespace-normal align-top",
        headerClassName: "w-[22%] sm:w-[26%] lg:w-[16%]",
      },
      render: (_, row) => {
        const isPending = (row.status || "").toLowerCase() === "open";
        const maintenanceId = row.maintenance_id || row.linked_maintenance_id;
        
        return (
          <div className="flex min-w-0 flex-wrap justify-end gap-1.5">
            {maintenanceId && canRouteMaintenance && (
              <Button asChild variant="outline" size="sm" className="max-w-full gap-1.5 px-2 text-[11px] font-semibold text-warning-700 border-warning/30 hover:bg-warning/5 sm:px-3 sm:text-xs" aria-label="View maintenance work order" title="View maintenance work order">
                <Link href={`/maintenance?incident_id=${row.incident_id}`}>
                  <Wrench className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden sm:inline">View Maintenance</span>
                </Link>
              </Button>
            )}
            {maintenanceId && !canRouteMaintenance && (
              <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-warning/25 bg-warning/5 px-2 py-1.5 text-[11px] font-semibold text-warning-700" title={`Maintenance: ${row.maintenance_status || "Open"}`} aria-label={`Maintenance: ${row.maintenance_status || "Open"}`} role="status">
                <Wrench className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden truncate sm:inline">Maintenance: {row.maintenance_status || "Open"}</span>
              </span>
            )}
            {!maintenanceId && row.requires_vehicle_maintenance && row.maintenance_error && canRouteMaintenance && (
              <Button
                variant="outline"
                size="sm"
                className="max-w-full gap-1.5 px-2 text-[11px] font-semibold text-warning-700 border-warning/30 hover:bg-warning/5 sm:px-3 sm:text-xs"
                onClick={() => maintenanceMutation.mutate(row.incident_id)}
                disabled={maintenanceMutation.isPending}
                aria-label="Retry maintenance creation"
                title="Retry maintenance creation"
              >
                <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${maintenanceMutation.isPending ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">{maintenanceMutation.isPending ? "Retrying..." : "Retry Maintenance"}</span>
              </Button>
            )}
            
            {isPending && canAct && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs font-semibold hover:text-primary hover:border-primary"
                onClick={() => {
                  setActionsTaken("");
                  setResolveModal({ open: true, incident: row });
                }}
                disabled={maintenanceMutation.isPending}
                aria-label="Resolve incident"
                title="Resolve incident"
              >
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">Resolve</span>
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs font-semibold text-foreground-secondary hover:text-foreground hover:bg-surface"
              onClick={() => {
                setActionsTaken(row.actions_taken || "");
                setResolveModal({ open: true, incident: row });
              }}
              aria-label="View incident details"
              title="View incident details"
            >
              <Eye className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">View</span>
            </Button>
            {isPending && canAct && !row.acknowledged_at && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs font-semibold text-primary border-primary/30 hover:bg-primary/5"
                onClick={() => acknowledgeMutation.mutate(row.incident_id)}
                disabled={acknowledgeMutation.isPending}
                aria-label="Acknowledge incident"
                title="Acknowledge incident"
              >
                <UserCheck className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">Acknowledge</span>
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  const handleExcelExport = async () => {
    try {
      const result = await getIncidentWorkbook();
      downloadBlob(result.blob, result.filename);
    } catch {
      // The registry remains usable if an export request fails.
    }
  };

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={AlertTriangle}
        title="Fleet Incidents Registry"
        badge="Driver Reports"
        description="Driver-reported incidents across the fleet. Vehicle-related repairs are created automatically when required."
        actions={
          <Button onClick={handleExcelExport} className={`h-11 rounded-full px-5 text-sm font-semibold ${heroButtonPrimaryClass}`}>
            <Download className="mr-2 h-4 w-4" />
            Export Incident Excel
          </Button>
        }
      />

      <StatGrid cols={4}>
        <StatCard icon={AlertTriangle} label="Total Incidents" value={isLoading || summaryLoading ? "-" : totalCount} tone="primary" />
        <StatCard icon={AlertCircle} label="Open" value={isLoading || summaryLoading ? "-" : openCount} tone="warning" />
        <StatCard icon={UserCheck} label="Unacknowledged" value={isLoading || summaryLoading ? "-" : unacknowledgedCount} tone="warning" />
        <StatCard icon={Wrench} label="Critical / Major Open" value={isLoading || summaryLoading ? "-" : criticalMajorOpen} tone="danger" />
      </StatGrid>

      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-danger/10 text-danger">
                <MapIcon className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">Active Incident Map</p>
                <p className="text-xs text-foreground-muted font-medium">
                  {activeIncidents.filter((i) => i && i.latitude != null && i.longitude != null).length} active incidents plotted with GPS coordinates
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsMapFullscreen(true)}
              className="gap-2 text-xs font-semibold"
            >
              <Maximize className="w-4 h-4" />
              Full View
            </Button>
          </div>
          <div className="h-[340px] w-full">
            <IncidentMap incidents={activeIncidents} />
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
        <CardContent className="p-0">
          {isError && (
            <div role="alert" className="flex items-center justify-between gap-4 border-b border-danger/20 bg-danger/5 px-6 py-4 text-sm">
              <p className="font-semibold text-danger">{error?.message || "Incident records could not be loaded."}</p>
              <Button variant="outline" size="sm" onClick={() => refetch()} className="shrink-0 gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </Button>
            </div>
          )}
          {groundingFailed > 0 && (
            <div role="status" className="border-b border-warning/20 bg-warning/5 px-6 py-3 text-xs font-semibold text-warning-700">
              {groundingFailed} open incident{groundingFailed === 1 ? " has" : "s have"} vehicle safety actions that need a retry. Open the incident details to continue.
            </div>
          )}
          <DataTable
            columns={columns}
            data={incidents}
            tableClassName="table-fixed"
            pageSize={5}
            title="All Incidents Registry"
            description="Driver-reported incidents across the fleet."
            icon={AlertTriangle}
            context="Incidents Log"
            searchPlaceholder="Search incidents by type, location, or description..."
            isLoading={isLoading}
            emptyTitle="No incidents reported"
            emptyDescription="Driver incident reports will appear here."
          />
        </CardContent>
      </Card>

      <Dialog open={resolveModal.open} onOpenChange={(open) => !open && setResolveModal({ open: false, incident: null })}>
        <DialogContent 
          onInteractOutside={(e) => {
            if (fullScreenImage) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (fullScreenImage) e.preventDefault();
          }}
          className="max-w-2xl w-[95vw] md:w-[620px] p-0 overflow-hidden rounded-3xl bg-surface border border-border/80 shadow-2xl flex flex-col max-h-[90dvh]"
        >
          <div className="px-6 py-4 border-b border-border/70 bg-surface/80 backdrop-blur-md flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-success/10 text-success border border-success/20 shadow-2xs">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-base font-bold text-foreground">
                    {isResolved || !canAct ? "Incident Details" : "Resolve Incident"}
                  </DialogTitle>
                  <span className="inline-flex items-center rounded-lg border border-border bg-muted px-2 py-0.5 font-mono text-xs font-bold text-foreground">
                    Incident #{resolveModal.incident?.incident_id}
                  </span>
                </div>
                <p className="text-xs text-foreground-muted mt-0.5">
                  {isResolved || !canAct
                    ? "Review the details of this closed incident." 
                    : "Record operational remedies and clear this alert from active monitoring."}
                </p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-4 flex-1 overflow-y-auto">
            {detailQuery.isLoading && <p className="rounded-xl bg-muted/40 px-3 py-2 text-xs font-medium text-foreground-muted">Loading incident details…</p>}
            {detailQuery.isError && <p role="alert" className="rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-xs font-semibold text-danger">Detailed incident context could not be loaded. The registry record is still available.</p>}
            {detailIncident && (
              <>
                <div className="grid grid-cols-2 gap-2 rounded-2xl border border-border/80 bg-muted/30 p-3 text-xs sm:grid-cols-4">
                  <div><span className="block text-[10px] font-bold uppercase tracking-wider text-foreground-muted">Type</span><span className="font-semibold text-foreground">{incidentTypeLabel(detailIncident.incident_type)}</span></div>
                  <div><span className="block text-[10px] font-bold uppercase tracking-wider text-foreground-muted">Severity</span><Badge variant={SEVERITY_VARIANT[detailIncident.severity] || "secondary"}>{detailIncident.severity || "Minor"}</Badge></div>
                  <div><span className="block text-[10px] font-bold uppercase tracking-wider text-foreground-muted">Status</span><StatusBadge status={detailIncident.status || "Open"} entity="incident" /></div>
                  <div><span className="block text-[10px] font-bold uppercase tracking-wider text-foreground-muted">Vehicle</span><span className="font-semibold text-foreground">{detailIncident.plate_number || (detailIncident.vehicle_id ? `#${detailIncident.vehicle_id}` : "Not attached")}</span></div>
                </div>
                <div className="grid gap-2 rounded-2xl border border-border/80 bg-surface p-3 text-xs sm:grid-cols-2">
                  <div><span className="block text-[10px] font-bold uppercase tracking-wider text-foreground-muted">Reported</span><span className="font-medium text-foreground">{detailIncident.incident_date ? new Date(detailIncident.incident_date).toLocaleString("en-PH") : "—"}</span></div>
                  <div><span className="block text-[10px] font-bold uppercase tracking-wider text-foreground-muted">Received</span><span className="font-medium text-foreground">{detailIncident.created_at ? new Date(detailIncident.created_at).toLocaleString("en-PH") : "—"}</span></div>
                  {detailIncident.description && <p className="sm:col-span-2 whitespace-pre-wrap text-foreground-secondary">{detailIncident.description}</p>}
                  {detailIncident.location && <p className="flex items-center gap-1.5 text-foreground-secondary"><MapPin className="h-3.5 w-3.5 text-danger" />{detailIncident.location}</p>}
                  {detailIncident.latitude != null && detailIncident.longitude != null && <a className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline" href={`https://www.google.com/maps?q=${detailIncident.latitude},${detailIncident.longitude}`} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" />Open exact location</a>}
                </div>
                {Array.isArray(detailIncident.assistance_needed) && detailIncident.assistance_needed.length > 0 && <div className="flex flex-wrap gap-1.5"><span className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">Assistance:</span>{detailIncident.assistance_needed.map((need) => <Badge key={need} variant="warning">{need}</Badge>)}</div>}
                {detailIncident.grounding_status && detailIncident.grounding_status !== "Not Required" && <div className={`rounded-xl border px-3 py-2 text-xs ${detailIncident.grounding_status === "Failed" ? "border-danger/30 bg-danger/5 text-danger" : "border-warning/30 bg-warning/5 text-warning-700"}`}><span className="font-bold">Vehicle safety: {detailIncident.grounding_status}</span>{detailIncident.grounding_error && <span className="ml-2">{detailIncident.grounding_error}</span>}</div>}
                {!isResolved && detailIncident.requires_vehicle_maintenance && !detailMaintenanceId && <div role={detailIncident.maintenance_error ? "alert" : "status"} className={`rounded-xl border px-3 py-2 text-xs ${detailIncident.maintenance_error ? "border-danger/30 bg-danger/5 text-danger" : "border-warning/30 bg-warning/5 text-warning-700"}`}><span className="font-bold">Maintenance work order: {detailIncident.maintenance_error ? "needs retry" : "being created"}</span>{detailIncident.maintenance_error && <span className="ml-2">{detailIncident.maintenance_error}</span>}</div>}
                {(detailQuery.data?.affected_dispatches?.length > 0 ||
                  detailQuery.data?.linked_maintenance?.length > 0) && (
                  <div className="rounded-2xl bg-muted/40 p-1.5 border border-border/80 shadow-2xs">
                    <div className="rounded-xl bg-surface p-3.5 border border-border/50 space-y-3">
                      {detailQuery.data.affected_dispatches?.length > 0 && (
                        <div>
                          <span className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider block mb-1.5">
                            Interrupted Dispatches ({detailQuery.data.affected_dispatches.length})
                          </span>
                          <div className="space-y-1">
                            {detailQuery.data.affected_dispatches.map((d) => (
                              <div key={d.dispatch_id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/30 border border-border/50 text-xs">
                                <span className="text-foreground font-semibold truncate">
                                  #{d.dispatch_number || d.dispatch_id} — {d.guest_name || "Guest"}
                                </span>
                                <span className={`shrink-0 text-[11px] font-bold ${(d.dispatch_status || "").toLowerCase() === "pending reassignment" ? "text-danger" : "text-foreground-muted"}`}>
                                  {d.dispatch_status}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {detailQuery.data.linked_maintenance?.length > 0 && (
                        <div className="pt-2 border-t border-border/50">
                          <span className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider block mb-1.5">
                            Linked Maintenance ({detailQuery.data.linked_maintenance.length})
                          </span>
                          <div className="space-y-1">
                            {detailQuery.data.linked_maintenance.map((m) => (
                              <div key={m.maintenance_id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/30 border border-border/50 text-xs">
                                <span className="text-foreground font-semibold truncate">
                                  #{m.maintenance_id} — {m.maintenance_type}
                                </span>
                                <span className="shrink-0 text-[11px] font-bold text-foreground-muted">{m.status}</span>
                                {canRouteMaintenance && <Link href={`/maintenance?incident_id=${resolveModal.incident?.incident_id}`} className="shrink-0 font-semibold text-primary hover:underline">View</Link>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            {detailIncident && Array.isArray(detailIncident.photo_urls) && detailIncident.photo_urls.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider block">
                  Incident Photo Evidence ({detailIncident.photo_urls.length})
                </span>
                <div className="flex gap-4 flex-wrap justify-center py-2">
                  {detailIncident.photo_urls.map((url, idx) => (
                    <button 
                      key={idx} 
                      onClick={(e) => { e.preventDefault(); setFullScreenImage(url); }}
                      className="group relative focus:outline-none overflow-hidden rounded-2xl shadow-md border-2 border-border/80 hover:border-primary/50 transition-all cursor-pointer"
                    >
                      <img src={url} alt={`Incident photo ${idx + 1}`} className="w-40 h-40 object-cover bg-muted/50 group-hover:scale-105 transition-transform duration-300" />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col items-center justify-center text-white p-2">
                        <Eye className="w-6 h-6 mb-1.5 drop-shadow-md" />
                        <span className="text-[11px] font-bold text-center leading-tight drop-shadow-md px-2">Click To View Full Version</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground">
                  Document Actions Taken &amp; Resolution Notes {!isResolved && canAct && <span className="text-danger">*</span>}
                </label>
                {!isResolved && canAct && (
                  <span className="text-[10px] font-mono text-foreground-muted">{actionsTaken.length}/500</span>
                )}
              </div>
              {isResolved || !canAct ? (
                <div className="w-full min-h-[90px] rounded-2xl border border-border/80 bg-surface px-3.5 py-2.5 text-xs text-foreground shadow-2xs whitespace-pre-wrap">
                  {actionsTaken || "No actions documented."}
                </div>
              ) : (
                <>
                  <textarea
                    value={actionsTaken}
                    onChange={(e) => setActionsTaken(e.target.value)}
                    maxLength={500}
                    placeholder="e.g., Sent mobile mechanic, dispatched replacement shuttle, passenger safely rerouted..."
                    className="w-full min-h-[90px] rounded-2xl border border-border/80 bg-surface px-3.5 py-2.5 text-xs text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-y shadow-2xs"
                  />
                  {!actionsTaken.trim() && canAct && (
                    <p className="text-[11px] font-semibold text-danger">
                      Documenting resolution steps is required — this is stored in the audit trail.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="px-6 py-3.5 border-t border-border/70 bg-surface/90 backdrop-blur-md flex items-center justify-end gap-2.5 shrink-0">
            <Button
              variant="outline"
              onClick={() => setResolveModal({ open: false, incident: null })}
              disabled={resolveMutation.isPending || groundingMutation.isPending || acknowledgeMutation.isPending}
              className="text-xs h-9 px-4"
            >
              {isResolved ? "Close" : "Cancel"}
            </Button>
            {!isResolved && canAct && detailIncident && !detailIncident.acknowledged_at && (
              <Button
                variant="outline"
                onClick={() => acknowledgeMutation.mutate(detailIncident.incident_id)}
                disabled={acknowledgeMutation.isPending}
                className="gap-1.5 text-xs h-9 px-4 font-semibold text-primary border-primary/30"
              >
                <UserCheck className="h-3.5 w-3.5" />
                {acknowledgeMutation.isPending ? "Acknowledging…" : "Acknowledge"}
              </Button>
            )}
            {detailIncident?.grounding_status === "Failed" && canAct && (
              <Button
                variant="outline"
                onClick={() => groundingMutation.mutate(detailIncident.incident_id)}
                disabled={groundingMutation.isPending}
                className="gap-1.5 text-xs h-9 px-4 font-semibold text-warning-700 border-warning/30"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${groundingMutation.isPending ? "animate-spin" : ""}`} />
                {groundingMutation.isPending ? "Retrying…" : "Retry safety actions"}
              </Button>
            )}
            {!isResolved && detailIncident?.requires_vehicle_maintenance && !detailMaintenanceId && canRouteMaintenance && (
              <Button
                variant="outline"
                onClick={() => maintenanceMutation.mutate(detailIncident.incident_id)}
                disabled={maintenanceMutation.isPending}
                className="gap-1.5 text-xs h-9 px-4 font-semibold text-warning-700 border-warning/30"
              >
                <Wrench className={`h-3.5 w-3.5 ${maintenanceMutation.isPending ? "animate-spin" : ""}`} />
                {maintenanceMutation.isPending ? "Creating…" : "Retry Maintenance"}
              </Button>
            )}
            {!isResolved && canAct && detailIncident && (
              <Button
                onClick={() => {
                  if (detailIncident) {
                    resolveMutation.mutate({
                      id: detailIncident.incident_id,
                      payload: { status: "Resolved", actions_taken: actionsTaken }
                    });
                  }
                }}
                disabled={resolveMutation.isPending || !actionsTaken.trim() || groundingMutation.isPending || acknowledgeMutation.isPending || groundingBlocked}
                className="text-xs h-9 px-5 font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
              >
                {groundingBlocked ? "Complete safety actions first" : resolveMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                )}
                Mark as Resolved
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Full Screen Image Viewer Overlay */}
      <ImageViewer 
        url={fullScreenImage} 
        onClose={() => setFullScreenImage(null)} 
      />

      {/* Full Screen Map Overlay */}
      {isMapFullscreen && (
        <div className="fixed inset-0 z-[100] bg-surface flex flex-col">
          <div className="flex items-center justify-between border-b border-border/60 px-6 py-4 shrink-0 bg-surface/80 backdrop-blur-md">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-danger/10 text-danger">
                <MapIcon className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">Active Incident Map</p>
                <p className="text-xs text-foreground-muted font-medium">
                  {activeIncidents.filter((i) => i && i.latitude != null && i.longitude != null).length} active incidents plotted with GPS coordinates
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsMapFullscreen(false)}
              className="gap-2 text-xs font-semibold"
            >
              <Minimize className="w-4 h-4" />
              Exit Full View
            </Button>
          </div>
          <div className="flex-1 w-full h-full relative">
            <IncidentMap incidents={activeIncidents} />
          </div>
        </div>
      )}
    </div>
  );
}
