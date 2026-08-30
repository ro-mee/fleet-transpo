"use client";

import { AlertTriangle, ShieldCheck, Clock, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PredictiveOverview({ data, isLoading, onScheduleService }) {
  if (isLoading) {
    return <div className="p-8 text-center text-foreground-secondary">Loading AI predictions...</div>;
  }

  const predictions = data?.predictions || [];
  
  if (predictions.length === 0) {
    return (
      <div className="p-12 text-center border border-border rounded-xl bg-surface">
        <ShieldCheck className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
        <h3 className="text-lg font-bold">Fleet is Healthy</h3>
        <p className="text-foreground-secondary">No vehicles currently require predictive maintenance.</p>
      </div>
    );
  }

  // Sort by risk band descending
  const riskOrder = { CRITICAL: 4, OVERDUE: 3, WARNING: 2, HEALTHY: 1, UNKNOWN: 0 };
  const sorted = [...predictions].sort((a, b) => riskOrder[b.band] - riskOrder[a.band]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {sorted.map((p) => (
        <div key={p.vehicle_id} className="border border-border/60 bg-surface rounded-xl p-4 flex flex-col gap-4 relative overflow-hidden group hover:border-primary/40 transition-colors">
          <div className="flex justify-between items-start">
            <div>
              <div className="font-bold text-lg">{p.plate_number}</div>
              <div className="text-xs text-foreground-secondary">{p.vehicle_name}</div>
            </div>
            <div className={`px-2 py-1 rounded-full text-xs font-bold ${
              p.band === 'CRITICAL' || p.band === 'OVERDUE' ? 'bg-red-500/10 text-red-600 dark:text-red-400' :
              p.band === 'WARNING' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' :
              'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
            }`}>
              {p.band}
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg">
              <div className="text-xs text-foreground-secondary flex items-center gap-1"><Clock className="w-3 h-3" /> Time Risk</div>
              <div className="font-medium mt-1">{p.days_remaining !== null ? `${p.days_remaining} days` : 'N/A'}</div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg">
              <div className="text-xs text-foreground-secondary flex items-center gap-1"><Settings2 className="w-3 h-3" /> Usage Risk</div>
              <div className="font-medium mt-1">{p.km_remaining !== null ? `${Math.round(p.km_remaining)} km` : 'N/A'}</div>
            </div>
          </div>

          <div className="mt-auto pt-2">
            <Button 
              variant="outline" 
              className="w-full justify-center" 
              onClick={() => onScheduleService(p)}
            >
              Schedule Service
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
