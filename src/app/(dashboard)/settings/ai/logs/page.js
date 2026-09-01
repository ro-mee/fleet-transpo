"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HeroHeader, heroButtonOutlineClass } from "@/components/ui/hero-header";
import { DataTable } from "@/components/tables/data-table";
import { getAiLogs } from "@/services/ai.service";
import { formatDate, cn } from "@/lib/utils";
import { Activity, Download, CheckCircle2, Clock, Zap, ArrowLeft } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { exportToCSV } from "@/lib/export";
import Link from "next/link";

export default function AiLogsPage() {
  useRequireRole();
  const [search, setSearch] = useState("");

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["ai-logs"],
    queryFn: () => getAiLogs(),
  });

  const columns = [
    {
      key: "created_at",
      label: "Timestamp",
      sortable: true,
      render: (val) => (val ? formatDate(val) : "—"),
    },
    {
      key: "feature_used",
      label: "Feature Used",
      render: (val) => (
        <Badge variant="outline" className="text-[11px] font-bold rounded-full px-2.5 py-0.5">
          {val || "General AI"}
        </Badge>
      ),
    },
    {
      key: "provider_name",
      label: "Provider / Model",
      render: (_, row) => (
        <div>
          <p className="font-extrabold text-foreground text-xs">{row.provider_name || "Rule-Based"}</p>
          <p className="text-[11px] text-foreground-secondary font-data mt-0.5">{row.model_name || "Deterministic Engine"}</p>
        </div>
      ),
    },
    {
      key: "tokens",
      label: "Tokens Used",
      render: (_, row) => (
        <div className="text-xs font-data">
          <span className="font-bold">{row.total_tokens || 0} pts</span>
          <span className="text-[10px] text-foreground-muted block">({row.prompt_tokens || 0} in / {row.completion_tokens || 0} out)</span>
        </div>
      ),
    },
    {
      key: "duration_ms",
      label: "Response Time",
      render: (val) => (
        <span className="text-xs font-data font-bold">{val ? `${val} ms` : "<10 ms"}</span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (val) => {
        const isSuccess = (val || "Success").toLowerCase() === "success";
        return (
          <Badge variant={isSuccess ? "success" : "danger"} className="text-[10px] rounded-full px-2.5 py-0.5 font-bold">
            {isSuccess ? "Success" : "Error"}
          </Badge>
        );
      },
    },
    {
      key: "error_message",
      label: "Error / Notes",
      render: (val) => val ? <span className="text-xs text-danger font-data truncate block max-w-xs">{val}</span> : <span className="text-xs text-foreground-muted">—</span>,
    },
  ];

  const totalTokens = logs.reduce((sum, l) => sum + (l.total_tokens || 0), 0);
  const successCount = logs.filter((l) => (l.status || "Success").toLowerCase() === "success").length;
  const avgDuration = logs.length ? Math.round(logs.reduce((sum, l) => sum + (l.duration_ms || 0), 0) / logs.length) : 0;

  return (
    <div className="space-y-6 pb-12 w-full select-none">
      {/* ── HERO HEADER BAR ── */}
      <HeroHeader
        icon={Activity}
        title="AI &amp; Automation Telemetry Logs"
        badge="Intelligence Logs"
        description="Audit log of all LLM and Rule-Based engine requests, token usage, and response latency."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/settings/ai">
              <Button variant="outline" size="sm" className={cn("rounded-2xl h-10 px-4 text-xs font-semibold cursor-pointer", heroButtonOutlineClass)}>
                <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                Back to Provider Settings
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                exportToCSV(logs, "ai-request-logs", [
                  { label: "Timestamp", key: "created_at" },
                  { label: "Feature", key: "feature_used" },
                  { label: "Provider", key: "provider_name" },
                  { label: "Model", key: "model_name" },
                  { label: "Total Tokens", key: "total_tokens" },
                  { label: "Duration (ms)", key: "duration_ms" },
                  { label: "Status", key: "status" },
                  { label: "Error Message", key: "error_message" },
                ])
              }
              className={cn("rounded-2xl h-10 px-4 text-xs font-semibold cursor-pointer", heroButtonOutlineClass)}
            >
              <Download className="w-3.5 h-3.5 mr-2" />
              Export CSV Logs
            </Button>
          </div>
        }
      />

      {/* ── SUMMARY KPI CARDS ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3 hover:border-primary/50 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">Total AI Requests</span>
            <div className="p-2 rounded-2xl bg-primary/10 text-primary border border-primary/20">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-3xl font-black text-foreground font-data">{logs.length}</div>
            <p className="text-[11px] text-primary font-medium mt-1">Processed AI queries</p>
          </div>
        </div>

        <div className="p-5 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3 hover:border-success/50 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">Successful Executions</span>
            <div className="p-2 rounded-2xl bg-success/10 text-success border border-success/20">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-3xl font-black text-foreground font-data">{successCount}</div>
            <p className="text-[11px] text-success font-semibold mt-1">Successful completions</p>
          </div>
        </div>

        <div className="p-5 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3 hover:border-info/50 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">Tokens Consumed</span>
            <div className="p-2 rounded-2xl bg-info/10 text-info border border-info/20">
              <Zap className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-3xl font-black text-foreground font-data">{totalTokens.toLocaleString()}</div>
            <p className="text-[11px] text-info font-semibold mt-1">Total model tokens</p>
          </div>
        </div>

        <div className="p-5 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3 hover:border-warning/50 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">Avg Latency</span>
            <div className="p-2 rounded-2xl bg-warning/10 text-warning border border-warning/20">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-3xl font-black text-foreground font-data">{avgDuration} ms</div>
            <p className="text-[11px] text-warning font-semibold mt-1 font-data">Average response duration</p>
          </div>
        </div>
      </div>

      {/* ── TABLE CONTAINER CARD ── */}
      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden bg-surface">
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={logs}
            isLoading={isLoading}
            searchable
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search feature, provider, model..."
          />
        </CardContent>
      </Card>
    </div>
  );
}
