"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Edit3,
  ExternalLink,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Route as RouteIcon,
  Settings2,
  X,
  XCircle,
} from "lucide-react";
import { DataTable } from "@/components/tables/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { HeroHeader, heroButtonOutlineClass, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { StatsGridSkeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { getLocations } from "@/services/location.service";
import {
  createRoute,
  getRoutes,
  getRouteEstimate,
  recalculateRoute,
  updateRoute,
} from "@/services/route.service";
import { toast } from "@/components/ui/toast";
import { can, useRequireRole } from "@/lib/auth/role-guard";
import { useAuth } from "@/hooks/use-auth";
import { useFormValidation } from "@/lib/validation/useFormValidation";

const columnHelper = createColumnHelper();

const routeSchema = {
  route_name: { required: true, maxLength: 150, label: "Route name" },
  origin_location_id: { required: true, type: "id", label: "Origin location" },
  destination_location_id: { required: true, type: "id", label: "Destination location" },
  estimated_distance: { type: "positiveNumber", min: 0.01, label: "Distance" },
  estimated_duration: { type: "positiveNumber", min: 1, label: "Duration" },
};

const EMPTY_FORM = {
  route_name: "",
  origin_location_id: "",
  destination_location_id: "",
  estimated_distance: "",
  estimated_duration: "",
  estimate_source: "",
  status: "Active",
  also_create_return_route: false,
};

function routeFormFrom(route) {
  return {
    route_name: route.route_name || "",
    origin_location_id: route.origin_location_id ? String(route.origin_location_id) : "",
    destination_location_id: route.destination_location_id ? String(route.destination_location_id) : "",
    estimated_distance: route.estimated_distance ?? "",
    estimated_duration: route.estimated_duration ?? "",
    estimate_source: route.estimate_source || "",
    status: route.status || "Active",
  };
}

function formatDuration(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return "Insufficient data";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours}h ${remainder}m` : `${remainder}m`;
}

function formatEstimateTimestamp(value) {
  if (!value) return "Not calculated";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not calculated" : `Calculated ${date.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" })}`;
}

function coordinateLabel(location) {
  if (!location || location.latitude == null || location.longitude == null) return "Coordinates unavailable";
  const format = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    return number.toFixed(7).replace(/0+$/, "").replace(/\.$/, "");
  };
  return `Lat ${format(location.latitude)} · Lng ${format(location.longitude)}`;
}

function routeNameFor(origin, destination) {
  return origin && destination ? `${origin.name} → ${destination.name}`.slice(0, 150) : "";
}

export default function RoutesPage() {
  const { authorized } = useRequireRole();
  const { employee } = useAuth();
  const queryClient = useQueryClient();
  const canCreate = can(employee, "routes", "create");
  const canUpdate = can(employee, "routes", "update");
  const [statusFilter, setStatusFilter] = useState("all");
  const [qualityFilter, setQualityFilter] = useState("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState(null);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const { validate, fieldError, registerField, resetValidation } = useFormValidation(routeSchema);

  const routesQuery = useQuery({
    queryKey: ["routes", "all"],
    queryFn: () => getRoutes({ status: "all" }),
    enabled: authorized,
  });
  const locationsQuery = useQuery({
    queryKey: ["locations"],
    queryFn: getLocations,
    enabled: authorized,
  });

  const locations = useMemo(() => locationsQuery.data || [], [locationsQuery.data]);
  const selectedOrigin = useMemo(
    () => locations.find((location) => String(location.location_id) === String(formData.origin_location_id)),
    [locations, formData.origin_location_id]
  );
  const selectedDestination = useMemo(
    () => locations.find((location) => String(location.location_id) === String(formData.destination_location_id)),
    [locations, formData.destination_location_id]
  );
  const previewForCurrent = preview
    && Number(preview.originLocationId) === Number(selectedOrigin?.location_id)
    && Number(preview.destinationLocationId) === Number(selectedDestination?.location_id)
    ? preview
    : null;
  const previewNotice = selectedOrigin && selectedDestination
    && Number(selectedOrigin.location_id) === Number(selectedDestination.location_id)
    ? "Choose two different locations for a route preview."
    : selectedOrigin && selectedDestination
      && [selectedOrigin, selectedDestination].some((location) => location.latitude == null || location.longitude == null)
      ? "TomTom preview unavailable until both locations have coordinates."
      : previewError;
  const editingEndpointsChanged = Boolean(editingRoute && selectedOrigin && selectedDestination)
    && (Number(editingRoute.origin_location_id) !== Number(selectedOrigin.location_id)
      || Number(editingRoute.destination_location_id) !== Number(selectedDestination.location_id));
  const editingEstimateIncomplete = Boolean(editingRoute)
    && (editingRoute.estimated_distance == null || editingRoute.estimated_duration == null);

  const saveMutation = useMutation({
    mutationFn: async ({ id, payload, createReturn, reversePayload, reverseOrigin, reverseDestination }) => {
      if (id || !createReturn) return { route: await (id ? updateRoute(id, payload) : createRoute(payload)) };

      const route = await createRoute(payload);
      let returnRoute = null;
      let returnError = null;
      let returnEstimateUnavailable = false;
      try {
        let returnPayload = reversePayload;
        if (reverseOrigin && reverseDestination) {
          try {
            const estimate = await getRouteEstimate(reverseOrigin, reverseDestination);
            returnPayload = {
              ...returnPayload,
              estimated_distance: estimate.distanceKm,
              estimated_duration: estimate.travelTimeMin,
              estimate_source: "TomTom",
            };
          } catch {
            // Keep the canonical reverse route, but leave unavailable estimates blank.
            returnEstimateUnavailable = true;
          }
        } else returnEstimateUnavailable = true;
        returnRoute = await createRoute(returnPayload);
      } catch (error) {
        returnError = error;
      }
      return { route, returnRoute, returnError, returnEstimateUnavailable };
    },
    onSuccess: ({ route, returnRoute, returnError, returnEstimateUnavailable }) => {
      toast.success(editingRoute ? "Route updated" : returnRoute ? "Route and return route created" : "Route created");
      if (returnError) toast.error(`Return route was not created: ${returnError.message}`);
      else if (returnEstimateUnavailable) toast.warning("Return route created without a TomTom estimate; its estimate remains blank.");
      queryClient.invalidateQueries({ queryKey: ["routes"] });
      setSelectedRoute(route);
      setEditorOpen(false);
      setEditingRoute(null);
      setFormError(null);
    },
    onError: (error) => setFormError(error.message),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }) => updateRoute(id, { status }),
    onSuccess: (route) => {
      toast.success(route.status === "Active" ? "Route reactivated" : "Route deactivated");
      queryClient.invalidateQueries({ queryKey: ["routes"] });
      setSelectedRoute(route);
    },
    onError: (error) => toast.error(error.message),
  });

  const recalculateMutation = useMutation({
    mutationFn: (route) => recalculateRoute(route.route_id, route),
    onSuccess: (route) => {
      toast.success("TomTom estimate saved");
      queryClient.invalidateQueries({ queryKey: ["routes"] });
      setSelectedRoute(route);
    },
    onError: (error) => toast.error(error.message),
  });

  const routes = useMemo(() => routesQuery.data || [], [routesQuery.data]);
  const visibleRoutes = useMemo(() => routes.filter((route) => {
    if (statusFilter !== "all" && route.status !== statusFilter) return false;
    if (qualityFilter === "ready" && !route.is_navigation_ready) return false;
    if (qualityFilter === "setup" && route.is_navigation_ready) return false;
    if (qualityFilter === "used" && !route.used_last_30_days) return false;
    return true;
  }), [routes, statusFilter, qualityFilter]);

  const totalRoutes = routes.length;
  const activeCount = routes.filter((route) => route.status === "Active").length;
  const readyCount = routes.filter((route) => route.is_navigation_ready).length;
  const needsSetupCount = routes.filter((route) => !route.is_navigation_ready).length;
  const usedCount = routes.filter((route) => route.used_last_30_days).length;

  useEffect(() => {
    let cancelled = false;
    const sameLocation = selectedOrigin && selectedDestination
      && Number(selectedOrigin.location_id) === Number(selectedDestination.location_id);

    if (!editorOpen || !selectedOrigin || !selectedDestination) {
      return undefined;
    }
    if (sameLocation) {
      return undefined;
    }
    if ([selectedOrigin, selectedDestination].some((location) => location.latitude == null || location.longitude == null)) {
      return undefined;
    }

    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const result = await getRouteEstimate(selectedOrigin, selectedDestination);
        if (cancelled) return;
        setPreview({
          ...result,
          originLocationId: selectedOrigin.location_id,
          destinationLocationId: selectedDestination.location_id,
        });
        const shouldApplyAutomatically = !editingRoute
          || editingEndpointsChanged
          || editingEstimateIncomplete;
        if (shouldApplyAutomatically) {
          setFormData((previous) => {
            if (!editingRoute && !editingEndpointsChanged && (previous.estimated_distance !== "" || previous.estimated_duration !== "")) return previous;
            return {
              ...previous,
              estimated_distance: result.distanceKm ?? "",
              estimated_duration: result.travelTimeMin ?? "",
              estimate_source: "TomTom",
            };
          });
        }
      } catch (error) {
        if (!cancelled) setPreviewError(error.message);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [editorOpen, editingEndpointsChanged, editingEstimateIncomplete, editingRoute, selectedOrigin, selectedDestination]);

  function handleEndpointChange(field, value) {
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(false);
    setFormData((previous) => {
      const next = { ...previous, [field]: value };
      if (previous[field] !== value) {
        next.estimated_distance = "";
        next.estimated_duration = "";
        next.estimate_source = "";
      }
      if (!editingRoute && !previous.route_name) {
        const origin = field === "origin_location_id"
          ? locations.find((location) => String(location.location_id) === String(value))
          : locations.find((location) => String(location.location_id) === String(next.origin_location_id));
        const destination = field === "destination_location_id"
          ? locations.find((location) => String(location.location_id) === String(value))
          : locations.find((location) => String(location.location_id) === String(next.destination_location_id));
        const generatedName = routeNameFor(origin, destination);
        if (generatedName) next.route_name = generatedName;
      }
      return next;
    });
  }

  function applyPreview() {
    if (!previewForCurrent) return;
    setFormData((previous) => ({
      ...previous,
      estimated_distance: previewForCurrent.distanceKm ?? "",
      estimated_duration: previewForCurrent.travelTimeMin ?? "",
      estimate_source: "TomTom",
    }));
  }

  const statCards = useMemo(() => [
    {
      label: "Active Routes",
      value: activeCount,
      valueNote: totalRoutes > 0 ? `${Math.round((activeCount / totalRoutes) * 100)}% of total` : undefined,
      trend: "Available for dispatch scheduling & automated routing",
      icon: RouteIcon,
      tone: "success",
      active: statusFilter === "Active" && qualityFilter === "all",
      onClick: () => {
        if (statusFilter === "Active" && qualityFilter === "all") {
          setStatusFilter("all");
        } else {
          setStatusFilter("Active");
          setQualityFilter("all");
        }
      },
    },
    {
      label: "Navigation Ready",
      value: readyCount,
      valueNote: totalRoutes > 0 ? `${Math.round((readyCount / totalRoutes) * 100)}% mapped` : undefined,
      trend: "Verified GPS coordinates for route geometry and live ETA requests",
      icon: CheckCircle2,
      tone: "info",
      active: qualityFilter === "ready",
      onClick: () => {
        if (qualityFilter === "ready") {
          setQualityFilter("all");
        } else {
          setQualityFilter("ready");
          setStatusFilter("all");
        }
      },
    },
    {
      label: "Needs Setup",
      value: needsSetupCount,
      valueNote: needsSetupCount > 0 ? "Missing coordinates" : "All complete",
      trend: needsSetupCount > 0
        ? "Route line and live ETA disabled until coordinates are saved"
        : "All routes have complete endpoint geocoding",
      icon: Settings2,
      tone: needsSetupCount > 0 ? "warning" : "neutral",
      active: qualityFilter === "setup",
      onClick: () => {
        if (qualityFilter === "setup") {
          setQualityFilter("all");
        } else {
          setQualityFilter("setup");
          setStatusFilter("all");
        }
      },
    },
    {
      label: "Recent Activity",
      value: usedCount,
      valueNote: activeCount > 0 ? `${Math.round((usedCount / activeCount) * 100)}% active vol.` : undefined,
      trend: "Routes dispatched or completed within the last 30 days",
      icon: RefreshCw,
      tone: "primary",
      active: qualityFilter === "used",
      onClick: () => {
        if (qualityFilter === "used") {
          setQualityFilter("all");
        } else {
          setQualityFilter("used");
          setStatusFilter("all");
        }
      },
    },
  ], [activeCount, readyCount, needsSetupCount, usedCount, totalRoutes, statusFilter, qualityFilter]);

  function openNew() {
    setEditingRoute(null);
    setFormData({ ...EMPTY_FORM });
    setFormError(null);
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(false);
    resetValidation();
    setEditorOpen(true);
  }

  const openEdit = useCallback((route) => {
    setEditingRoute(route);
    setFormData(routeFormFrom(route));
    setFormError(null);
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(false);
    resetValidation();
    setDetailsOpen(false);
    setEditorOpen(true);
  }, [resetValidation]);

  function submitForm(event) {
    event.preventDefault();
    setFormError(null);
    const submissionData = {
      ...formData,
      route_name: formData.route_name.trim() || routeNameFor(selectedOrigin, selectedDestination),
    };
    validate(submissionData, {
      onSuccess: () => {
        const payload = {
          route_name: submissionData.route_name,
          origin_location_id: Number(submissionData.origin_location_id),
          destination_location_id: Number(submissionData.destination_location_id),
          status: submissionData.status,
          estimate_source: submissionData.estimate_source || null,
        };
        if (submissionData.estimated_distance !== "") payload.estimated_distance = Number(submissionData.estimated_distance);
        else if (editingRoute) payload.estimated_distance = null;
        if (submissionData.estimated_duration !== "") payload.estimated_duration = Number(submissionData.estimated_duration);
        else if (editingRoute) payload.estimated_duration = null;
        const reversePayload = {
          route_name: routeNameFor(selectedDestination, selectedOrigin),
          origin_location_id: Number(submissionData.destination_location_id),
          destination_location_id: Number(submissionData.origin_location_id),
          status: "Active",
          estimate_source: null,
        };
        saveMutation.mutate({
          id: editingRoute?.route_id,
          payload,
          createReturn: Boolean(submissionData.also_create_return_route),
          reversePayload,
          reverseOrigin: selectedDestination,
          reverseDestination: selectedOrigin,
        });
      },
    });
  }

  const columns = useMemo(() => [
    columnHelper.accessor("route_name", {
      header: "Direction",
      cell: (info) => (
        <div className="flex min-w-[220px] items-center gap-2">
          <RouteIcon className="h-4 w-4 shrink-0 text-primary" />
          <span className="font-semibold text-foreground truncate">{info.getValue()}</span>
        </div>
      ),
    }),
    columnHelper.accessor((row) => `${row.origin} ${row.destination}`, {
      id: "endpoints",
      header: "Origin → destination",
      cell: ({ row }) => (
        <div className="min-w-[230px] space-y-1">
          <div className="flex items-center gap-1.5 text-foreground-secondary"><MapPin className="h-3.5 w-3.5 text-danger" />{row.original.origin || "Unknown origin"}</div>
          <div className="flex items-center gap-1.5 text-foreground-secondary"><MapPin className="h-3.5 w-3.5 text-success" />{row.original.destination || "Unknown destination"}</div>
        </div>
      ),
    }),
    columnHelper.accessor("estimated_distance", {
      header: "Baseline estimate",
      cell: ({ row }) => (
        <div className="space-y-1 font-data text-xs">
          <div className="text-foreground">{row.original.estimated_distance != null ? `${row.original.estimated_distance} km` : "Insufficient data"}</div>
          <div className="text-foreground-secondary">{formatDuration(row.original.estimated_duration)}</div>
          <span className="text-[11px] text-foreground-muted">{row.original.estimate_source || "Source not recorded"}</span>
          <span className="block text-[10px] text-foreground-muted">{formatEstimateTimestamp(row.original.estimate_updated_at)}</span>
        </div>
      ),
    }),
    columnHelper.accessor("is_navigation_ready", {
      header: "Navigation",
      cell: ({ row }) => row.original.is_navigation_ready ? (
        <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3.5 w-3.5" />Ready</Badge>
      ) : (
        <Badge variant="warning" className="gap-1"><CircleAlert className="h-3.5 w-3.5" />Needs setup</Badge>
      ),
    }),
    columnHelper.accessor("dispatch_count", {
      header: "Usage",
      cell: ({ row }) => <span className="font-data text-foreground-secondary">{Number(row.original.dispatch_count || 0) + Number(row.original.trip_count || 0)} dispatch/trip records</span>,
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: ({ row }) => <StatusBadge status={row.original.status} entity="route" />,
    }),
    columnHelper.display({
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title="View route details" aria-label="View route details" onClick={() => { setSelectedRoute(row.original); setDetailsOpen(true); }}>
            <ExternalLink className="h-4 w-4" />
          </Button>
          {canUpdate && <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title="Edit route" aria-label="Edit route" onClick={() => openEdit(row.original)}><Edit3 className="h-4 w-4" /></Button>}
        </div>
      ),
    }),
  ], [canUpdate, openEdit]);

  if (routesQuery.isError) {
    return <div className="space-y-6"><HeroHeader icon={RouteIcon} title="Fleet Routes Registry" badge="Operations" description="Canonical directional routes used by dispatch and navigation." /><EmptyState icon={AlertTriangle} title="Could not load routes" description={routesQuery.error?.message || "The route register could not be read."} action={<Button onClick={() => routesQuery.refetch()}>Try again</Button>} /></div>;
  }

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={RouteIcon}
        title="Fleet Routes Registry"
        badge="Operations"
        description="Canonical directional routes used by dispatch and navigation. Unknown request legs remain ad-hoc until both endpoints are configured."
        actions={<>
          <Button variant="outline" className={cn("h-10", heroButtonOutlineClass)} asChild><Link href="/routes/locations"><MapPin className="mr-2 h-4 w-4" />Manage locations</Link></Button>
          {canCreate && <Button className={cn("h-10", heroButtonPrimaryClass)} onClick={openNew}><Plus className="mr-2 h-4 w-4" />Add route</Button>}
        </>}
      />

      {/* ── KPI Stat Cards ── */}
      {routesQuery.isLoading ? (
        <StatsGridSkeleton count={4} />
      ) : (
        <StatGrid cols={4}>
          {statCards.map((card) => (
            <StatCard key={card.label} {...card} />
          ))}
        </StatGrid>
      )}

      {/* ── Active Filter Bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Route status filters">
          {["all", "Active", "Inactive"].map((status) => {
            const isSelected = statusFilter === status && qualityFilter === "all";
            return (
              <Button
                key={status}
                type="button"
                variant={isSelected ? "default" : "outline"}
                size="sm"
                aria-pressed={isSelected}
                onClick={() => {
                  setStatusFilter(status);
                  setQualityFilter("all");
                }}
                className="rounded-xl h-8 text-xs font-semibold"
              >
                {status === "all" ? "All routes" : status}
              </Button>
            );
          })}
          {qualityFilter !== "all" && (
            <div className="inline-flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
              <span>Filter: {qualityFilter === "ready" ? "Navigation Ready" : qualityFilter === "setup" ? "Needs Setup" : "Recent Activity"}</span>
              <button
                type="button"
                onClick={() => setQualityFilter("all")}
                className="hover:text-foreground cursor-pointer ml-1 inline-flex items-center"
                aria-label="Clear quality filter"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs font-medium text-foreground-muted">
          <span>
            Showing <strong className="font-semibold text-foreground">{visibleRoutes.length}</strong> of{" "}
            <strong className="font-semibold text-foreground">{routes.length}</strong> routes
          </span>
          {(statusFilter !== "all" || qualityFilter !== "all") && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => {
                setStatusFilter("all");
                setQualityFilter("all");
              }}
              className="text-xs text-foreground-muted hover:text-foreground h-7 px-2 rounded-lg"
            >
              Reset filters
            </Button>
          )}
        </div>
      </div>

      <DataTable
            columns={columns}
            data={visibleRoutes}
            searchPlaceholder="Search route name or endpoint..."
            title="Directional route register"
            description="One active route per origin/destination pair; inactive records remain available for audit."
            icon={RouteIcon}
            emptyTitle="No routes match this view"
            emptyDescription="Adjust the status or quality filter, or add a route with two configured locations."
            emptyVariant="filtered"
            isLoading={routesQuery.isLoading}
            onRowClick={(route) => { setSelectedRoute(route); setDetailsOpen(true); }}
            getRowLabel={(route) => `View ${route.route_name}`}
            stickyFirstColumn
          />

      <Dialog open={editorOpen} onOpenChange={(open) => { setEditorOpen(open); if (!open) setEditingRoute(null); }}>
        <DialogContent className="max-w-xl w-[95vw] max-h-[calc(100dvh-2rem)] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle>{editingRoute ? "Edit route" : "Add route"}</DialogTitle>
          <DialogDescription>Choose existing canonical locations. A valid pair gets a TomTom baseline automatically; create or verify endpoints in Location Management first.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitForm} className="min-h-0 overflow-y-auto space-y-4 p-6 pt-5">
            <div className="space-y-1.5"><Label htmlFor="route_name">Route name</Label><Input id="route_name" value={formData.route_name} onChange={(event) => setFormData((previous) => ({ ...previous, route_name: event.target.value }))} ref={registerField("route_name")} invalid={fieldError("route_name").invalid} placeholder="Hotel → NAIA Terminal 1 - Arrivals" maxLength={150} />{fieldError("route_name").error && <p className="text-xs text-danger">{fieldError("route_name").error}</p>}</div>
            <div className="grid gap-4 sm:grid-cols-2">
              {[{ field: "origin_location_id", label: "Origin location", placeholder: "Select origin" }, { field: "destination_location_id", label: "Destination location", placeholder: "Select destination" }].map((item) => {
                const endpointLocked = Boolean(editingRoute && (Number(editingRoute.dispatch_count) > 0 || Number(editingRoute.trip_count) > 0));
                return (
                  <div key={item.field} className="space-y-1.5">
                    <Label htmlFor={item.field}>{item.label}</Label>
                    <Select value={formData[item.field] || undefined} onValueChange={(value) => handleEndpointChange(item.field, value)} disabled={endpointLocked}>
                      <SelectTrigger id={item.field} aria-label={item.label}><SelectValue className="min-w-0 truncate" placeholder={item.placeholder} /></SelectTrigger>
                      <SelectContent className="w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-2rem)]">
                        {locations.map((location) => <SelectItem key={location.location_id} value={String(location.location_id)}>{location.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {fieldError(item.field).error && <p className="text-xs text-danger">{fieldError(item.field).error}</p>}
                  </div>
                );
              })}
            </div>
            {editingRoute && (Number(editingRoute.dispatch_count) > 0 || Number(editingRoute.trip_count) > 0) && <p className="rounded-xl bg-warning-bg p-3 text-xs text-warning-700">Endpoint edits are locked because this route has dispatch/trip history. Create a new route for a changed leg.</p>}
            {(selectedOrigin || selectedDestination) && <div className="rounded-xl border border-border/70 bg-muted/20 p-3" aria-live="polite">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-foreground-muted">TomTom route preview</p>
                  <p className="mt-1 text-xs text-foreground-secondary">{selectedOrigin?.name || "Origin"} → {selectedDestination?.name || "Destination"}</p>
                  {editingRoute && <p className="mt-1 text-[11px] text-foreground-muted">Endpoint changes and missing estimates are applied automatically; use this preview to refresh the baseline when needed.</p>}
                </div>
                {previewLoading && <Loader2 className="h-4 w-4 animate-spin text-primary" aria-label="Loading route estimate" />}
              </div>
              {previewForCurrent && <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <span><strong className="font-data">{previewForCurrent.distanceKm} km</strong> distance</span>
                <span><strong className="font-data">{previewForCurrent.travelTimeMin} min</strong> travel time</span>
                <Button type="button" variant="outline" size="sm" className="ml-auto h-8" onClick={applyPreview}>Use estimate</Button>
              </div>}
              {!previewLoading && !previewForCurrent && previewNotice && <p className="mt-2 text-xs text-warning-700">{previewNotice}</p>}
            </div>}
            {!editingRoute && canCreate && <div className="space-y-1">
              <label className="flex items-center gap-2 text-sm text-foreground-secondary">
                <input type="checkbox" className="h-4 w-4 rounded border-border accent-primary" checked={Boolean(formData.also_create_return_route)} onChange={(event) => setFormData((previous) => ({ ...previous, also_create_return_route: event.target.checked }))} />
                Also create the reverse route
              </label>
              {formData.also_create_return_route && <p className="ml-6 text-xs text-foreground-muted">The reverse direction is saved separately and receives its own TomTom estimate.</p>}
            </div>}
            <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="estimated_distance">Estimated distance (km)</Label><Input id="estimated_distance" type="number" min="0.01" step="0.01" value={formData.estimated_distance} onChange={(event) => setFormData((previous) => ({ ...previous, estimated_distance: event.target.value }))} placeholder="Optional" /></div><div className="space-y-1.5"><Label htmlFor="estimated_duration">Estimated travel time (minutes)</Label><Input id="estimated_duration" type="number" min="1" step="1" value={formData.estimated_duration} onChange={(event) => setFormData((previous) => ({ ...previous, estimated_duration: event.target.value }))} placeholder="Optional" /></div></div>
            <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="estimate_source">Estimate source</Label><Select value={formData.estimate_source || "none"} onValueChange={(value) => setFormData((previous) => ({ ...previous, estimate_source: value === "none" ? "" : value }))}><SelectTrigger id="estimate_source"><SelectValue placeholder="Source" /></SelectTrigger><SelectContent><SelectItem value="none">Not recorded</SelectItem><SelectItem value="Manual">Manual</SelectItem><SelectItem value="TomTom">TomTom</SelectItem><SelectItem value="Legacy / Unknown">Legacy / Unknown</SelectItem></SelectContent></Select></div>{editingRoute && <div className="space-y-1.5"><Label htmlFor="route_status">Status</Label><Select value={formData.status} onValueChange={(value) => setFormData((previous) => ({ ...previous, status: value }))}><SelectTrigger id="route_status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Active">Active</SelectItem><SelectItem value="Inactive">Inactive</SelectItem></SelectContent></Select></div>}</div>
            {formError && <p role="alert" className="text-sm font-semibold text-danger">{formError}</p>}
            <DialogFooter className="-mx-6 -mb-6 border-t border-border/60"><Button type="button" variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button><Button type="submit" disabled={saveMutation.isPending}>{saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{editingRoute ? "Save changes" : "Create route"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-lg w-[95vw]">
          {selectedRoute && <>
            <DialogHeader><div className="flex items-start justify-between gap-3"><div><DialogTitle>{selectedRoute.route_name}</DialogTitle><DialogDescription>Directional route record and navigation readiness.</DialogDescription></div><StatusBadge status={selectedRoute.status} entity="route" /></div></DialogHeader>
            <div className="space-y-4 p-6 pt-5">
              <div className="grid gap-3 rounded-2xl border border-border/70 bg-muted/20 p-4 sm:grid-cols-2"><div><p className="text-xs font-bold uppercase tracking-wide text-foreground-muted">Origin</p><p className="mt-1 text-sm font-semibold text-foreground">{selectedRoute.origin}</p><p className="font-data text-xs text-foreground-muted">{coordinateLabel(selectedRoute.origin_location)}</p><p className="mt-1 text-xs text-foreground-secondary">{selectedRoute.origin_location?.address || "Address not recorded"}</p><p className="mt-1 text-[11px] font-data text-foreground-muted">Canonical location #{selectedRoute.origin_location?.location_id ?? "—"}</p></div><div><p className="text-xs font-bold uppercase tracking-wide text-foreground-muted">Destination</p><p className="mt-1 text-sm font-semibold text-foreground">{selectedRoute.destination}</p><p className="font-data text-xs text-foreground-muted">{coordinateLabel(selectedRoute.destination_location)}</p><p className="mt-1 text-xs text-foreground-secondary">{selectedRoute.destination_location?.address || "Address not recorded"}</p><p className="mt-1 text-[11px] font-data text-foreground-muted">Canonical location #{selectedRoute.destination_location?.location_id ?? "—"}</p></div></div>
              <div className="grid grid-cols-2 gap-3"><div className="rounded-xl border border-border/70 p-3"><p className="text-xs text-foreground-muted">Baseline estimate</p><p className="mt-1 font-data text-sm font-semibold">{selectedRoute.estimated_distance != null ? `${selectedRoute.estimated_distance} km` : "Insufficient data"}</p><p className="font-data text-xs text-foreground-secondary">{selectedRoute.estimated_duration != null ? `${formatDuration(selectedRoute.estimated_duration)} travel time` : "Travel time unavailable"}</p></div><div className="rounded-xl border border-border/70 p-3"><p className="text-xs text-foreground-muted">Source</p><p className="mt-1 text-sm font-semibold text-foreground">{selectedRoute.estimate_source || "Source not recorded"}</p><p className="mt-1 text-[11px] text-foreground-muted">{formatEstimateTimestamp(selectedRoute.estimate_updated_at)}</p><p className="text-xs text-foreground-secondary">{Number(selectedRoute.dispatch_count || 0) + Number(selectedRoute.trip_count || 0)} historical records</p></div></div>
              <div className={cn("flex items-start gap-2 rounded-xl p-3 text-sm", selectedRoute.is_navigation_ready ? "bg-success-bg text-success-700" : "bg-warning-bg text-warning-700")}><span>{selectedRoute.is_navigation_ready ? <CheckCircle2 className="mt-0.5 h-4 w-4" /> : <XCircle className="mt-0.5 h-4 w-4" />}</span><span>{selectedRoute.is_navigation_ready ? "Both endpoint coordinates are available for navigation." : "Route coordinates unavailable; route line and live ETA will be omitted."}</span></div>
              <div className="flex flex-wrap justify-end gap-2">{canUpdate && <><Button type="button" variant="outline" onClick={() => openEdit(selectedRoute)}><Edit3 className="mr-2 h-4 w-4" />Edit</Button>{selectedRoute.is_navigation_ready && <Button type="button" variant="outline" disabled={recalculateMutation.isPending} onClick={() => recalculateMutation.mutate(selectedRoute)}><RefreshCw className={cn("mr-2 h-4 w-4", recalculateMutation.isPending && "animate-spin")} />Recalculate from TomTom</Button>}<Button type="button" variant={selectedRoute.status === "Active" ? "outline" : "default"} disabled={statusMutation.isPending} onClick={() => statusMutation.mutate({ id: selectedRoute.route_id, status: selectedRoute.status === "Active" ? "Inactive" : "Active" })}>{selectedRoute.status === "Active" ? "Deactivate" : "Reactivate"}</Button></>}</div>
            </div>
          </>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
