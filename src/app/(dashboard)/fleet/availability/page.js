"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { HeroHeader, heroButtonOutlineClass } from "@/components/ui/hero-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/tables/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tooltip } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { 
  CarFront, CheckCircle2, Navigation, Wrench, AlertTriangle, RefreshCw, Eye, Calendar, Hash, MapPin
} from "lucide-react";

const TABS = [
  { id: "Available", label: "Available", icon: CheckCircle2 },
  { id: "On Trip", label: "On Trip", icon: Navigation },
  { id: "Maintenance", label: "Maintenance", icon: Wrench },
  { id: "Out of Service", label: "Out of Service", icon: AlertTriangle },
];

export default function FleetAvailabilityBoard() {
  const [tab, setTab] = useState("Available");
  const [search, setSearch] = useState("");
  const [selectedVehicle, setSelectedVehicle] = useState(null);

  const { data: vehicles, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => apiFetch("/api/vehicles"),
  });

  const processedVehicles = useMemo(() => {
    if (!vehicles) return [];
    return vehicles.map(vehicle => {
      return { ...vehicle, computedStatus: vehicle.vehicle_status || "Unknown" };
    });
  }, [vehicles]);

  const counts = useMemo(() => {
    const acc = {};
    for (const t of TABS) acc[t.id] = 0;
    for (const v of processedVehicles) {
      if (acc[v.computedStatus] !== undefined) {
        acc[v.computedStatus]++;
      }
    }
    return acc;
  }, [processedVehicles]);

  const filteredVehicles = useMemo(() => {
    let list = processedVehicles.filter(v => v.computedStatus === tab);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(v => 
        v.plate_number?.toLowerCase().includes(q) || 
        v.vehicle_name?.toLowerCase().includes(q) ||
        v.model?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [processedVehicles, tab, search]);

  const columns = [
    {
      key: "vehicle_id",
      label: "Vehicle ID",
      sortable: true,
      render: (val) => (
        <span className="inline-flex items-center rounded-xl border border-border/80 bg-surface px-3 py-1.5 font-data text-xs font-bold tracking-wide text-foreground shadow-2xs">
          #{val}
        </span>
      ),
    },
    {
      key: "vehicle_name",
      label: "Vehicle",
      sortable: true,
      render: (_, row) => {
        const initials = row.vehicle_name ? row.vehicle_name.substring(0, 2).toUpperCase() : "VH";
        return (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted/60 font-black text-xs text-foreground border border-border/40 shadow-2xs">
              {initials}
            </div>
            <div>
              <p className="font-bold text-sm text-foreground">{row.vehicle_name}</p>
              <p className="text-xs text-foreground-muted font-medium">{row.vehiclecategories?.category_name || "Uncategorized"}</p>
            </div>
          </div>
        );
      },
    },
    {
      key: "plate_number",
      label: "Plate Number",
      render: (_, row) => (
        <div className="font-data font-bold text-sm text-foreground">
          {row.plate_number || "—"}
        </div>
      ),
    },
    {
      key: "model_info",
      label: "Make / Model",
      render: (_, row) => (
        <div className="space-y-1 text-xs">
          <div className="font-bold text-foreground">{row.manufacturer || "—"} {row.model || ""}</div>
          <div className="text-foreground-secondary font-medium">
            Year {row.year || "—"} • {row.color || "—"}
          </div>
        </div>
      ),
    },
    {
      key: "capacity",
      label: "Capacity",
      render: (_, row) => (
        <div className="text-sm font-bold text-foreground">
          {row.seating_capacity ? `${row.seating_capacity} pax` : "—"}
        </div>
      ),
    },
    {
      key: "computedStatus",
      label: "Status",
      sortable: true,
      render: (val) => <StatusBadge status={val || "Available"} entity="vehicle" className="rounded-full px-3 py-1 text-xs font-bold" />,
    },
    {
      key: "actions",
      label: "",
      render: (_, row) => (
        <div className="inline-flex items-center gap-0.5 rounded-full border border-border/80 bg-surface p-1 shadow-2xs" onClick={(e) => e.stopPropagation()}>
          <Tooltip content="View">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full text-foreground-secondary hover:bg-hover hover:text-foreground cursor-pointer"
              onClick={() => setSelectedVehicle(row)}
            >
              <Eye className="w-3.5 h-3.5" />
            </Button>
          </Tooltip>
        </div>
      ),
    },
  ];

  const fmtDate = (val) => {
    if (!val) return "—";
    const d = new Date(val);
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
  };

  const fmtNum = (val) => {
    if (!val && val !== 0) return "—";
    return new Intl.NumberFormat("en-US").format(val);
  };

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={CarFront}
        title="Fleet Availability"
        badge="Operations"
        description="Live view of vehicle readiness, assignments, and maintenance status."
        actions={
          <Button
            variant="outline"
            size="icon"
            disabled={isFetching}
            onClick={() => refetch()}
            className={cn(heroButtonOutlineClass)}
            aria-label="Refresh the board"
          >
            <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} />
          </Button>
        }
      />

      <div className="flex flex-col gap-3 rounded-3xl border border-border/80 bg-surface p-3.5 sm:flex-row sm:items-center sm:justify-between shadow-xs">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Vehicle statuses">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => { setTab(t.id); setSearch(""); }}
                className={cn(
                  "inline-flex items-center gap-2 px-4 h-8 rounded-full text-xs font-bold border transition-all cursor-pointer",
                  active
                    ? "bg-primary text-white dark:text-slate-950 border-primary shadow-xs"
                    : "bg-surface border-border/60 text-foreground-secondary hover:border-primary/40 hover:text-foreground"
                )}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                {t.label}
                <span className="font-data text-[11px] opacity-80">({counts[t.id] || 0})</span>
              </button>
            );
          })}
        </div>

        <div className="relative flex-1 sm:max-w-xs">
          <input
            className="w-full h-9 px-3 rounded-xl bg-surface border border-border/80 text-xs font-medium text-foreground placeholder:text-foreground-muted focus:outline-none focus:border-primary/60 transition-colors"
            placeholder="Search plate or model..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search vehicles"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="h-48 bg-muted/20 animate-pulse rounded-3xl border border-border/40" />
      ) : (
        <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
          <CardContent className="p-0">
            <DataTable
              columns={columns}
              data={filteredVehicles}
              pageSize={10}
              title={`Fleet - ${tab}`}
              description={`Currently viewing ${tab.toLowerCase()} vehicles.`}
              icon={CarFront}
              context={tab}
              searchPlaceholder="Search plate or model..."
              searchTerm={search}
              onSearchChange={setSearch}
              onRowClick={(row) => setSelectedVehicle(row)}
            />
          </CardContent>
        </Card>
      )}

      <Dialog open={!!selectedVehicle} onOpenChange={(open) => !open && setSelectedVehicle(null)}>
        <DialogContent className="sm:max-w-md rounded-3xl overflow-hidden border-border/60 shadow-lg p-0">
          {selectedVehicle && (
            <>
              <div className="bg-muted/30 p-6 border-b border-border/40">
                <DialogHeader>
                  <DialogTitle className="text-xl font-bold flex items-center gap-2">
                    <CarFront className="w-5 h-5 text-primary" /> Vehicle Information
                  </DialogTitle>
                </DialogHeader>
                <div className="mt-4 flex items-center gap-4">
                  <div className="h-16 w-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center text-xl font-bold">
                    {selectedVehicle.vehicle_name?.substring(0, 2).toUpperCase() || "VH"}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-foreground">
                      {selectedVehicle.vehicle_name || "Unknown Vehicle"}
                    </h3>
                    <p className="text-sm font-medium text-foreground-secondary flex items-center gap-1.5 mt-1">
                      <StatusBadge status={selectedVehicle.computedStatus} entity="vehicle" className="px-2 py-0.5 rounded-full text-[10px] font-bold" />
                    </p>
                  </div>
                </div>
              </div>
              <div className="p-6 space-y-4 bg-surface">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5 col-span-2">
                    <span className="text-xs font-semibold text-foreground-muted uppercase tracking-wider flex items-center gap-1.5">
                      <Hash className="w-3.5 h-3.5" /> Registration Details
                    </span>
                    <div className="bg-muted/20 p-3 rounded-xl border border-border/40 grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-xs text-foreground-secondary mb-0.5">Plate Number</p>
                        <p className="font-data font-bold text-sm">{selectedVehicle.plate_number || "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-foreground-secondary mb-0.5">Reg. Expiry</p>
                        <p className="font-bold text-sm">{fmtDate(selectedVehicle.registration_expiry)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-foreground-secondary mb-0.5">Insurance Expiry</p>
                        <p className="font-bold text-sm">{fmtDate(selectedVehicle.insurance_expiry)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-foreground-secondary mb-0.5">Category</p>
                        <p className="font-medium text-sm">{selectedVehicle.vehiclecategories?.category_name || "—"}</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-1.5 col-span-2">
                    <span className="text-xs font-semibold text-foreground-muted uppercase tracking-wider flex items-center gap-1.5">
                      <Wrench className="w-3.5 h-3.5" /> Maintenance & Specs
                    </span>
                    <div className="bg-muted/20 p-3 rounded-xl border border-border/40 grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-xs text-foreground-secondary mb-0.5">Make / Model</p>
                        <p className="font-bold text-sm">{selectedVehicle.manufacturer || "—"} {selectedVehicle.model || ""}</p>
                      </div>
                      <div>
                        <p className="text-xs text-foreground-secondary mb-0.5">Capacity</p>
                        <p className="font-bold text-sm">{selectedVehicle.seating_capacity ? `${selectedVehicle.seating_capacity} pax` : "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-foreground-secondary mb-0.5">Next Service Date</p>
                        <p className="font-bold text-sm">{fmtDate(selectedVehicle.next_service_date)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-foreground-secondary mb-0.5">Next Service Odo.</p>
                        <p className="font-data text-sm font-medium">{fmtNum(selectedVehicle.next_service_mileage)} km</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-4 bg-muted/10 border-t border-border/40 flex justify-end">
                <Button variant="outline" className="rounded-xl shadow-xs h-9 px-4 text-xs font-semibold" onClick={() => setSelectedVehicle(null)}>Close</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
