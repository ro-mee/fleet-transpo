"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FleetTable } from "@/components/tables/fleet-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Download, Truck, Wrench, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getVehicles } from "@/services/vehicle.service";

export default function FleetVehiclesPage() {
  const router = useRouter();
  const [filters, setFilters] = useState({});

  const { data: vehicles = [] } = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => getVehicles(),
  });

  const stats = {
    total: vehicles.length,
    available: vehicles.filter((v) => v.vehicle_status === "Available").length,
    inUse: vehicles.filter((v) => v.vehicle_status === "In Use").length,
    maintenance: vehicles.filter((v) => v.vehicle_status === "Under Maintenance").length,
    outOfService: vehicles.filter((v) => v.vehicle_status === "Out of Service").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Fleet Vehicles</h1>
          <p className="text-foreground-secondary mt-1">Manage and monitor your vehicle fleet</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" className="h-10">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button onClick={() => router.push("/fleet/vehicles/new")} className="h-10">
            <Plus className="w-4 h-4 mr-2" />
            Add Vehicle
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10">
              <Truck className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{stats.total}</p>
              <p className="text-xs text-foreground-muted">Total Vehicles</p>
            </div>
          </CardContent>
        </Card>
        <Card className="">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-success/10">
              <CheckCircle2 className="w-5 h-5 text-success" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{stats.available}</p>
              <p className="text-xs text-foreground-muted">Available</p>
            </div>
          </CardContent>
        </Card>
        <Card className="">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-warning/10">
              <Truck className="w-5 h-5 text-warning" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{stats.inUse}</p>
              <p className="text-xs text-foreground-muted">In Use</p>
            </div>
          </CardContent>
        </Card>
        <Card className="">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-danger/10">
              <Wrench className="w-5 h-5 text-danger" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{stats.maintenance}</p>
              <p className="text-xs text-foreground-muted">Maintenance</p>
            </div>
          </CardContent>
        </Card>
        <Card className="">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-red-100">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{stats.outOfService}</p>
              <p className="text-xs text-foreground-muted">Out of Service</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <Button
          variant={!filters.status ? "default" : "outline"}
          size="sm"
          onClick={() => setFilters({})}
        >
          All
        </Button>
        <Button
          variant={filters.status === "Available" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilters({ status: "Available" })}
        >
          Available
        </Button>
        <Button
          variant={filters.status === "In Use" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilters({ status: "In Use" })}
        >
          In Use
        </Button>
        <Button
          variant={filters.status === "Under Maintenance" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilters({ status: "Under Maintenance" })}
        >
          Maintenance
        </Button>
      </div>

      <FleetTable filters={filters} />
    </div>
  );
}
