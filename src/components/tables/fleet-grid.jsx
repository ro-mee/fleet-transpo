"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { getVehicles } from "@/services/vehicle.service";
import { getUvvrpPolicy } from "@/services/settings.service";
import { isRestricted } from "@/lib/uvvrp/policy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/utils";
import { Users, Fuel, Settings, Truck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function FleetGrid({ filters = {} }) {
  const router = useRouter();
  const { data: allVehicles = [], isLoading } = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => getVehicles(),
  });

  const vehicles = useMemo(() => {
    return allVehicles.filter((v) => {
      if (filters.status && v.vehicle_status !== filters.status) return false;
      return true;
    });
  }, [allVehicles, filters]);

  const { data: uvvrpPolicy } = useQuery({
    queryKey: ["uvvrp-policy"],
    queryFn: getUvvrpPolicy,
  });

  const restrictedPlates = useMemo(() => {
    const set = new Set();
    if (!uvvrpPolicy?.enabled) return set;
    vehicles.forEach((v) => {
      if (v.plate_number && isRestricted(v.plate_number, uvvrpPolicy, new Date())) set.add(v.plate_number);
    });
    return set;
  }, [uvvrpPolicy, vehicles]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {[...Array(8)].map((_, i) => (
          <Card key={i} className="border-0 shadow-xs rounded-[24px] overflow-hidden animate-pulse">
            <div className="h-48 bg-muted/40" />
            <CardContent className="p-5 space-y-4">
              <div className="h-6 bg-muted rounded-md w-2/3" />
              <div className="h-4 bg-muted rounded-md w-1/3" />
              <div className="pt-4 mt-auto">
                <div className="h-10 bg-muted rounded-xl w-full" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (vehicles.length === 0) {
    return (
      <Card className="border-0 shadow-sm rounded-[24px] overflow-hidden bg-surface">
        <CardContent className="py-16 text-center text-foreground-muted flex flex-col items-center">
          <Truck className="w-12 h-12 mb-4 opacity-20" />
          <p className="font-bold text-foreground text-lg">No vehicles found</p>
          <p className="text-sm mt-1">Try adjusting your filters to see more results.</p>
        </CardContent>
      </Card>
    );
  }

  const statusVariant = {
    Available: "success",
    "In Use": "warning",
    "Under Maintenance": "danger",
    "Out of Service": "danger",
    Reserved: "default",
    "Registration Expired": "danger",
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {vehicles.map((v) => {
        const restricted = restrictedPlates.has(v.plate_number);
        const status = restricted ? "Coding Restricted" : v.vehicle_status;
        const statusColor = restricted ? "danger" : (statusVariant[status] || "default");

        return (
          <div key={v.vehicle_id} className="group flex flex-col bg-surface border border-border/60 rounded-[24px] overflow-hidden shadow-sm hover:shadow-xl hover:border-primary/40 transition-all duration-300 transform hover:-translate-y-1">
            {/* Image Section */}
            <div className="relative h-48 bg-gradient-to-br from-muted/30 to-muted/10 flex items-center justify-center overflow-hidden border-b border-border/40">
              <div className="absolute inset-0 bg-black/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10" />
              
              {v.image_url ? (
                <img 
                  src={v.image_url} 
                  alt={v.vehicle_name} 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out" 
                />
              ) : (
                <div className="w-full h-full p-6 flex flex-col items-center justify-center text-foreground-muted/40 group-hover:scale-110 transition-transform duration-500 ease-out drop-shadow-lg">
                  <Truck className="w-20 h-20" />
                </div>
              )}
              
              <Badge variant={statusColor} className="absolute top-4 right-4 z-20 rounded-full px-3 py-1 text-[10px] font-bold shadow-md uppercase tracking-wider border-0">
                {status}
              </Badge>
            </div>

            <div className="p-5 flex flex-col flex-1 bg-surface z-20">
              <div className="flex items-start justify-between gap-2 mb-4">
                <div>
                  <h3 className="text-lg font-black text-foreground tracking-tight leading-none mb-1.5">{v.vehicle_name}</h3>
                  <p className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider">{v.manufacturer || "Unknown"} {v.model || ""}</p>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-[10px] font-bold text-primary/70 uppercase tracking-wider block mb-0.5">Plate #</span>
                  <span className="text-sm font-black font-data text-foreground bg-primary/5 px-2.5 py-1 rounded-xl border border-primary/20 shadow-xs block">{v.plate_number}</span>
                </div>
              </div>

              {/* Specs Icons */}
              <div className="flex items-center justify-between text-[11px] font-bold text-foreground-muted mb-6 bg-muted/20 rounded-[14px] p-3 border border-border/40">
                <div className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-primary/70" /> {v.seating_capacity || "-"} seats</div>
                <div className="w-px h-4 bg-border/60" />
                <div className="flex items-center gap-1.5"><Fuel className="w-3.5 h-3.5 text-amber-500/70" /> {v.fuel_type || "-"}</div>
                <div className="w-px h-4 bg-border/60" />
                <div className="flex items-center gap-1.5"><Settings className="w-3.5 h-3.5 text-blue-500/70" /> {formatNumber(v.mileage || 0)} km</div>
              </div>

              <div className="mt-auto pt-2">
                <Button 
                  className="w-full rounded-[14px] font-bold text-xs h-10 shadow-xs hover:shadow-md transition-all" 
                  variant="outline"
                  onClick={() => router.push(`/fleet/vehicles/${v.vehicle_id}`)}
                >
                  View Details
                </Button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
