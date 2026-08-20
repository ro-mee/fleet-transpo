"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { getVehicles } from "@/services/vehicle.service";
import { getUvvrpPolicy } from "@/services/settings.service";
import { isRestricted } from "@/lib/uvvrp/policy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatNumber } from "@/lib/utils";
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
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-7">
      {vehicles.map((v) => {
        const restricted = restrictedPlates.has(v.plate_number);
        const status = restricted ? "Coding Restricted" : v.vehicle_status;
        const isAvailable = status === "Available";
        const isInUse = status === "In Use";

        return (
          <div 
            key={v.vehicle_id} 
            className="group relative flex flex-col rounded-[28px] p-2 bg-gradient-to-b from-border/40 via-border/20 to-border/10 border border-border/70 hover:border-primary/50 shadow-sm hover:shadow-2xl hover:shadow-primary/10 transition-all duration-500 transform hover:-translate-y-1.5"
          >
            {/* Top Specular Light Gleam */}
            <div className="absolute top-0 left-6 right-6 h-[1px] bg-gradient-to-r from-transparent via-white/40 dark:via-white/20 to-transparent z-30 pointer-events-none" />

            {/* Inner Core Enclosure */}
            <div className="relative flex flex-col flex-1 rounded-[22px] overflow-hidden bg-surface dark:bg-zinc-900 border border-border/40">
              
              {/* Portrait Hero Image Frame with Frosted Gradient Ramp */}
              <div className="relative h-56 w-full bg-gradient-to-b from-muted/30 via-muted/10 to-surface overflow-hidden">
                {v.image_url ? (
                  <img 
                    src={v.image_url} 
                    alt={v.vehicle_name} 
                    className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-700 ease-out" 
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-slate-100 to-slate-50 dark:from-zinc-800/60 dark:to-zinc-900 text-foreground-muted/30 group-hover:scale-105 transition-transform duration-700">
                    <Truck className="w-20 h-20 stroke-[1.25]" />
                  </div>
                )}

                {/* Soft Bottom Image Scrim Gradient */}
                <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/30 to-transparent z-10 pointer-events-none" />

                {/* Top Floating Status Pill Badge */}
                <div className="absolute top-3.5 right-3.5 z-20">
                  <div className={cn(
                    "flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-extrabold tracking-wider uppercase backdrop-blur-md border shadow-xs",
                    isAvailable && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
                    isInUse && "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
                    restricted && "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
                    !isAvailable && !isInUse && !restricted && "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
                  )}>
                    <span className={cn(
                      "w-1.5 h-1.5 rounded-full animate-pulse",
                      isAvailable && "bg-emerald-500",
                      isInUse && "bg-blue-500",
                      restricted && "bg-red-500",
                      !isAvailable && !isInUse && !restricted && "bg-amber-500"
                    )} />
                    {status}
                  </div>
                </div>

                {/* Category Pill Over Image */}
                <div className="absolute top-3.5 left-3.5 z-20">
                  <span className="bg-black/40 backdrop-blur-md text-white/90 text-[10px] font-extrabold px-2.5 py-1 rounded-full border border-white/10 uppercase tracking-widest">
                    {v.vehiclecategories?.category_name || "Fleet"}
                  </span>
                </div>
              </div>

              {/* Vehicle Body Content Layer */}
              <div className="px-5 pb-5 pt-1 flex flex-col flex-1 justify-between gap-4 z-20">
                
                {/* Title & Verified Model Block */}
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <h3 className="text-xl font-extrabold text-foreground tracking-tight line-clamp-1 group-hover:text-primary transition-colors">
                      {v.vehicle_name}
                    </h3>
                    {/* Blue Verified Badge */}
                    <svg className="w-4 h-4 text-blue-500 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                    </svg>
                  </div>
                  <p className="text-[12px] font-medium text-foreground-muted line-clamp-1">
                    {v.manufacturer ? `${v.manufacturer} ${v.model || ""}` : "Dispatched Transport Unit"}
                  </p>
                </div>

                {/* Tactical Stats Grid (3-Column Minimalist Metrics) */}
                <div className="grid grid-cols-3 divide-x divide-border/60 py-2.5 px-1 bg-muted/20 dark:bg-zinc-800/40 rounded-2xl border border-border/50 text-center">
                  <div className="px-1">
                    <div className="text-[13px] font-black text-foreground tracking-tight font-data">
                      {v.seating_capacity || 4} <span className="text-[10px] font-bold text-foreground-muted font-sans">pax</span>
                    </div>
                    <div className="text-[10px] uppercase font-bold text-foreground-muted tracking-wider mt-0.5">Capacity</div>
                  </div>

                  <div className="px-1">
                    <div className="text-[13px] font-black text-foreground tracking-tight font-data truncate">
                      {v.fuel_level ? `${v.fuel_level}%` : "100%"}
                    </div>
                    <div className="text-[10px] uppercase font-bold text-foreground-muted tracking-wider mt-0.5">Fuel Tank</div>
                  </div>

                  <div className="px-1">
                    <div className="text-[13px] font-black text-foreground tracking-tight font-data truncate">
                      {v.mileage ? `${(v.mileage / 1000).toFixed(0)}k` : "0k"}
                    </div>
                    <div className="text-[10px] uppercase font-bold text-foreground-muted tracking-wider mt-0.5">Odo km</div>
                  </div>
                </div>

                {/* Island Action Bar with Plate Badge & Circular Affordance */}
                <div className="flex items-center gap-2 pt-1">
                  {/* Primary CTA Button */}
                  <Button 
                    className="flex-1 h-11 rounded-full bg-zinc-900 hover:bg-black text-white dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100 font-bold text-xs shadow-md group/btn flex items-center justify-center gap-2 transition-all duration-300"
                    onClick={() => router.push(`/fleet/vehicles/${v.vehicle_id}`)}
                  >
                    <span>View Vehicle</span>
                    <div className="w-5 h-5 rounded-full bg-white/15 dark:bg-black/10 flex items-center justify-center group-hover/btn:translate-x-0.5 transition-transform">
                      <Truck className="w-3 h-3" />
                    </div>
                  </Button>

                  {/* Tactile Plate Pill Badge */}
                  <div 
                    title={`Plate: ${v.plate_number}`}
                    className="h-11 px-3.5 rounded-full bg-muted/40 dark:bg-zinc-800/80 border border-border/70 flex items-center justify-center font-data font-black text-xs text-foreground tracking-wider shadow-xs"
                  >
                    {v.plate_number}
                  </div>
                </div>

              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
