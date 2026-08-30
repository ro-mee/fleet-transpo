"use client";

import { StatusBadge } from "@/components/ui/status-badge";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Edit, Eye } from "lucide-react";

export default function MaintenanceRegister({ records = [], isLoading, onEdit, emptyMessage, isHistory = false }) {
  if (isLoading) {
    return <div className="p-8 text-center text-foreground-secondary">Loading records...</div>;
  }

  if (records.length === 0) {
    return (
      <div className="p-12 text-center border border-border border-dashed rounded-xl bg-surface/50">
        <p className="text-foreground-secondary">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border overflow-hidden bg-surface">
      <div className="w-full overflow-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-slate-50/50 dark:bg-slate-900/50 text-foreground-secondary border-b border-border">
            <tr>
              <th className="px-4 py-3 font-medium">Vehicle</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Service Provider</th>
              {isHistory && <th className="px-4 py-3 font-medium">Cost</th>}
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {records.map((record) => (
              <tr key={record.maintenance_id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors">
                <td className="px-4 py-3 font-medium">
                  {record.vehicles?.plate_number}
                  <div className="text-xs text-foreground-secondary font-normal">{record.vehicles?.vehicle_name}</div>
                </td>
                <td className="px-4 py-3">{record.maintenance_type}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={record.status} />
                </td>
                <td className="px-4 py-3">
                  {record.maintenance_date ? format(new Date(record.maintenance_date), "MMM d, yyyy") : "-"}
                  {record.completed_date && (
                    <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                      Done: {format(new Date(record.completed_date), "MMM d")}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">{record.service_provider || "-"}</td>
                {isHistory && <td className="px-4 py-3">₱{Number(record.cost || 0).toLocaleString()}</td>}
                <td className="px-4 py-3 text-right">
                  <Button variant="ghost" size="sm" onClick={() => onEdit(record)}>
                    {isHistory ? <Eye className="w-4 h-4" /> : <Edit className="w-4 h-4" />}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
