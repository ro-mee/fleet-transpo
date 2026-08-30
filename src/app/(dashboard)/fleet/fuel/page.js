"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HeroHeader } from "@/components/ui/hero-header";
import { Fuel, AlertTriangle, CheckCircle2, TrendingUp, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export default function FleetFuelPage() {
  const queryClient = useQueryClient();
  const [selectedMonth, setSelectedMonth] = useState(
    new Date().toISOString().substring(0, 7) // YYYY-MM
  );
  const [selectedException, setSelectedException] = useState(null);
  const [isResolving, setIsResolving] = useState(false);

  const { data: analytics, isLoading } = useQuery({
    queryKey: ["fuel-analytics", selectedMonth],
    queryFn: async () => {
      const res = await fetch(`/api/admin/analytics/fuel?month=${selectedMonth}`);
      if (!res.ok) throw new Error("Failed to load analytics");
      return res.json();
    }
  });

  const TONE_MAP = {
    primary:   { bg: 'bg-slate-500/10',   border: 'border-slate-500/30',   icon: 'bg-slate-500/15 text-slate-500' },
    success:   { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', icon: 'bg-emerald-500/15 text-emerald-500' },
    warning:   { bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   icon: 'bg-amber-500/15 text-amber-500' },
    info:      { bg: 'bg-blue-500/10',    border: 'border-blue-500/30',    icon: 'bg-blue-500/15 text-blue-500' },
  };

  const statCards = analytics ? [
    { label: "Fuel Spend", value: `₱${analytics.overview.total_spend.toLocaleString(undefined, {minimumFractionDigits: 2})}`, icon: TrendingUp, tone: "primary" },
    { label: "Liters Purchased", value: `${analytics.overview.total_liters.toLocaleString(undefined, {maximumFractionDigits: 1})} L`, icon: Fuel, tone: "info" },
    { label: "Avg Price/L", value: analytics.overview.average_price_per_liter ? `₱${analytics.overview.average_price_per_liter.toFixed(2)}` : "Insufficient Data", icon: Fuel, tone: "primary" },
    { label: "Verified Transactions", value: analytics.overview.verified_transactions, icon: CheckCircle2, tone: "success" },
  ] : [];

  const handleResolve = async (id, status) => {
    const remarks = window.prompt(`Enter optional remarks for marking this transaction as ${status}:`);
    if (remarks === null) return; // cancelled
    
    setIsResolving(true);
    try {
      const res = await fetch("/api/admin/analytics/fuel/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fuel_record_id: id, status, review_remarks: remarks })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to resolve");
      }
      setSelectedException(null);
      queryClient.invalidateQueries(["fuel-analytics", selectedMonth]);
    } catch (e) {
      alert(e.message);
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={Fuel}
        title="Fuel Analytics & Exceptions"
        badge="Fleet Dashboard"
        description="Monitor verified fuel expenditure, estimated vehicle efficiency, and review anomalies."
      />

      {/* Month Selector */}
      <div className="flex items-center gap-4 bg-surface p-4 rounded-xl border border-border/60">
        <label className="text-sm font-bold text-foreground-secondary">Reporting Period:</label>
        <input 
          type="month" 
          value={selectedMonth} 
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="bg-transparent border border-border/80 rounded-md px-3 py-1.5 text-foreground text-sm focus:outline-none focus:border-primary"
        />
        <div className="text-xs text-foreground-muted ml-auto flex items-center gap-1">
          <Info className="w-3.5 h-3.5" />
          Analytics strictly separate fuel purchases from estimated consumption.
        </div>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {isLoading ? (
          <div className="col-span-4 text-center py-8 text-foreground-muted">Loading analytics...</div>
        ) : (
          statCards.map((card) => {
            const t = TONE_MAP[card.tone];
            const Icon = card.icon;
            return (
              <div key={card.label} className={cn("relative p-4 rounded-3xl border-2 transition-all duration-200 flex flex-col gap-3 overflow-hidden", t.border, t.bg)}>
                <div className="flex items-start justify-between gap-2 mt-1">
                  <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider">{card.label}</span>
                  <div className={cn("p-2 rounded-2xl shrink-0", t.icon)}>
                    <Icon className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-2xl font-bold text-foreground font-data">{card.value}</div>
              </div>
            );
          })
        )}
      </div>

      {/* Exceptions Panel */}
      {analytics?.exceptions?.length > 0 && (
        <div className="bg-amber-500/10 border-2 border-amber-500/30 rounded-3xl overflow-hidden p-6 space-y-4">
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="w-5 h-5" />
            <h3 className="font-bold text-lg">Transactions Needing Review</h3>
          </div>
          <p className="text-sm text-foreground-secondary mb-2">These transactions require human review due to detected anomalies. They do not contribute to verified totals until approved.</p>
          
          <div className="bg-surface rounded-xl border border-border/60 divide-y divide-border/60">
            {analytics.exceptions.map((ex) => (
              <div key={ex.fuel_record_id} className="p-4 flex items-center justify-between hover:bg-black/5 dark:hover:bg-white/5">
                <div>
                  <div className="font-bold text-foreground">{ex.plate_number}</div>
                  <div className="text-xs text-foreground-muted">{new Date(ex.fuel_date).toLocaleDateString()} • {ex.liters} L • ₱{ex.amount}</div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex gap-2">
                    {ex.flags.price_anomaly && <span className="text-xs bg-amber-500/20 text-amber-600 px-2 py-1 rounded font-medium">Price Anomaly</span>}
                    {ex.flags.driver_edited && <span className="text-xs bg-blue-500/20 text-blue-600 px-2 py-1 rounded font-medium">Driver Edited</span>}
                    {ex.flags.fuel_type_mismatch && <span className="text-xs bg-red-500/20 text-red-600 px-2 py-1 rounded font-medium">Type Mismatch</span>}
                    {ex.flags.possible_duplicate && <span className="text-xs bg-orange-500/20 text-orange-600 px-2 py-1 rounded font-medium">Duplicate</span>}
                  </div>
                  <button 
                    onClick={() => setSelectedException(ex)}
                    className="px-3 py-1.5 bg-primary text-primary-foreground text-xs font-bold rounded-lg hover:bg-primary/90"
                  >
                    Review
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Vehicle Analytics Table */}
      {!isLoading && (
        <div className="bg-surface border-2 border-border/60 rounded-3xl overflow-hidden">
          <div className="p-5 border-b border-border/60 flex items-center justify-between bg-black/5 dark:bg-white/5">
            <h3 className="font-bold text-lg text-foreground">Vehicle Analytics</h3>
            <span className="text-xs font-medium bg-white/10 px-2 py-1 rounded-full text-foreground-muted">Verified Only</span>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border/60 bg-black/5 dark:bg-white/5 text-xs text-foreground-secondary uppercase tracking-wider">
                  <th className="p-4 font-bold">Vehicle</th>
                  <th className="p-4 font-bold text-right">Fuel Spend</th>
                  <th className="p-4 font-bold text-right">Liters</th>
                  <th className="p-4 font-bold text-right">Distance</th>
                  <th className="p-4 font-bold text-right">Est. km/L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 text-sm">
                {analytics?.vehicles?.length === 0 && (
                  <tr>
                    <td colSpan="5" className="p-8 text-center text-foreground-muted">Insufficient data for this period.</td>
                  </tr>
                )}
                {analytics?.vehicles?.map((v) => (
                  <tr key={v.vehicle_id} className="hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                    <td className="p-4">
                      <div className="font-bold text-foreground">{v.plate_number}</div>
                      <div className="text-xs text-foreground-muted">{v.vehicle_name}</div>
                    </td>
                    <td className="p-4 text-right font-data font-medium">₱{v.vehicle_spend.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                    <td className="p-4 text-right font-data">{v.vehicle_liters} L</td>
                    <td className="p-4 text-right font-data">{v.distance_traveled} km</td>
                    <td className="p-4 text-right font-data font-bold text-primary">
                      {v.estimated_kmpl != null ? (
                        `${v.estimated_kmpl.toFixed(1)} km/L`
                      ) : (
                        <span className="text-xs text-foreground-muted font-normal italic">Insufficient Data</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Exception Review Modal */}
      {selectedException && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-border/60 shadow-2xl">
            <div className="p-4 border-b border-border/60 flex justify-between items-center sticky top-0 bg-surface">
              <h2 className="font-bold text-lg flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                Review Fuel Exception
              </h2>
              <button onClick={() => setSelectedException(null)} className="p-2 hover:bg-black/5 rounded-full"><X className="w-5 h-5"/></button>
            </div>
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-foreground-muted block">Vehicle</span><span className="font-bold">{selectedException.plate_number}</span></div>
                <div><span className="text-foreground-muted block">Fuel Date</span><span className="font-bold">{new Date(selectedException.fuel_date).toLocaleDateString()}</span></div>
                <div><span className="text-foreground-muted block">Station</span><span className="font-bold">{selectedException.station_name || "Unknown"}</span></div>
                <div><span className="text-foreground-muted block">Fuel Type</span><span className="font-bold">{selectedException.fuel_type || "Unknown"}</span></div>
                <div><span className="text-foreground-muted block">Liters</span><span className="font-bold">{selectedException.liters} L</span></div>
                <div><span className="text-foreground-muted block">Total Amount</span><span className="font-bold">₱{selectedException.amount}</span></div>
              </div>

              <div className="space-y-2">
                <h3 className="font-bold text-foreground">Detected Anomalies</h3>
                <ul className="list-disc pl-5 text-sm text-amber-600">
                  {selectedException.flags.price_anomaly && <li>Unusual price per liter (₱{(selectedException.amount / selectedException.liters).toFixed(2)})</li>}
                  {selectedException.flags.fuel_type_mismatch && <li>Receipt fuel type does not match vehicle requirement</li>}
                  {selectedException.flags.possible_duplicate && <li>Possible duplicate receipt detected in system</li>}
                  {selectedException.flags.driver_edited && <li>Driver manually edited AI extracted values</li>}
                </ul>
              </div>

              {selectedException.receipt_url && (
                <div className="space-y-2">
                  <h3 className="font-bold text-foreground">Receipt Scan</h3>
                  <a href={selectedException.receipt_url} target="_blank" rel="noreferrer" className="block w-full rounded-xl overflow-hidden border border-border/60">
                    <img src={selectedException.receipt_url} alt="Receipt" className="w-full h-48 object-cover hover:opacity-90" />
                  </a>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-border/60 flex justify-end gap-3 sticky bottom-0 bg-surface">
              <button 
                onClick={() => handleResolve(selectedException.fuel_record_id, "Rejected")}
                disabled={isResolving}
                className="px-4 py-2 bg-red-500/10 text-red-600 font-bold rounded-lg hover:bg-red-500/20 disabled:opacity-50"
              >
                Reject Transaction
              </button>
              <button 
                onClick={() => handleResolve(selectedException.fuel_record_id, "Approved")}
                disabled={isResolving}
                className="px-4 py-2 bg-emerald-500 text-white font-bold rounded-lg hover:bg-emerald-600 disabled:opacity-50"
              >
                Approve (Verified)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
