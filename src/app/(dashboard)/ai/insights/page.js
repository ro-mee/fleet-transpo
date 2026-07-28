"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getAiInsights, dismissAiInsight } from "@/services/ai.service";
import { formatDate } from "@/lib/utils";
import { Lightbulb, AlertTriangle, Info, X, RefreshCw } from "lucide-react";
import { toast } from "@/components/ui/toast";

export default function AiInsightsPage() {
  const queryClient = useQueryClient();

  const { data: insights = [] } = useQuery({
    queryKey: ["ai-insights"],
    queryFn: () => getAiInsights(),
  });

  const dismissMutation = useMutation({
    mutationFn: dismissAiInsight,
    onSuccess: () => {
      toast.success("Insight dismissed");
      queryClient.invalidateQueries({ queryKey: ["ai-insights"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const highImpact = insights.filter((i) => i.impact === "high").length;
  const mediumImpact = insights.filter((i) => i.impact === "medium").length;
  const lowImpact = insights.filter((i) => i.impact === "low").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">AI Insights</h1>
          <p className="text-foreground-secondary mt-1">Data-driven operational intelligence</p>
        </div>
        <Button variant="outline" className="h-10">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-danger/10"><AlertTriangle className="w-5 h-5 text-danger" /></div>
            <div><p className="text-xl font-bold text-danger">{highImpact}</p><p className="text-xs text-foreground-muted">High Impact</p></div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-warning/10"><Info className="w-5 h-5 text-warning" /></div>
            <div><p className="text-xl font-bold text-warning">{mediumImpact}</p><p className="text-xs text-foreground-muted">Medium Impact</p></div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-info/10"><Lightbulb className="w-5 h-5 text-info" /></div>
            <div><p className="text-xl font-bold text-info">{lowImpact}</p><p className="text-xs text-foreground-muted">Low Impact</p></div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">All Insights ({insights.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {insights.length === 0 ? (
            <p className="text-sm text-foreground-muted text-center py-8">No insights generated yet</p>
          ) : (
            <div className="space-y-3">
              {insights.map((insight) => (
                <div key={insight.insight_id} className="flex items-start gap-4 p-4 rounded-xl border border-border/50 hover:shadow-sm transition-all">
                  <div className={`p-2 rounded-lg ${
                    insight.impact === "high" ? "bg-danger/10" :
                    insight.impact === "medium" ? "bg-warning/10" : "bg-info/10"
                  }`}>
                    <AlertTriangle className={`w-5 h-5 ${
                      insight.impact === "high" ? "text-danger" :
                      insight.impact === "medium" ? "text-warning" : "text-info"
                    }`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="text-sm font-semibold text-foreground">{insight.title}</h4>
                      <Badge variant={insight.impact === "high" ? "danger" : insight.impact === "medium" ? "warning" : "info"} className="text-[10px]">
                        {insight.impact}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">{insight.category || "General"}</Badge>
                    </div>
                    <p className="text-sm text-foreground-secondary">{insight.description}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-foreground-muted">
                      <span>Confidence: {Math.round((insight.confidence_score || 0) * 100)}%</span>
                      <span>{insight.created_at ? formatDate(insight.created_at) : ""}</span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-8 h-8 flex-shrink-0"
                    onClick={() => dismissMutation.mutate(insight.insight_id)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
