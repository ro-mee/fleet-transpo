"use client";
import { useQuery } from "@tanstack/react-query";
import { Wrench } from "lucide-react";
import { HeroHeader } from "@/components/ui/hero-header";
import ServiceOutlook from "@/components/maintenance/service-outlook";
import { getPredictiveMaintenance } from "@/services/maintenance.service";
import { useRequireRole } from "@/lib/auth/role-guard";
export default function PredictiveMaintenancePage() {
  useRequireRole();
  const query = useQuery({queryKey:["predictive-maintenance"],queryFn:getPredictiveMaintenance,refetchInterval:60_000});
  return <div className="space-y-6"><HeroHeader icon={Wrench} title="Vehicle service outlook" description="Review service timing and measured evidence, then plan the next action." /><ServiceOutlook data={query.data} isLoading={query.isLoading} isError={query.isError} onRetry={query.refetch} /></div>;
}
