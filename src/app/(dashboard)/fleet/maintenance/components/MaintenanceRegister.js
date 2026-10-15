"use client";

import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Edit, Eye, TriangleAlert, FileText } from "lucide-react";
import { repairPerformerLabel } from "@/lib/maintenance/performer";

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
              <th className="px-4 py-3 font-medium">Mechanic</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Date</th>
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
                <td className="px-4 py-3">
                  <div className="flex flex-col items-start gap-1">
                    <span>{record.maintenance_type}</span>
                    {record.source_incident_id && (
                      <Link
                        href="/incidents"
                        className="inline-flex items-center gap-1 text-[10px] font-bold text-danger bg-danger/10 border border-danger/20 rounded px-1.5 py-0.5 hover:bg-danger/15 transition-colors"
                        title="This repair was generated from a driver incident report"
                      >
                        <TriangleAlert className="w-3 h-3" />
                        Incident #{record.source_incident_id}
                      </Link>
                    )}
                    {record.source_inspection_id && (
                      <Link
                        href="/maintenance/problems"
                        className="inline-flex items-center gap-1 text-[10px] font-bold text-info bg-info/10 border border-info/20 rounded px-1.5 py-0.5 hover:bg-info/15 transition-colors"
                        title="This repair was generated from an End Duty inspection report"
                      >
                        <FileText className="w-3 h-3" />
                        Inspection #{record.source_inspection_id}
                      </Link>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">{repairPerformerLabel(record)}</td>
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
