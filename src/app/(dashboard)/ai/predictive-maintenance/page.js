"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getPredictiveMaintenance } from "@/services/ai.service";
import { formatDate } from "@/lib/utils";
import { Wrench, AlertTriangle, CheckCircle2, CalendarDays, Gauge, Activity } from "lucide-react";

const riskColors = {
  overdue: "danger",
  critical: "danger",
  high: "warning",
  medium: "info",
  low: "success",
};

export default function PredictiveMaintenancePage() {
  const { data: predictions = [] } = useQuery({
    queryKey: ["predictive-maintenance"],
    queryFn: () => getPredictiveMaintenance(),
  });

  const overdue = predictions.filter((p) => p.risk === "overdue").length;
  const critical = predictions.filter((p) => p.risk === "critical").length;
  const high = predictions.filter((p) => p.risk === "high").length;
  const healthy = predictions.filter((p) => p.risk === "low").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Predictive Maintenance</h1>
        <p className="text-foreground-secondary mt-1">AI-powered maintenance predictions and scheduling</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-xl bg-danger/10"><AlertTriangle className="w-5 h-5 text-danger" /></div>
            </div>
            <p className="text-2xl font-bold text-danger">{overdue}</p>
            <p className="text-xs text-foreground-muted">Overdue</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-xl bg-danger/10"><CalendarDays className="w-5 h-5 text-danger" /></div>
            </div>
            <p className="text-2xl font-bold text-danger">{critical}</p>
            <p className="text-xs text-foreground-muted">Critical (7 days)</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-xl bg-warning/10"><Activity className="w-5 h-5 text-warning" /></div>
            </div>
            <p className="text-2xl font-bold text-warning">{high}</p>
            <p className="text-xs text-foreground-muted">High (30 days)</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-xl bg-success/10"><CheckCircle2 className="w-5 h-5 text-success" /></div>
            </div>
            <p className="text-2xl font-bold text-success">{healthy}</p>
            <p className="text-xs text-foreground-muted">Healthy</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Maintenance Predictions</CardTitle>
        </CardHeader>
        <CardContent>
          {predictions.length === 0 ? (
            <p className="text-sm text-foreground-muted text-center py-8">No vehicles in the system</p>
          ) : (
            <div className="space-y-2">
              {predictions.map((p) => (
                <div key={p.vehicle_id} className="flex items-center gap-4 p-4 rounded-xl border border-border/50 hover:shadow-sm transition-all">
                  <div className={`p-2.5 rounded-xl ${
                    p.risk === "overdue" || p.risk === "critical" ? "bg-danger/10" :
                    p.risk === "high" ? "bg-warning/10" :
                    p.risk === "medium" ? "bg-info/10" : "bg-success/10"
                  }`}>
                    <Wrench className={`w-5 h-5 ${
                      p.risk === "overdue" || p.risk === "critical" ? "text-danger" :
                      p.risk === "high" ? "text-warning" :
                      p.risk === "medium" ? "text-info" : "text-success"
                    }`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-foreground">{p.plate_number}</h4>
                      <span className="text-xs text-foreground-muted">{p.vehicle_name}</span>
                      <Badge variant={riskColors[p.risk]} className="text-[10px]">
                        {p.risk === "overdue" ? "Overdue" : `${p.daysToService} days`}
                      </Badge>
                    </div>
                    <p className="text-xs text-foreground-secondary mt-1">{p.recommendation}</p>
                    <div className="flex items-center gap-4 mt-1.5 text-[10px] text-foreground-muted">
                      <span className="flex items-center gap-1"><Gauge className="w-3 h-3" /> {p.mileage?.toLocaleString()} km</span>
                      {p.next_service_date && (
                        <span className="flex items-center gap-1"><CalendarDays className="w-3 h-3" /> Next: {formatDate(p.next_service_date)}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold">{p.score}/100</p>
                    <p className="text-[10px] text-foreground-muted">Health Score</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
