"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HeroHeader, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { Plus, Wrench, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getMaintenanceRecords, getPredictiveMaintenance } from "@/services/maintenance.service";
import { useRequireRole } from "@/lib/auth/role-guard";
import MaintenanceRegister from "./components/MaintenanceRegister";
import MaintenanceFormDialog from "./components/MaintenanceFormDialog";
import PredictiveOverview from "./components/PredictiveOverview";

export default function FleetMaintenancePage() {
  useRequireRole(["admin", "system_admin", "fleet_manager"]);
  const [activeTab, setActiveTab] = useState("predictive");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);

  const { data: predictiveData, isLoading: isPredictiveLoading } = useQuery({
    queryKey: ["predictive-maintenance"],
    queryFn: () => getPredictiveMaintenance(),
    refetchInterval: 60_000,
  });

  const { data: maintenanceData, isLoading: isMaintenanceLoading } = useQuery({
    queryKey: ["maintenance-records"],
    queryFn: () => getMaintenanceRecords({ limit: 1000 }),
    refetchInterval: 30_000,
  });

  const records = maintenanceData?.data || [];
  const activeRecords = records.filter((r) => ["Scheduled", "In Progress"].includes(r.status));
  const historyRecords = records.filter((r) => r.status === "Completed");

  const handleEdit = (record) => {
    setSelectedRecord(record);
    setIsFormOpen(true);
  };

  const handleNew = () => {
    setSelectedRecord(null);
    setIsFormOpen(true);
  };

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={Wrench}
        title="Fleet Maintenance"
        badge="Service & Diagnostics"
        description="Monitor vehicle health, manage active repairs, and review service history."
        actions={
          <Button className={heroButtonPrimaryClass} onClick={handleNew}>
            <Plus className="w-4 h-4 mr-2" />
            Schedule Service
          </Button>
        }
      />

      <div className="flex border-b border-border/80 gap-6 px-2">
        <button
          onClick={() => setActiveTab("predictive")}
          className={`pb-3 font-semibold text-sm transition-colors border-b-2 ${
            activeTab === "predictive"
              ? "border-primary text-primary"
              : "border-transparent text-foreground-secondary hover:text-foreground hover:border-border"
          }`}
        >
          Predictive AI Overview
        </button>
        <button
          onClick={() => setActiveTab("active")}
          className={`pb-3 font-semibold text-sm transition-colors border-b-2 flex items-center gap-2 ${
            activeTab === "active"
              ? "border-primary text-primary"
              : "border-transparent text-foreground-secondary hover:text-foreground hover:border-border"
          }`}
        >
          Active Maintenance
          {activeRecords.length > 0 && (
            <span className="bg-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
              {activeRecords.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`pb-3 font-semibold text-sm transition-colors border-b-2 ${
            activeTab === "history"
              ? "border-primary text-primary"
              : "border-transparent text-foreground-secondary hover:text-foreground hover:border-border"
          }`}
        >
          Service History
        </button>
      </div>

      <div className="py-4">
        {activeTab === "predictive" && (
          <PredictiveOverview 
            data={predictiveData} 
            isLoading={isPredictiveLoading} 
            onScheduleService={(vehicle) => {
              setSelectedRecord({ vehicle_id: vehicle.vehicle_id, maintenance_type: "Routine", status: "Scheduled" });
              setIsFormOpen(true);
            }} 
          />
        )}
        {activeTab === "active" && (
          <MaintenanceRegister 
            records={activeRecords} 
            isLoading={isMaintenanceLoading} 
            onEdit={handleEdit} 
            emptyMessage="No active maintenance records."
          />
        )}
        {activeTab === "history" && (
          <MaintenanceRegister 
            records={historyRecords} 
            isLoading={isMaintenanceLoading} 
            onEdit={handleEdit} 
            emptyMessage="No completed maintenance history found."
            isHistory={true}
          />
        )}
      </div>

      {isFormOpen && (
        <MaintenanceFormDialog
          isOpen={isFormOpen}
          onClose={() => setIsFormOpen(false)}
          initialData={selectedRecord}
        />
      )}
    </div>
  );
}
