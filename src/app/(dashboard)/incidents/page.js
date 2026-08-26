"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { getAllIncidents } from "@/services/driver.service";
import { resolveIncidentCoords } from "@/lib/geo/incident-coords";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { AlertTriangle, Truck, Wrench, AlertCircle, MapPin, Eye, Map as MapIcon, Maximize, Minimize } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useRequireRole } from "@/lib/auth/role-guard";
import { HeroHeader } from "@/components/ui/hero-header";
import { DataTable } from "@/components/tables/data-table";
import { useRouter } from "next/navigation";
import { Tooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { updateIncident } from "@/services/driver.service";
import { apiFetch } from "@/lib/api/client";
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
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher", "management"]);
  const router = useRouter();
  const queryClient = useQueryClient();

  const [resolveModal, setResolveModal] = useState({ open: false, incident: null });
  const [actionsTaken, setActionsTaken] = useState("");
  const [fullScreenImage, setFullScreenImage] = useState(null);
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);

  const { data = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["all-incidents"],
    queryFn: () => getAllIncidents({ limit: 200 }),
    refetchInterval: 30_000,
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, payload }) => updateIncident(id, payload),
    onSuccess: () => {
      toast.success("Incident resolved successfully");
      queryClient.invalidateQueries({ queryKey: ["all-incidents"] });
      queryClient.invalidateQueries({ queryKey: ["pending-incidents"] }); // clear sidebar badge
      setResolveModal({ open: false, incident: null });
      setActionsTaken("");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to resolve incident");
    },
  });

  // Resolver context for the modal: what grounding automation did on this
  // incident's behalf (interrupted dispatches) and any linked repairs.
  const detailQuery = useQuery({
    queryKey: ["incident-detail", resolveModal.incident?.incident_id],
    queryFn: () => apiFetch(`/api/incidents/${resolveModal.incident.incident_id}`),
    enabled: resolveModal.open && !!resolveModal.incident,
  });

  const sendToMaintenanceMutation = useMutation({
    // One atomic server request: creates the emergency repair record AND
    // resolves the incident in a single transaction. The old client-side
    // two-call sequence could strand a repair record against a still-open
    // incident, or duplicate the repair on retry.
    mutationFn: (row) =>
      apiFetch(`/api/incidents/${row.incident_id}/maintenance`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Incident resolved and sent to Maintenance successfully!");
      queryClient.invalidateQueries({ queryKey: ["all-incidents"] });
      queryClient.invalidateQueries({ queryKey: ["pending-incidents"] });
    },
    onError: (err) => {
      toast.error(err.message || "Failed to send to maintenance");
    }
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
    const c = { Critical: 0, Major: 0, Moderate: 0, Minor: 0, Open: 0 };
    incidents.forEach((i) => {
      if (c[i.severity] != null) c[i.severity] += 1;
      if ((i.status || "").toLowerCase() === "open") c.Open += 1;
    });
    return c;
  }, [incidents]);

  const columns = [
    {
      key: "incident_type",
      label: "Incident Type",
      sortable: true,
      meta: { className: "whitespace-normal min-w-[260px] align-top" },
      render: (val, row) => (
        <div>
          <p className="font-bold text-sm text-foreground">{val || "Incident"}</p>
          {row.location && (
            <p className="flex items-start gap-1 text-xs text-foreground-muted font-medium mt-0.5">
              <MapPin className="w-3 h-3 text-danger shrink-0 mt-0.5" />
              <span className="min-w-0">{row.location}</span>
            </p>
          )}
          {row.latitude != null && row.longitude != null && (
            <a
              href={`https://www.google.com/maps?q=${row.latitude},${row.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-bold text-primary bg-primary/10 border border-primary/25 rounded-lg px-2 py-1 mt-1.5 hover:bg-primary/15 hover:border-primary transition-colors"
              title="Open exact location in Google Maps to share with emergency services"
            >
              <MapPin className="w-3 h-3" />
              View on Google Maps
            </a>
          )}
          {row.description && (
            <p className="text-xs text-foreground-secondary mt-1">{row.description}</p>
          )}
          {row.expense_amount && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-danger bg-danger/10 border border-danger/20 rounded px-1.5 py-0.5 mt-1.5 uppercase">
              ₱{Number(row.expense_amount).toLocaleString("en-PH", { minimumFractionDigits: 2 })} Expense
            </span>
          )}
          {Array.isArray(row.assistance_needed) && row.assistance_needed.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {row.assistance_needed.map((need) => (
                <span
                  key={need}
                  className="inline-flex items-center gap-1 text-[10px] font-bold text-warning bg-warning/10 border border-warning/20 rounded px-1.5 py-0.5"
                  title="Assistance requested by the driver"
                >
                  <AlertCircle className="w-3 h-3" />
                  {need}
                </span>
              ))}
            </div>
          )}
          {Array.isArray(row.photo_urls) && row.photo_urls.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-info bg-info/10 border border-info/20 rounded px-1.5 py-0.5" title="View in details">
                <Eye className="w-3 h-3" />
                {row.photo_urls.length} Photo{row.photo_urls.length !== 1 ? "s" : ""} Attached
              </span>
            </div>
          )}
        </div>
      ),
    },
    {
      key: "driver",
      label: "Driver",
      render: (_, row) => {
        const d = row.driver;
        if (!d) return <span className="text-xs text-foreground-muted italic font-medium">—</span>;
        const name = `${d.first_name || ""} ${d.last_name || ""}`.trim();
        const initials = [d.first_name?.[0], d.last_name?.[0]].filter(Boolean).join("").toUpperCase();
        return (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted/60 font-black text-xs text-foreground border border-border/40 shadow-2xs">
              {initials || "DR"}
            </div>
            <div>
              <Link href={`/drivers/${d.driver_id}`} className="font-bold text-sm text-foreground hover:text-primary transition-colors">
                {name}
              </Link>
              <p className="text-xs text-foreground-muted font-medium">Reporting driver</p>
            </div>
          </div>
        );
      },
    },
    {
      key: "vehicle",
      label: "Vehicle",
      render: (_, row) =>
        row.plate_number ? (
          <span className="inline-flex items-center rounded-xl border border-border/80 bg-surface px-3 py-1.5 font-data text-xs font-bold tracking-wide text-foreground shadow-2xs">
            {row.plate_number}
          </span>
        ) : row.vehicle_id ? (
          <span className="inline-flex items-center rounded-xl border border-border/80 bg-surface px-3 py-1.5 font-data text-xs font-bold tracking-wide text-foreground shadow-2xs">
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
      render: (val) => (
        <Badge variant={SEVERITY_VARIANT[val] || "secondary"} className="rounded-full px-3 py-1 text-xs font-bold">
          {val || "Minor"}
        </Badge>
      ),
    },
    {
      key: "incident_date",
      label: "Date",
      sortable: true,
      render: (val) => (
        <span className="font-data font-bold text-xs text-foreground">
          {val ? new Date(val).toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (val) => <StatusBadge status={val || "Open"} entity="incident" className="rounded-full px-3 py-1 text-xs font-bold" />,
    },
    {
      key: "actions",
      label: "",
      render: (_, row) => {
        const isPending = (row.status || "").toLowerCase() === "pending" || (row.status || "").toLowerCase() === "open";
        
        return (
          <div className="flex justify-end gap-2">
            {isPending && row.reported_vehicle_id && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs font-semibold text-danger border-danger/30 hover:bg-danger/5 hover:text-danger hover:border-danger"
                onClick={() => {
                  if (confirm(`Send vehicle to maintenance? This will also mark the incident as resolved.`)) {
                    sendToMaintenanceMutation.mutate(row);
                  }
                }}
                disabled={sendToMaintenanceMutation.isPending}
              >
                <Wrench className="w-3.5 h-3.5" />
                {sendToMaintenanceMutation.isPending ? "Sending..." : "Send to Maintenance"}
              </Button>
            )}
            
            {isPending && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs font-semibold hover:text-primary hover:border-primary"
                onClick={() => {
                  setActionsTaken("");
                  setResolveModal({ open: true, incident: row });
                }}
                disabled={sendToMaintenanceMutation.isPending}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Resolve
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
            >
              <Eye className="w-3.5 h-3.5" />
              View
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={AlertTriangle}
        title="Fleet Incidents Registry"
        badge="Driver Reports"
        description="Driver-reported incidents across the fleet. Resolve inline or route the vehicle to emergency repairs."
      />

      <StatGrid cols={4}>
        <StatCard icon={AlertTriangle} label="Total Incidents" value={isLoading ? "-" : incidents.length} tone="primary" />
        <StatCard icon={AlertCircle} label="Open" value={isLoading ? "-" : counts.Open} tone="warning" />
        <StatCard icon={Wrench} label="Critical / Major" value={isLoading ? "-" : counts.Critical + counts.Major} tone="danger" />
        <StatCard icon={Truck} label="Breakdowns" value={isLoading ? "-" : incidents.filter((i) => /breakdown|mechanical|engine/i.test(i.incident_type || "")).length} tone="info" />
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
          <DataTable
            columns={columns}
            data={incidents}
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
        <DialogContent className="max-w-2xl w-[95vw] md:w-[620px] p-0 overflow-hidden rounded-3xl bg-surface border border-border/80 shadow-2xl">
          <div className="px-6 py-4 border-b border-border/70 bg-surface/80 backdrop-blur-md flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-success/10 text-success border border-success/20 shadow-2xs">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-base font-bold text-foreground">
                    {resolveModal.incident && (resolveModal.incident.status || "").toLowerCase() === "resolved" ? "Incident Details" : "Resolve Incident"}
                  </DialogTitle>
                  <span className="inline-flex items-center rounded-lg border border-border bg-muted px-2 py-0.5 font-mono text-xs font-bold text-foreground">
                    Incident #{resolveModal.incident?.incident_id}
                  </span>
                </div>
                <p className="text-xs text-foreground-muted mt-0.5">
                  {resolveModal.incident && (resolveModal.incident.status || "").toLowerCase() === "resolved" 
                    ? "Review the details of this closed incident." 
                    : "Record operational remedies and clear this alert from active monitoring."}
                </p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
            {resolveModal.incident && (
              <>
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

            {resolveModal.incident && Array.isArray(resolveModal.incident.photo_urls) && resolveModal.incident.photo_urls.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider block">
                  Incident Photo Evidence ({resolveModal.incident.photo_urls.length})
                </span>
                <div className="flex gap-4 flex-wrap justify-center py-2">
                  {resolveModal.incident.photo_urls.map((url, idx) => (
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
                  Document Actions Taken &amp; Resolution Notes {!(resolveModal.incident && (resolveModal.incident.status || "").toLowerCase() === "resolved") && <span className="text-danger">*</span>}
                </label>
                {!(resolveModal.incident && (resolveModal.incident.status || "").toLowerCase() === "resolved") && (
                  <span className="text-[10px] font-mono text-foreground-muted">{actionsTaken.length}/500</span>
                )}
              </div>
              {resolveModal.incident && (resolveModal.incident.status || "").toLowerCase() === "resolved" ? (
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
                  {!actionsTaken.trim() && (
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
              disabled={resolveMutation.isPending}
              className="text-xs h-9 px-4"
            >
              {resolveModal.incident && (resolveModal.incident.status || "").toLowerCase() === "resolved" ? "Close" : "Cancel"}
            </Button>
            {!(resolveModal.incident && (resolveModal.incident.status || "").toLowerCase() === "resolved") && (
              <Button
                onClick={() => {
                  if (resolveModal.incident) {
                    resolveMutation.mutate({
                      id: resolveModal.incident.incident_id,
                      payload: { status: "Resolved", actions_taken: actionsTaken }
                    });
                  }
                }}
                disabled={resolveMutation.isPending || !actionsTaken.trim()}
                className="text-xs h-9 px-5 font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
              >
                {resolveMutation.isPending ? (
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
      {fullScreenImage && (
        <div 
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 p-4 cursor-zoom-out"
          onClick={() => setFullScreenImage(null)}
        >
          <img 
            src={fullScreenImage} 
            alt="Full screen incident photo" 
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
          />
        </div>
      )}

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
