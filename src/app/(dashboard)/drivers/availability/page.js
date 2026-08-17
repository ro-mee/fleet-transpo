"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { HeroHeader, heroButtonOutlineClass } from "@/components/ui/hero-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/tables/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { 
  Users, CheckCircle2, Navigation, CalendarOff, Coffee, 
  AlertTriangle, RefreshCw, Mail, Phone, Eye, User, IdCard, CheckCircle, XCircle
} from "lucide-react";

const TABS = [
  { id: "Available", label: "Available", icon: CheckCircle2 },
  { id: "On Trip", label: "On Trip", icon: Navigation },
  { id: "On Leave", label: "On Leave", icon: CalendarOff },
  { id: "Off Duty", label: "Off Duty", icon: Coffee },
  { id: "Suspended", label: "Suspended", icon: AlertTriangle },
];

export default function DriverAvailabilityBoard() {
  const [tab, setTab] = useState("Available");
  const [search, setSearch] = useState("");
  const [selectedDriver, setSelectedDriver] = useState(null);

  const { data: drivers, isLoading: loadingDrivers, refetch, isFetching } = useQuery({
    queryKey: ["drivers"],
    queryFn: () => apiFetch("/api/drivers"),
  });

  const { data: leaveRequests, isLoading: loadingLeaves } = useQuery({
    queryKey: ["driver-leave-requests"],
    queryFn: () => apiFetch("/api/driver-leave-requests"),
  });

  const isLoading = loadingDrivers || loadingLeaves;

  const processedDrivers = useMemo(() => {
    if (!drivers) return [];
    return drivers.map(driver => {
      let status = driver.driver_status || "Unknown";
      let activeLeave = null;
      
      if (leaveRequests) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        activeLeave = leaveRequests.find((req) => {
          if (req.driver_id !== driver.driver_id || req.status !== "Approved") return false;
          const start = new Date(req.start_date);
          start.setHours(0, 0, 0, 0);
          const end = new Date(req.end_date);
          end.setHours(23, 59, 59, 999);
          return today >= start && today <= end;
        });

        if (activeLeave) status = "On Leave";
      }
      return { ...driver, computedStatus: status, activeLeave };
    });
  }, [drivers, leaveRequests]);

  const counts = useMemo(() => {
    const acc = {};
    for (const t of TABS) acc[t.id] = 0;
    for (const d of processedDrivers) {
      if (acc[d.computedStatus] !== undefined) {
        acc[d.computedStatus]++;
      }
    }
    return acc;
  }, [processedDrivers]);

  const filteredDrivers = useMemo(() => {
    let list = processedDrivers.filter(d => d.computedStatus === tab);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(d => 
        d.license_number?.toLowerCase().includes(q) || 
        d.employees?.first_name?.toLowerCase().includes(q) ||
        d.employees?.last_name?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [processedDrivers, tab, search]);

  const columns = [
    {
      key: "driver_id",
      label: "Driver ID",
      sortable: true,
      render: (val) => (
        <span className="inline-flex items-center rounded-xl border border-border/80 bg-surface px-3 py-1.5 font-data text-xs font-bold tracking-wide text-foreground shadow-2xs">
          #{val}
        </span>
      ),
    },
    {
      key: "name",
      label: "Driver Name",
      sortable: true,
      render: (_, row) => {
        const emp = row.employees;
        const name = emp ? `${emp.first_name} ${emp.last_name}` : "Unassigned driver";
        const initials = name ? name.split(" ").map((part) => part[0]).join("").slice(0, 2) : "DR";
        return (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted/60 font-black text-xs text-foreground border border-border/40 shadow-2xs">
              {initials}
            </div>
            <div>
              <p className="font-bold text-sm text-foreground">{name}</p>
              <p className="text-xs text-foreground-muted font-medium">Driver profile</p>
            </div>
          </div>
        );
      },
    },
    {
      key: "email",
      label: "Email / Phone",
      render: (_, row) => (
        <div className="space-y-1 text-xs">
          <div className="flex items-center gap-1.5 font-medium text-foreground">
            <Mail className="h-3.5 w-3.5 text-foreground-muted" />
            {row.employees?.email || "—"}
          </div>
          <div className="flex items-center gap-1.5 text-foreground-secondary">
            <Phone className="h-3.5 w-3.5 text-foreground-muted" />
            {row.employees?.phone || "—"}
          </div>
        </div>
      ),
    },
    {
      key: "license",
      label: "License Info",
      render: (_, row) => (
        <div className="space-y-1 text-xs">
          <div className="font-data font-bold text-foreground">{row.license_number || "—"}</div>
          <div className="text-foreground-secondary font-medium">
            Class {row.license_class || "—"} • {row.years_of_experience || 0} yrs exp
          </div>
        </div>
      ),
    },
    {
      key: "computedStatus",
      label: "Status",
      sortable: true,
      render: (val) => <StatusBadge status={val || "Available"} entity="driver" className="rounded-full px-3 py-1 text-xs font-bold" />,
    },
    {
      key: "account",
      label: "Login",
      render: (_, row) =>
        row.account ? (
          <Badge variant={row.account.has_password ? "success" : "secondary"} className="rounded-full px-3 py-1 text-xs font-bold">
            {row.account.has_password ? "Enabled" : "No login"}
          </Badge>
        ) : (
          <Badge variant="warning" className="rounded-full px-3 py-1 text-xs font-bold">Needs profile</Badge>
        ),
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
              onClick={() => setSelectedDriver(row)}
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

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={Users}
        title="Driver Availability"
        badge="Operations"
        description="Live view of driver readiness and assignment state."
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
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Driver statuses">
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
      </div>

      {isLoading ? (
        <div className="h-48 bg-muted/20 animate-pulse rounded-3xl border border-border/40" />
      ) : (
        <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
          <CardContent className="p-0">
            <DataTable
              columns={columns}
              data={filteredDrivers}
              pageSize={10}
              title={`Drivers - ${tab}`}
              description={`Currently viewing ${tab.toLowerCase()} drivers.`}
              icon={Users}
              context={tab}
              searchPlaceholder="Search by name or license..."
              searchTerm={search}
              onSearchChange={setSearch}
              onRowClick={(row) => setSelectedDriver(row)}
            />
          </CardContent>
        </Card>
      )}

      <Dialog open={!!selectedDriver} onOpenChange={(open) => !open && setSelectedDriver(null)}>
        <DialogContent className="sm:max-w-md rounded-3xl overflow-hidden border-border/60 shadow-lg p-0">
          {selectedDriver && (
            <>
              <div className="bg-muted/30 p-6 border-b border-border/40">
                <DialogHeader>
                  <DialogTitle className="text-xl font-bold flex items-center gap-2">
                    <User className="w-5 h-5 text-primary" /> Driver Information
                  </DialogTitle>
                </DialogHeader>
                <div className="mt-4 flex items-center gap-4">
                  <div className="h-16 w-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center text-xl font-bold">
                    {selectedDriver.employees?.first_name?.[0] || "D"}
                    {selectedDriver.employees?.last_name?.[0] || "R"}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-foreground">
                      {selectedDriver.employees?.first_name} {selectedDriver.employees?.last_name}
                    </h3>
                    <p className="text-sm font-medium text-foreground-secondary flex items-center gap-1.5 mt-1">
                      <StatusBadge status={selectedDriver.computedStatus} entity="driver" className="px-2 py-0.5 rounded-full text-[10px] font-bold" />
                    </p>
                  </div>
                </div>
              </div>
              <div className="p-6 space-y-4 bg-surface">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5 col-span-2">
                    <span className="text-xs font-semibold text-foreground-muted uppercase tracking-wider flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5" /> Contact Details
                    </span>
                    <div className="bg-muted/20 p-3 rounded-xl border border-border/40 space-y-2">
                      <p className="font-medium text-sm text-foreground flex items-center gap-2">
                        <Mail className="w-4 h-4 text-foreground-muted" /> {selectedDriver.employees?.email || "No email"}
                      </p>
                      <p className="font-medium text-sm text-foreground flex items-center gap-2">
                        <Phone className="w-4 h-4 text-foreground-muted" /> {selectedDriver.employees?.phone || "No phone"}
                      </p>
                    </div>
                  </div>
                  
                  <div className="space-y-1.5 col-span-2">
                    <span className="text-xs font-semibold text-foreground-muted uppercase tracking-wider flex items-center gap-1.5">
                      <IdCard className="w-3.5 h-3.5" /> License Details
                    </span>
                    <div className="bg-muted/20 p-3 rounded-xl border border-border/40 grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-xs text-foreground-secondary mb-0.5">Number</p>
                        <p className="font-data font-bold text-sm">{selectedDriver.license_number || "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-foreground-secondary mb-0.5">Class</p>
                        <p className="font-bold text-sm">{selectedDriver.license_class || "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-foreground-secondary mb-0.5">Experience</p>
                        <p className="font-bold text-sm">{selectedDriver.years_of_experience || 0} years</p>
                      </div>
                      <div>
                        <p className="text-xs text-foreground-secondary mb-0.5">Expiry</p>
                        <p className="font-medium text-sm">{fmtDate(selectedDriver.license_expiry)}</p>
                      </div>
                    </div>
                  </div>

                  {selectedDriver.activeLeave && (
                    <div className="space-y-1.5 col-span-2">
                      <span className="text-xs font-semibold text-danger uppercase tracking-wider flex items-center gap-1.5">
                        <CalendarOff className="w-3.5 h-3.5" /> Active Leave
                      </span>
                      <div className="bg-danger/5 p-3 rounded-xl border border-danger/20">
                        <p className="font-bold text-sm text-danger mb-1">{selectedDriver.activeLeave.leave_type}</p>
                        <p className="text-xs text-danger/80 font-medium">
                          {fmtDate(selectedDriver.activeLeave.start_date)} ➔ {fmtDate(selectedDriver.activeLeave.end_date)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="p-4 bg-muted/10 border-t border-border/40 flex justify-end">
                <Button variant="outline" className="rounded-xl shadow-xs h-9 px-4 text-xs font-semibold" onClick={() => setSelectedDriver(null)}>Close</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
