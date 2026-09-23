"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HeroHeader } from "@/components/ui/hero-header";
import { PageEntrance } from "@/components/ui/page-entrance";
import { useRequireRole } from "@/lib/auth/role-guard";
import { apiFetch } from "@/lib/api/client";
import { getAuditLogs } from "@/services/audit.service";
import { getSystemHealth } from "@/services/system-health.service";
import { Fingerprint, BellRing, UserCog, Activity, ArrowRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

// Security Center (Super Admin only) — v1 composes data the platform already
// collects. No new subsystem: security alerts, privileged account audit trail,
// system health, and a link to session management.
function timeAgo(value) {
  if (!value) return "—";
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return "—";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function SecurityCenterPage() {
  useRequireRole();

  const alerts = useQuery({
    queryKey: ["security-alerts"],
    queryFn: () => apiFetch("/api/system/security-alerts"),
  });
  const privileged = useQuery({
    queryKey: ["security-privileged-activity"],
    queryFn: () => getAuditLogs({ resource: "employees", limit: 20 }),
  });
  const health = useQuery({
    queryKey: ["security-system-health"],
    queryFn: () => getSystemHealth(),
    refetchInterval: 60000,
  });

  const alertRows = alerts.data?.alerts ?? [];
  const privilegedRows = privileged.data?.logs ?? [];
  const healthRows = health.data?.services ?? health.data?.checks ?? [];

  return (
    <PageEntrance className="space-y-6">
      <HeroHeader
        icon={Fingerprint}
        title="Security Center"
        badge="Super Admin"
        description="Authentication signals, privileged account activity, and platform security posture in one place."
      />

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-sm font-extrabold flex items-center gap-2 text-foreground">
                  <BellRing className="w-4 h-4 text-primary" /> Security Alerts
                </CardTitle>
                <CardDescription className="text-xs text-foreground-secondary mt-1">
                  Failed logins, lockouts, and authentication anomalies.
                </CardDescription>
              </div>
              <Button variant="ghost" size="xs" className="rounded-xl h-7" onClick={() => alerts.refetch()} disabled={alerts.isFetching}>
                <RefreshCw className={cn("w-3.5 h-3.5", alerts.isFetching && "animate-spin")} />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {alerts.isLoading ? (
              <p className="px-4 py-6 text-xs text-foreground-muted">Loading alerts…</p>
            ) : alertRows.length === 0 ? (
              <p className="px-4 py-6 text-xs text-foreground-muted">No security alerts recorded. Failed privileged logins and lockouts will appear here.</p>
            ) : (
              <div className="divide-y divide-border/50">
                {alertRows.slice(0, 10).map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold text-foreground truncate">{a.type || "security_alert"}</p>
                      <p className="text-[11px] text-foreground-muted truncate">{a.email || `employee #${a.employee_id ?? "—"}`} · {a.ip_address || "no IP"}</p>
                    </div>
                    <span className="shrink-0 text-[11px] text-foreground-muted">{timeAgo(a.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-sm font-extrabold flex items-center gap-2 text-foreground">
                  <UserCog className="w-4 h-4 text-primary" /> Privileged Activity
                </CardTitle>
                <CardDescription className="text-xs text-foreground-secondary mt-1">
                  Account creation, role changes, disables, and credential resets.
                </CardDescription>
              </div>
              <Button variant="ghost" size="xs" className="rounded-xl h-7" asChild>
                <Link href="/system/audit">Full audit <ArrowRight className="w-3 h-3 ml-1" /></Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {privileged.isLoading ? (
              <p className="px-4 py-6 text-xs text-foreground-muted">Loading activity…</p>
            ) : privilegedRows.length === 0 ? (
              <p className="px-4 py-6 text-xs text-foreground-muted">No account activity recorded yet.</p>
            ) : (
              <div className="divide-y divide-border/50">
                {privilegedRows.slice(0, 10).map((l) => (
                  <div key={l.log_id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold text-foreground truncate">
                        {l.action} <span className="font-normal text-foreground-muted">· {l.resource}</span>
                      </p>
                      <p className="text-[11px] text-foreground-muted truncate">
                        {[l.first_name, l.last_name].filter(Boolean).join(" ") || l.email || "system"} · #{l.resource_id ?? "—"}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] text-foreground-muted">{timeAgo(l.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-sm font-extrabold flex items-center gap-2 text-foreground">
                  <Activity className="w-4 h-4 text-primary" /> System Security Posture
                </CardTitle>
                <CardDescription className="text-xs text-foreground-secondary mt-1">
                  Live platform service state behind the security boundary.
                </CardDescription>
              </div>
              <Button variant="ghost" size="xs" className="rounded-xl h-7" asChild>
                <Link href="/system/health">System Health <ArrowRight className="w-3 h-3 ml-1" /></Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {health.isLoading ? (
              <p className="px-4 py-6 text-xs text-foreground-muted">Checking services…</p>
            ) : healthRows.length === 0 ? (
              <p className="px-4 py-6 text-xs text-foreground-muted">
                {(health.data?.status || health.data?.overall || "Status unavailable")}.
              </p>
            ) : (
              <div className="divide-y divide-border/50">
                {healthRows.map((s, i) => (
                  <div key={s.id || s.name || i} className="flex items-center justify-between gap-3 px-4 py-3">
                    <p className="text-[13px] font-bold text-foreground">{s.name || s.id || "service"}</p>
                    <Badge variant={String(s.status).toLowerCase() === "healthy" || String(s.status).toLowerCase() === "ok" ? "success" : "warning"}>
                      {s.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
            <CardTitle className="text-sm font-extrabold flex items-center gap-2 text-foreground">
              <Fingerprint className="w-4 h-4 text-primary" /> Sessions & MFA
            </CardTitle>
            <CardDescription className="text-xs text-foreground-secondary mt-1">
              Session revocation and MFA live where the credentials live.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 py-5 space-y-3">
            <p className="text-xs text-foreground-secondary leading-relaxed">
              Disabling an account in User Management immediately revokes its web sessions,
              mobile tokens, and pending reset links. Per-session revocation and MFA setup
              stay on the Security settings page.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="xs" className="rounded-xl h-8" asChild>
                <Link href="/settings/security">Open Security settings <ArrowRight className="w-3 h-3 ml-1" /></Link>
              </Button>
              <Button variant="outline" size="xs" className="rounded-xl h-8" asChild>
                <Link href="/settings/users?view=privileged">Review privileged accounts <ArrowRight className="w-3 h-3 ml-1" /></Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageEntrance>
  );
}
