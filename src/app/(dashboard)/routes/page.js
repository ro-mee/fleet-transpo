"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { DataTable } from "@/components/tables/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { HeroHeader, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Route as RouteIcon, MapPin, TriangleAlert, Plus } from "lucide-react";
import { createRoute, getRoutes } from "@/services/route.service";
import { toast } from "@/components/ui/toast";
import { useRequireRole, can } from "@/lib/auth/role-guard";
import { useAuth } from "@/hooks/use-auth";
import { useFormValidation } from "@/lib/validation/useFormValidation";

const columnHelper = createColumnHelper();

const routeSchema = {
  route_name: { required: true, maxLength: 150, label: "Route name" },
  origin: { required: true, maxLength: 255, label: "Origin" },
  destination: { required: true, maxLength: 255, label: "Destination" },
  distance_km: { type: "positiveNumber", label: "Distance (km)" },
  estimated_duration_minutes: { type: "positiveNumber", label: "Estimated duration (minutes)" },
};

const EMPTY_FORM = { route_name: "", origin: "", destination: "", distance_km: "", estimated_duration_minutes: "" };

export default function RoutesPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher"]);
  const [statusFilter, setStatusFilter] = useState("all");
  const queryClient = useQueryClient();
  const { employee } = useAuth();
  const canCreate = can(employee, "routes", "create");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState(null);
  const { validate, fieldError, registerField, resetValidation } = useFormValidation(routeSchema);

  const createMutation = useMutation({
    mutationFn: createRoute,
    onSuccess: () => {
      toast.success("Route created successfully");
      queryClient.invalidateQueries({ queryKey: ["routes"] });
      closeDialog();
    },
    onError: (err) => setFormError(err.message),
  });

  function openNewDialog() {
    setFormData(EMPTY_FORM);
    setFormError(null);
    resetValidation();
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setFormError(null);
  }

  function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);
    validate(formData, {
      onSuccess: () => {
        const payload = {
          route_name: formData.route_name.trim(),
          origin: formData.origin.trim(),
          destination: formData.destination.trim(),
        };
        if (formData.distance_km) payload.distance_km = Number(formData.distance_km);
        if (formData.estimated_duration_minutes) payload.estimated_duration_minutes = Number(formData.estimated_duration_minutes);
        createMutation.mutate(payload);
      },
    });
  }

  const {
    data: routes = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["routes"],
    queryFn: () => getRoutes(),
  });

  const displayRoutes = useMemo(() => {
    if (statusFilter === "Active") return routes.filter((r) => r.status === "Active");
    if (statusFilter === "Inactive") return routes.filter((r) => r.status === "Inactive");
    return routes;
  }, [routes, statusFilter]);

  const totalDistance = useMemo(
    () => routes.reduce((sum, r) => sum + (Number(r.estimated_distance) || 0), 0),
    [routes]
  );
  const activeCount = routes.filter((r) => r.status === "Active").length;

  const columns = useMemo(
    () => [
      columnHelper.accessor("route_name", {
        header: "Route",
        cell: (info) => (
          <div className="flex items-center gap-2">
            <RouteIcon className="w-4 h-4 text-primary" />
            <span className="font-medium text-foreground">{info.getValue()}</span>
          </div>
        ),
      }),
      columnHelper.accessor("origin", {
        header: "Origin",
        cell: (info) => (
          <div className="flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-danger" />
            <span className="text-foreground-secondary">{info.getValue()}</span>
          </div>
        ),
      }),
      columnHelper.accessor("destination", {
        header: "Destination",
        cell: (info) => (
          <div className="flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-success" />
            <span className="text-foreground-secondary">{info.getValue()}</span>
          </div>
        ),
      }),
      columnHelper.accessor("estimated_distance", {
        header: "Distance",
        cell: (info) => (
          <span className="font-medium text-foreground">{info.getValue() || "—"} km</span>
        ),
      }),
      columnHelper.accessor("estimated_duration", {
        header: "Duration",
        cell: (info) => {
          const mins = info.getValue();
          if (!mins) return <span className="text-foreground-secondary">—</span>;
          const h = Math.floor(mins / 60);
          const m = mins % 60;
          return <span className="text-foreground-secondary">{h}h {m}m</span>;
        },
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: (info) => <StatusBadge status={info.getValue()} entity="route" />,
      }),
    ],
    []
  );

  if (isError) {
    return (
      <div className="space-y-6">
        <HeroHeader
          icon={RouteIcon}
          title="Fleet Routes Registry"
          badge="Operations"
          description="Predefined origin-destination routes used when dispatching vehicles."
        />
        <EmptyState
          icon={TriangleAlert}
          title="Could not load routes"
          description={error?.message || "Something went wrong reading the routes register."}
          action={<Button onClick={() => refetch()}>Try again</Button>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={RouteIcon}
        title="Fleet Routes Registry"
        badge="Operations"
        description="Predefined origin-destination routes used when dispatching vehicles."
        actions={
          canCreate ? (
            <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); setDialogOpen(open); }}>
              <DialogTrigger asChild>
                <Button className={cn("h-10", heroButtonPrimaryClass)} onClick={openNewDialog}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Route
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Add Route</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="p-6 pt-4 space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="route_name">Route Name *</Label>
                    <Input
                      id="route_name"
                      value={formData.route_name}
                      onChange={(e) => setFormData({ ...formData, route_name: e.target.value })}
                      ref={registerField("route_name")}
                      invalid={fieldError("route_name").invalid}
                      placeholder="e.g. NAIA Terminal 3 → Hotel"
                    />
                    {fieldError("route_name").error && <p className="text-xs text-danger">{fieldError("route_name").error}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="origin">Origin *</Label>
                    <Input
                      id="origin"
                      value={formData.origin}
                      onChange={(e) => setFormData({ ...formData, origin: e.target.value })}
                      ref={registerField("origin")}
                      invalid={fieldError("origin").invalid}
                      placeholder="e.g. NAIA Terminal 3"
                    />
                    {fieldError("origin").error && <p className="text-xs text-danger">{fieldError("origin").error}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="destination">Destination *</Label>
                    <Input
                      id="destination"
                      value={formData.destination}
                      onChange={(e) => setFormData({ ...formData, destination: e.target.value })}
                      ref={registerField("destination")}
                      invalid={fieldError("destination").invalid}
                      placeholder="e.g. Manila Hotel"
                    />
                    {fieldError("destination").error && <p className="text-xs text-danger">{fieldError("destination").error}</p>}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="distance_km">Distance (km)</Label>
                      <Input
                        id="distance_km"
                        type="number"
                        min="0"
                        step="0.1"
                        value={formData.distance_km}
                        onChange={(e) => setFormData({ ...formData, distance_km: e.target.value })}
                        ref={registerField("distance_km")}
                        invalid={fieldError("distance_km").invalid}
                        placeholder="e.g. 12.5"
                      />
                      {fieldError("distance_km").error && <p className="text-xs text-danger">{fieldError("distance_km").error}</p>}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="estimated_duration_minutes">Duration (min)</Label>
                      <Input
                        id="estimated_duration_minutes"
                        type="number"
                        min="0"
                        value={formData.estimated_duration_minutes}
                        onChange={(e) => setFormData({ ...formData, estimated_duration_minutes: e.target.value })}
                        ref={registerField("estimated_duration_minutes")}
                        invalid={fieldError("estimated_duration_minutes").invalid}
                        placeholder="e.g. 35"
                      />
                      {fieldError("estimated_duration_minutes").error && <p className="text-xs text-danger">{fieldError("estimated_duration_minutes").error}</p>}
                    </div>
                  </div>

                  {formError && <p className="text-sm text-danger">{formError}</p>}

                  <div className="flex items-center justify-end gap-3 pt-2">
                    <Button type="button" variant="outline" onClick={closeDialog}>Cancel</Button>
                    <Button type="submit" disabled={createMutation.isPending}>
                      {createMutation.isPending ? "Creating..." : "Create Route"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          ) : null
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <button
          type="button"
          onClick={() => setStatusFilter('all')}
          className={cn(
            "p-4 rounded-3xl border transition-all text-left flex flex-col justify-between space-y-3 cursor-pointer select-none",
            statusFilter === "all" ? "border-primary bg-primary/10 shadow-xs" : "border-border/80 bg-surface hover:border-primary/40"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider">Total Routes</span>
            <div className="p-2 rounded-xl bg-primary/10 text-primary"><RouteIcon className="w-4 h-4" /></div>
          </div>
          <div>
            <div className="text-3xl font-black text-foreground font-data">{routes.length}</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('Active')}
          className={cn(
            "p-4 rounded-3xl border transition-all text-left flex flex-col justify-between space-y-3 cursor-pointer select-none",
            statusFilter === "Active" ? "border-success bg-success/10 shadow-xs" : "border-border/80 bg-surface hover:border-success/40"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider">Active Routes</span>
            <div className="p-2 rounded-xl bg-success/10 text-success"><MapPin className="w-4 h-4" /></div>
          </div>
          <div>
            <div className="text-3xl font-black text-foreground font-data">{activeCount}</div>
          </div>
        </button>

        <div
          className={cn(
            "p-4 rounded-3xl border transition-all text-left flex flex-col justify-between space-y-3 select-none border-border/80 bg-surface"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider">Total Distance</span>
            <div className="p-2 rounded-xl bg-info/10 text-info"><RouteIcon className="w-4 h-4" /></div>
          </div>
          <div>
            <div className="text-3xl font-black text-foreground font-data">{`${totalDistance.toLocaleString()} km`}</div>
          </div>
        </div>
      </div>

      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={displayRoutes}
            searchPlaceholder="Search routes..."
            emptyTitle="No routes found"
            emptyDescription="Routes created here can be attached to dispatches."
            isLoading={isLoading}
          />
        </CardContent>
      </Card>
    </div>
  );
}
