"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/tables/data-table";
import { getAiLogs } from "@/services/ai.service";
import { formatDate, formatCurrency } from "@/lib/utils";
import { Activity, Download, CheckCircle2, XCircle, Clock, Zap, ArrowLeft } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { exportToCSV } from "@/lib/export";
import Link from "next/link";

export default function AiLogsPage() {
  useRequireRole(["admin", "system_admin"]);
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
        <Badge variant="outline" className="text-[11px] font-medium">
          {val || "General AI"}
        </Badge>
      ),
    },
    {
      key: "provider_name",
      label: "Provider / Model",
      render: (_, row) => (
        <div>
          <p className="font-semibold text-foreground text-xs">{row.provider_name || "Rule-Based"}</p>
          <p className="text-[11px] text-foreground-secondary font-mono">{row.model_name || "Deterministic Engine"}</p>
        </div>
      ),
    },
    {
      key: "tokens",
      label: "Tokens Used",
      render: (_, row) => (
        <div className="text-xs font-mono">
          <span>{row.total_tokens || 0} pts</span>
          <span className="text-[10px] text-foreground-muted block">({row.prompt_tokens || 0} in / {row.completion_tokens || 0} out)</span>
        </div>
      ),
    },
    {
      key: "duration_ms",
      label: "Response Time",
      render: (val) => (
        <span className="text-xs font-mono">{val ? `${val} ms` : "<10 ms"}</span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (val) => {
        const isSuccess = (val || "Success").toLowerCase() === "success";
        return (
          <Badge variant={isSuccess ? "success" : "danger"} className="text-[10px]">
            {isSuccess ? "Success" : "Error"}
          </Badge>
        );
      },
    },
    {
      key: "error_message",
      label: "Error / Notes",
      render: (val) => val ? <span className="text-xs text-danger font-mono truncate block max-w-xs">{val}</span> : <span className="text-xs text-foreground-muted">—</span>,
    },
  ];

  const totalTokens = logs.reduce((sum, l) => sum + (l.total_tokens || 0), 0);
  const successCount = logs.filter((l) => (l.status || "Success").toLowerCase() === "success").length;
  const avgDuration = logs.length ? Math.round(logs.reduce((sum, l) => sum + (l.duration_ms || 0), 0) / logs.length) : 0;

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/settings/ai">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Activity className="w-6 h-6 text-primary" /> AI Request Execution Logs
            </h1>
            <p className="text-foreground-secondary mt-1">
              Audit log of all LLM and Rule-Based engine requests, token usage, and execution latency
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          className="h-10"
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
        >
          <Download className="w-4 h-4 mr-2" />
          Export CSV Logs
        </Button>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold text-foreground">{logs.length}</p>
              <p className="text-xs text-foreground-secondary mt-0.5">Total AI Requests</p>
            </div>
            <div className="p-2.5 rounded-xl bg-primary/10">
              <Activity className="w-5 h-5 text-primary" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold text-success">{successCount}</p>
              <p className="text-xs text-foreground-secondary mt-0.5">Successful Executions</p>
            </div>
            <div className="p-2.5 rounded-xl bg-success/10">
              <CheckCircle2 className="w-5 h-5 text-success" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold text-info font-mono">{totalTokens.toLocaleString()}</p>
              <p className="text-xs text-foreground-secondary mt-0.5">Total Tokens Consumed</p>
            </div>
            <div className="p-2.5 rounded-xl bg-info/10">
              <Zap className="w-5 h-5 text-info" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold text-warning font-mono">{avgDuration} ms</p>
              <p className="text-xs text-foreground-secondary mt-0.5">Average Response Time</p>
            </div>
            <div className="p-2.5 rounded-xl bg-warning/10">
              <Clock className="w-5 h-5 text-warning" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Table Card ── */}
      <Card className="border-0 shadow-sm">
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
