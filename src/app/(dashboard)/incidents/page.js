"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { getAllIncidents } from "@/services/driver.service";
import { resolveIncidentCoords } from "@/lib/geo/incident-coords";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { AlertTriangle, Truck, Wrench, AlertCircle, MapPin, Eye, Map as MapIcon } from "lucide-react";
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
import { CheckCircle2 } from "lucide-react";
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
        if ((row.status || "").toLowerCase() === "pending" || (row.status || "").toLowerCase() === "open") {
          return (
            <div className="flex justify-end gap-2">
              {/* Gate on the vehicle the incident itself names. The list's
                  vehicle_id falls back to the driver's CURRENT assignment
                  (COALESCE in the API), which may be a vehicle the incident
                  never mentioned — routing that one to emergency repairs on
                  an incident's say-so is how costs land on the wrong truck.
                  The server enforces the same rule. */}
              {row.reported_vehicle_id && (
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
            </div>
          );
        }
        return null;
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve Incident</DialogTitle>
            <DialogDescription>
              Marking this incident as resolved will clear it from the pending alerts. Please document any actions taken.
            </DialogDescription>
          </DialogHeader>
          {resolveModal.incident && (
            <div className="px-6 pt-2 space-y-2">
              {(detailQuery.data?.affected_dispatches?.length > 0 ||
                detailQuery.data?.linked_maintenance?.length > 0) && (
                <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs">
                  {detailQuery.data.affected_dispatches?.length > 0 && (
                    <div className="mb-2">
                      <p className="font-bold text-foreground mb-1">
                        Interrupted dispatches ({detailQuery.data.affected_dispatches.length})
                      </p>
                      {detailQuery.data.affected_dispatches.map((d) => (
                        <div key={d.dispatch_id} className="flex items-center justify-between gap-2 py-0.5">
                          <span className="text-foreground-secondary font-medium truncate">
                            #{d.dispatch_number || d.dispatch_id} — {d.guest_name || "Unknown guest"}
                          </span>
                          <span className={`shrink-0 font-bold ${(d.dispatch_status || "").toLowerCase() === "pending reassignment" ? "text-danger" : "text-foreground-muted"}`}>
                            {d.dispatch_status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {detailQuery.data.linked_maintenance?.length > 0 && (
                    <div>
                      <p className="font-bold text-foreground mb-1">
                        Linked repairs ({detailQuery.data.linked_maintenance.length})
                      </p>
                      {detailQuery.data.linked_maintenance.map((m) => (
                        <div key={m.maintenance_id} className="flex items-center justify-between gap-2 py-0.5">
                          <span className="text-foreground-secondary font-medium truncate">
                            #{m.maintenance_id} — {m.maintenance_type}
                          </span>
                          <span className="shrink-0 font-bold text-foreground-muted">{m.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {resolveModal.incident && Array.isArray(resolveModal.incident.photo_urls) && resolveModal.incident.photo_urls.length > 0 && (
            <div className="px-6 pt-2">
              <p className="text-sm font-medium text-foreground mb-2">Photo Evidence</p>
              <div className="flex gap-2 flex-wrap">
                {resolveModal.incident.photo_urls.map((url, idx) => (
                  <a key={idx} href={url} target="_blank" rel="noopener noreferrer">
                    <img src={url} alt={`Incident photo ${idx + 1}`} className="w-20 h-20 object-cover rounded-lg border border-border bg-muted/50 hover:opacity-80 transition-opacity" />
                  </a>
                ))}
              </div>
            </div>
          )}
          <div className="p-6 pt-2">
            <p className="text-sm font-medium text-foreground mb-2">Actions Taken</p>
            <textarea
              value={actionsTaken}
              onChange={(e) => setActionsTaken(e.target.value)}
              placeholder="e.g., Sent mechanic, Dispatched tow truck, Verified safe to drive..."
              className="w-full min-h-[100px] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-y"
            />
            {!actionsTaken.trim() && (
              <p className="text-xs font-semibold text-danger mt-1.5">
                Documenting the actions taken is required — the reporting driver sees this.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setResolveModal({ open: false, incident: null })}
              disabled={resolveMutation.isPending}
            >
              Cancel
            </Button>
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
              className="gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              {resolveMutation.isPending ? "Resolving..." : "Mark as Resolved"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
