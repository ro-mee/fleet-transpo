"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getVehicles, getVehicleCategories } from "@/services/vehicle.service";
import { Truck, CheckCircle2, Wrench, AlertTriangle, Fuel, Gauge, CalendarDays } from "lucide-react";

export default function FleetDashboardPage() {
  const { data: vehicles = [] } = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => getVehicles(),
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["vehicle-categories"],
    queryFn: () => getVehicleCategories(),
  });

  const total = vehicles.length;
  const available = vehicles.filter((v) => v.vehicle_status === "Available").length;
  const inUse = vehicles.filter((v) => v.vehicle_status === "In Use").length;
  const maintenance = vehicles.filter((v) => v.vehicle_status === "Under Maintenance").length;
  const utilization = total ? Math.round((inUse / total) * 100) : 0;

  const vehiclesDueForService = vehicles.filter(
    (v) =>
      v.next_service_date &&
      new Date(v.next_service_date) <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Fleet Dashboard</h1>
        <p className="text-foreground-secondary mt-1">Executive overview of your fleet operations</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2.5 rounded-xl bg-primary/10">
                <Truck className="w-5 h-5 text-primary" />
              </div>
            </div>
            <p className="text-3xl font-bold text-foreground">{total}</p>
            <p className="text-sm text-foreground-secondary">Total Vehicles</p>
            <div className="mt-2 w-full bg-muted rounded-full h-1.5">
              <div className="bg-primary h-1.5 rounded-full" style={{ width: "100%" }} />
            </div>
          </CardContent>
        </Card>

        <Card className="">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2.5 rounded-xl bg-success/10">
                <CheckCircle2 className="w-5 h-5 text-success" />
              </div>
              <Badge variant="success" className="text-xs">{Math.round((available / total) * 100)}%</Badge>
            </div>
            <p className="text-3xl font-bold text-foreground">{available}</p>
            <p className="text-sm text-foreground-secondary">Available</p>
            <div className="mt-2 w-full bg-muted rounded-full h-1.5">
              <div className="bg-success h-1.5 rounded-full" style={{ width: `${(available / total) * 100}%` }} />
            </div>
          </CardContent>
        </Card>

        <Card className="">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2.5 rounded-xl bg-warning/10">
                <Gauge className="w-5 h-5 text-warning" />
              </div>
              <Badge variant="warning" className="text-xs">{utilization}%</Badge>
            </div>
            <p className="text-3xl font-bold text-foreground">{inUse}</p>
            <p className="text-sm text-foreground-secondary">In Use</p>
            <div className="mt-2 w-full bg-muted rounded-full h-1.5">
              <div className="bg-warning h-1.5 rounded-full" style={{ width: `${utilization}%` }} />
            </div>
          </CardContent>
        </Card>

        <Card className="">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2.5 rounded-xl bg-danger/10">
                <Wrench className="w-5 h-5 text-danger" />
              </div>
              <Badge variant="danger" className="text-xs">{Math.round((maintenance / total) * 100)}%</Badge>
            </div>
            <p className="text-3xl font-bold text-foreground">{maintenance}</p>
            <p className="text-sm text-foreground-secondary">Under Maintenance</p>
            <div className="mt-2 w-full bg-muted rounded-full h-1.5">
              <div className="bg-danger h-1.5 rounded-full" style={{ width: `${(maintenance / total) * 100}%` }} />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="border-0 shadow-sm lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Vehicle Categories</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {categories.map((cat) => {
                const count = vehicles.filter((v) => v.category_id === cat.category_id).length;
                const pct = total ? Math.round((count / total) * 100) : 0;
                return (
                  <div key={cat.category_id} className="flex items-center gap-4">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-foreground">{cat.category_name}</span>
                        <span className="text-xs text-foreground-muted">{count} vehicles</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className="bg-primary h-2 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
              {categories.length === 0 && (
                <p className="text-sm text-foreground-muted text-center py-4">No categories defined</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Upcoming Service</CardTitle>
          </CardHeader>
          <CardContent>
            {vehiclesDueForService.length === 0 ? (
              <p className="text-sm text-foreground-muted text-center py-4">No upcoming service</p>
            ) : (
              <div className="space-y-3">
                {vehiclesDueForService.slice(0, 5).map((v) => (
                  <div key={v.vehicle_id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-hover transition-colors">
                    <div className="p-1.5 rounded-lg bg-warning/10">
                      <CalendarDays className="w-4 h-4 text-warning" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{v.plate_number}</p>
                      <p className="text-xs text-foreground-muted">
                        Due {v.next_service_date ? new Date(v.next_service_date).toLocaleDateString() : "—"}
                      </p>
                    </div>
                    <Badge variant="warning" className="text-[10px]">{v.vehicle_name}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Fuel Type Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {["Gasoline", "Diesel", "Electric", "Hybrid"].map((type) => {
              const count = vehicles.filter((v) => v.fuel_type === type).length;
              const pct = total ? Math.round((count / total) * 100) : 0;
              return (
                <div key={type} className="text-center p-4 rounded-xl bg-muted/30">
                  <Fuel className="w-6 h-6 mx-auto mb-2 text-foreground-muted" />
                  <p className="text-2xl font-bold text-foreground">{count}</p>
                  <p className="text-xs text-foreground-muted">{type} ({pct}%)</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
