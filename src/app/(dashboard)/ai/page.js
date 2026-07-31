"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getAiRecommendations, getAiInsights, getPredictiveMaintenance } from "@/services/ai.service";
import { formatDate } from "@/lib/utils";
import { Brain, Lightbulb, Wrench, TrendingUp, AlertTriangle, CheckCircle2, ArrowRight } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";

export default function AiDashboardPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "management"]);
  const { data: insightsData } = useQuery({
    queryKey: ["ai-insights"],
    queryFn: () => getAiInsights(),
  });

  const { data: recommendationsData } = useQuery({
    queryKey: ["ai-recommendations"],
    queryFn: () => getAiRecommendations(),
  });

  const { data: predictions = [] } = useQuery({
    queryKey: ["predictive-maintenance"],
    queryFn: () => getPredictiveMaintenance(),
  });

  const insights = Array.isArray(insightsData)
    ? insightsData
    : Array.isArray(insightsData?.insights)
    ? insightsData.insights
    : [];

  const recommendations = Array.isArray(recommendationsData)
    ? recommendationsData
    : Array.isArray(recommendationsData?.recommendations)
    ? recommendationsData.recommendations
    : [];

  const nlSummary = insightsData?.natural_language_summary || null;

  const critical = insights.filter((i) => (i.severity || i.impact) === "high" || (i.severity || i.impact) === "critical").length;
  const overdueMaint = predictions.filter((p) => p.risk === "overdue" || p.risk === "critical" || p.risk === "Critical").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-primary/10">
          <Brain className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">AI & Automation</h1>
          <p className="text-foreground-secondary mt-1">Intelligent insights and automated fleet operations</p>
        </div>
        <Badge variant="default" className="text-xs ml-2">AI-powered</Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10"><Lightbulb className="w-5 h-5 text-primary" /></div>
            <div><p className="text-xl font-bold">{insights.length}</p><p className="text-xs text-foreground-muted">Active Insights</p></div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-danger/10"><AlertTriangle className="w-5 h-5 text-danger" /></div>
            <div><p className="text-xl font-bold">{critical}</p><p className="text-xs text-foreground-muted">Critical Alerts</p></div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-warning/10"><Wrench className="w-5 h-5 text-warning" /></div>
            <div><p className="text-xl font-bold">{overdueMaint}</p><p className="text-xs text-foreground-muted">Maintenance Alerts</p></div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-success/10"><TrendingUp className="w-5 h-5 text-success" /></div>
            <div><p className="text-xl font-bold">{recommendations.length}</p><p className="text-xs text-foreground-muted">Recommendations</p></div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-primary" /> AI Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          {insights.length === 0 ? (
            <p className="text-sm text-foreground-muted text-center py-8">No AI insights yet. Insights will appear as the system learns operational patterns.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {insights.map((insight, idx) => {
                const sev = (insight.severity || insight.impact || "low").toLowerCase();
                return (
                  <div key={insight.insight_id || idx} className="p-4 rounded-xl border border-border/50 hover:shadow-sm transition-all bg-card">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className={`w-4 h-4 ${sev === "high" || sev === "critical" ? "text-danger" : sev === "medium" ? "text-warning" : "text-primary"}`} />
                      <Badge variant={sev === "high" || sev === "critical" ? "danger" : sev === "medium" ? "warning" : "default"} className="text-[10px] capitalize">
                        {sev} Priority
                      </Badge>
                    </div>
                    <h4 className="text-sm font-semibold text-foreground mb-1">{insight.title}</h4>
                    <p className="text-xs text-foreground-secondary mb-2 leading-relaxed">{insight.summary || insight.description}</p>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[10px] text-foreground-muted font-medium">{insight.category || "Fleet Utilization"}</span>
                      <span className="text-[10px] text-foreground-muted">{insight.created_at ? formatDate(insight.created_at) : "Active"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Wrench className="w-4 h-4 text-primary" /> Predictive Maintenance
          </CardTitle>
        </CardHeader>
        <CardContent>
          {predictions.length === 0 ? (
            <p className="text-sm text-foreground-muted text-center py-8">No vehicles in the system</p>
          ) : (
            <div className="space-y-3">
              {predictions.slice(0, 10).map((p) => (
                <div key={p.vehicle_id} className="flex items-center gap-4 p-3 rounded-lg hover:bg-hover transition-colors">
                  <div className={`p-1.5 rounded-lg ${
                    p.risk === "overdue" ? "bg-danger/10" :
                    p.risk === "critical" ? "bg-danger/10" :
                    p.risk === "high" ? "bg-warning/10" :
                    p.risk === "medium" ? "bg-info/10" : "bg-success/10"
                  }`}>
                    <Wrench className={`w-4 h-4 ${
                      p.risk === "overdue" || p.risk === "critical" ? "text-danger" :
                      p.risk === "high" ? "text-warning" :
                      p.risk === "medium" ? "text-info" : "text-success"
                    }`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{p.plate_number}</p>
                      <span className="text-xs text-foreground-muted">{p.vehicle_name}</span>
                    </div>
                    <p className="text-xs text-foreground-muted mt-0.5">{p.recommendation}</p>
                  </div>
                  <div className="text-right">
                    <Badge variant={
                      p.risk === "overdue" || p.risk === "critical" ? "danger" :
                      p.risk === "high" ? "warning" :
                      p.risk === "medium" ? "info" : "success"
                    } className="text-[10px]">
                      {p.daysToService === 0 ? "Overdue" : `${p.daysToService}d`}
                    </Badge>
                    <p className="text-xs text-foreground-muted mt-1">{p.mileage?.toLocaleString()} km</p>
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
