"use client";

import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  Clock,
  Shield,
  ShieldCheck,
  User,
  Users,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ----------------------------------------------------------------------
// Constants & Fallbacks matching visual source of truth (media_1788665666304.png)
// ----------------------------------------------------------------------

export const DEFAULT_USAGE_DATA = [
  { date: "Aug 5", bookings: 100, trips: 58, maintenance: 42, logins: 30 },
  { date: "Aug 7", bookings: 65, trips: 32, maintenance: 22, logins: 26 },
  { date: "Aug 10", bookings: 90, trips: 54, maintenance: 36, logins: 33 },
  { date: "Aug 12", bookings: 75, trips: 38, maintenance: 24, logins: 20 },
  { date: "Aug 14", bookings: 145, trips: 70, maintenance: 44, logins: 36 },
  { date: "Aug 16", bookings: 120, trips: 65, maintenance: 28, logins: 24 },
  { date: "Aug 18", bookings: 160, trips: 80, maintenance: 38, logins: 22 },
  { date: "Aug 20", bookings: 92, trips: 48, maintenance: 30, logins: 24 },
  { date: "Aug 22", bookings: 105, trips: 58, maintenance: 45, logins: 36 },
  { date: "Aug 24", bookings: 120, trips: 60, maintenance: 40, logins: 28 },
  { date: "Aug 26", bookings: 155, trips: 85, maintenance: 46, logins: 35 },
  { date: "Aug 28", bookings: 105, trips: 60, maintenance: 38, logins: 28 },
  { date: "Aug 30", bookings: 120, trips: 72, maintenance: 42, logins: 26 },
  { date: "Aug 31", bookings: 148, trips: 88, maintenance: 44, logins: 24 },
  { date: "Sep 2", bookings: 140, trips: 78, maintenance: 44, logins: 28 },
  { date: "Sep 4", bookings: 155, trips: 90, maintenance: 40, logins: 24 },
  { date: "Sep 6", bookings: 178, trips: 100, maintenance: 45, logins: 22 },
];

export const DEFAULT_SERVICES = [
  { name: "Web Application", status: "Operational", uptime: "99.9%" },
  { name: "Database (Supabase)", status: "Operational", uptime: "99.9%" },
  { name: "API Services", status: "Operational", uptime: "99.8%" },
  { name: "File Storage", status: "Operational", uptime: "99.9%" },
  { name: "Push Notifications", status: "Operational", uptime: "99.7%" },
  { name: "Maps & Location (TomTom)", status: "Operational", uptime: "99.8%" },
  { name: "Background Jobs", status: "Operational", uptime: "99.9%" },
];

export const DEFAULT_ROLE_DISTRIBUTION = [
  { name: "Unassigned", count: 48, color: "#38bdf8" },
  { name: "driver", count: 8, color: "#a855f7" },
  { name: "fleet manager", count: 3, color: "#f87171" },
  { name: "dispatcher", count: 2, color: "#fb7185" },
  { name: "admin", count: 1, color: "#2563eb" },
  { name: "management", count: 1, color: "#c084fc" },
  { name: "system admin", count: 1, color: "#f59e0b" },
];

export const DEFAULT_DISABLED_ROLES = [
  "concierge",
  "resto resto",
  "reception reception",
];

export const DEFAULT_SYSTEM_ACTIVITIES = [
  {
    time: "6:20 PM",
    user: "Maria Santos",
    initials: "MS",
    action: "Updated",
    actionTone: "blue",
    module: "Vehicle",
    details: "Vehicle ABC-1234 status changed to Under Maintenance",
  },
  {
    time: "6:15 PM",
    user: "Juan Dela Cruz",
    initials: "JD",
    action: "Assigned",
    actionTone: "purple",
    module: "Dispatch",
    details: "Trip #TRP-2026-0912 assigned to Driver Juan Dela Cruz",
  },
  {
    time: "5:48 PM",
    user: "System",
    initials: "SY",
    action: "Completed",
    actionTone: "green",
    module: "Maintenance",
    details: "Work order #WO-2026-008 marked as completed",
  },
  {
    time: "5:32 PM",
    user: "Alex Reyes",
    initials: "AR",
    action: "Created",
    actionTone: "teal",
    module: "User Management",
    details: "New driver account created",
  },
  {
    time: "4:18 PM",
    user: "System",
    initials: "SY",
    action: "Alert",
    actionTone: "red",
    module: "GPS",
    details: "Vehicle XYZ-5678 lost GPS signal",
  },
];

export const DEFAULT_ERRORS = [
  {
    id: "err-1",
    severity: "CRITICAL",
    title: "Push notification delivery failed",
    occurrences: 3,
    lastSeen: "8 min ago",
  },
  {
    id: "err-2",
    severity: "ERROR",
    title: "AI report generation timeout",
    occurrences: 2,
    lastSeen: "24 min ago",
  },
  {
    id: "err-3",
    severity: "WARNING",
    title: "High database query latency",
    occurrences: 5,
    lastSeen: "1 hour ago",
  },
  {
    id: "err-4",
    severity: "ERROR",
    title: "Map service rate limit reached",
    occurrences: 1,
    lastSeen: "2 hours ago",
  },
];

export const DEFAULT_AUDIT_LOGS = [
  {
    id: "audit-1",
    type: "security",
    event: "login_success · authentication#48",
    actor: "System process",
    time: "Sep 6 · 9:18 AM",
  },
  {
    id: "audit-2",
    type: "user",
    event: "role_updated",
    actor: "Admin User → driver",
    time: "Sep 5 · 4:21 PM",
  },
];

// ----------------------------------------------------------------------
// Custom Chart Tooltip
// ----------------------------------------------------------------------
function CustomUsageTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white/95 dark:border-slate-800 dark:bg-slate-900/95 p-3 shadow-lg backdrop-blur-xs text-xs space-y-1.5">
      <p className="font-bold text-slate-800 dark:text-slate-200 mb-1">{label}</p>
      {payload.map((item) => (
        <div key={item.dataKey} className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
            <span className="text-slate-500 dark:text-slate-400 capitalize">{item.name}</span>
          </div>
          <span className="font-bold font-data text-slate-900 dark:text-white tabular-nums">
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------
// 1. System Usage Overview Card
// ----------------------------------------------------------------------
export function SystemUsageOverviewCard({ data = [] }) {
  return (
    <Card className="rounded-2xl sm:rounded-3xl border border-slate-200/70 dark:border-border/70 bg-white dark:bg-surface p-5 sm:p-6 shadow-xs flex flex-col justify-between">
      <CardContent className="p-0 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-50 dark:bg-sky-950/40 text-sky-500 border border-sky-100 dark:border-sky-900/40 shadow-2xs">
              <svg className="h-5 w-5 text-sky-500" viewBox="0 0 20 20" fill="currentColor">
                <rect x="3.5" y="10" width="2.5" height="7" rx="1.25" />
                <rect x="8.75" y="4" width="2.5" height="13" rx="1.25" />
                <rect x="14" y="8" width="2.5" height="9" rx="1.25" />
              </svg>
            </div>
            <div>
              <h3 className="text-[15px] sm:text-base font-bold text-slate-900 dark:text-white tracking-tight">
                System Usage Overview
              </h3>
              <p className="text-xs text-slate-400 font-normal mt-0.5">
                Key activities across the system (Last 30 days)
              </p>
            </div>
          </div>

          <span
            className="rounded-full border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 px-3 py-1 text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
          >
            Last 30 days
          </span>
        </div>

        {/* Chart */}
        <div className="h-64 sm:h-72 w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 12, right: 12, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis
                dataKey="date"
                stroke="#94a3b8"
                fontSize={10}
                tickLine={false}
                axisLine={{ stroke: "#e2e8f0" }}
                dy={6}
              />
              <YAxis
                stroke="#94a3b8"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                domain={[0, (dataMax) => Math.max(10, Math.ceil((dataMax || 10) * 1.2))]}
              />
              <Tooltip content={<CustomUsageTooltip />} />
              <Line
                type="monotone"
                dataKey="bookings"
                name="Bookings"
                stroke="#2563eb"
                strokeWidth={2}
                dot={{ r: 3, fill: "#2563eb", strokeWidth: 1.5, stroke: "#fff" }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                dataKey="trips"
                name="Trips Completed"
                stroke="#10b981"
                strokeWidth={2}
                dot={{ r: 3, fill: "#10b981", strokeWidth: 1.5, stroke: "#fff" }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                dataKey="maintenance"
                name="Maintenance"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={{ r: 3, fill: "#f59e0b", strokeWidth: 1.5, stroke: "#fff" }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                dataKey="logins"
                name="User Logins"
                stroke="#8b5cf6"
                strokeWidth={2}
                dot={{ r: 3, fill: "#8b5cf6", strokeWidth: 1.5, stroke: "#fff" }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center justify-center gap-5 pt-1 text-xs font-medium text-slate-600 dark:text-slate-300">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#2563eb]" />
            <span>Bookings</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#10b981]" />
            <span>Trips Completed</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#f59e0b]" />
            <span>Maintenance</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#8b5cf6]" />
            <span>User Logins</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------
// 2. System Health Card
//
// Data contract: fed by GET /api/system/health rows (mapped at the call
// site to { name, status, uptime }), with real activity telemetry as the
// loading fallback. Missing data renders unavailable, never synthetic uptime.
// Footer routes to the System Health module — the card detects, the module
// remediates; the card itself fixes nothing.
// ----------------------------------------------------------------------
const HEALTH_TONE = {
  degraded: "rose",
  down: "rose",
  attention: "amber",
  unknown: "amber",
};

/**
 * Tone lookup for the System Health card, keyed by LEVEL (not color).
 * A previous revision keyed this object by color names while indexing by
 * level — `toneClasses.tile` blew up with "cannot read properties of
 * undefined" on every healthy render. This helper is unit-tested for every
 * level plus garbage input (which falls back to attention-amber, never green
 * and never undefined).
 */
export function healthToneClasses(level) {
  const tones = {
    degraded: {
      tile: "bg-rose-50 dark:bg-rose-950/40 text-rose-500 border-rose-100 dark:border-rose-900/40",
      icon: "text-rose-500",
      pill: "bg-rose-50/90 dark:bg-rose-950/40 border-rose-200/70 dark:border-rose-800/60 text-rose-700 dark:text-rose-300",
      dot: "bg-rose-500",
      text: "text-rose-600 dark:text-rose-400",
    },
    attention: {
      tile: "bg-amber-50 dark:bg-amber-950/40 text-amber-500 border-amber-100 dark:border-amber-900/40",
      icon: "text-amber-500",
      pill: "bg-amber-50/90 dark:bg-amber-950/40 border-amber-200/70 dark:border-amber-800/60 text-amber-700 dark:text-amber-300",
      dot: "bg-amber-500",
      text: "text-amber-600 dark:text-amber-400",
    },
    healthy: {
      tile: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-500 border-emerald-100 dark:border-emerald-900/40",
      icon: "text-emerald-500",
      pill: "bg-emerald-50/90 dark:bg-emerald-950/40 border-emerald-200/70 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300",
      dot: "bg-emerald-500",
      text: "text-emerald-600 dark:text-emerald-400",
    },
  };
  return tones[level] || tones.attention;
}

export function SystemHealthCard({
  services = [],
  statusLabel,
}) {
  const activeServices = services || [];
  const unavailable = activeServices.length === 0;
  const toneOf = (s) => HEALTH_TONE[String(s?.status || "").toLowerCase()] || "emerald";
  const tones = activeServices.map(toneOf);
  const level = unavailable ? "attention" : tones.includes("rose") ? "degraded" : tones.includes("amber") ? "attention" : "healthy";
  const computedLabel = statusLabel || (unavailable ? "Unavailable" : level === "degraded" ? "Degraded" : level === "attention" ? "Attention" : "Healthy");

  const toneClasses = healthToneClasses(level);

  return (
    <Card className="rounded-2xl sm:rounded-3xl border border-slate-200/70 dark:border-border/70 bg-white dark:bg-surface p-5 sm:p-6 shadow-xs flex flex-col justify-between">
      <CardContent className="p-0 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border shadow-2xs",
              toneClasses.tile
            )}>
              <Activity className={cn("h-5 w-5", toneClasses.icon)} strokeWidth={2} />
            </div>
            <div>
              <h3 className="text-[15px] sm:text-base font-bold text-slate-900 dark:text-white tracking-tight">
                System Health
              </h3>
              <p className="text-xs text-slate-400 font-normal mt-0.5">
                {unavailable
                  ? "Health data could not be loaded."
                  : level === "degraded"
                  ? "Service degradation detected."
                  : level === "attention"
                    ? "Some subsystems need attention."
                    : "All core services are operational."}
              </p>
            </div>
          </div>

          <span className={cn(
            "inline-flex items-center gap-1.5 rounded-full border text-xs font-semibold px-2.5 py-0.5 shadow-2xs",
            toneClasses.pill
          )}>
            <span className={cn("h-1.5 w-1.5 rounded-full", toneClasses.dot)} />
            {computedLabel}
          </span>
        </div>

        {/* Services List */}
        <div className="divide-y divide-slate-100 dark:divide-slate-800/80 pt-1">
          {activeServices.map((srv) => {
            const rowTone = toneOf(srv);
            const dotClass =
              rowTone === "rose" ? "bg-rose-500" : rowTone === "amber" ? "bg-amber-500" : "bg-emerald-500";
            const textClass =
              rowTone === "rose"
                ? "text-rose-600 dark:text-rose-400"
                : rowTone === "amber"
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400";
            return (
              <div key={srv.name} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={cn("h-2 w-2 rounded-full shrink-0", dotClass)} />
                  <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                    {srv.name}
                  </span>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <span className={cn("font-medium", textClass)}>
                    {srv.status}
                  </span>
                  {srv.uptime ? (
                    <span className="font-data font-bold text-slate-900 dark:text-white tabular-nums min-w-[3.5rem] shrink-0 text-right">
                      {srv.uptime}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
          {unavailable ? (
            <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              Open System Health to retry the subsystem checks.
            </p>
          ) : null}
        </div>

        {/* Footer Link — routes to the System Health module, which owns remediation */}
        <div className="border-t border-slate-100 dark:border-slate-800/80 pt-3">
          <Link
            href="/system/health"
            className="flex items-center justify-between text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors group"
          >
            <span>Open System Health</span>
            <ArrowRight className="h-3.5 w-3.5 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------
// 3. Account Posture Card
// ----------------------------------------------------------------------
export function AccountPostureCard({
  roles = [],
  totalAccounts = 0,
  disabledRoles = [],
  disabledExtra = 0,
}) {
  return (
    <Card className="rounded-2xl sm:rounded-3xl border border-slate-200/70 dark:border-border/70 bg-white dark:bg-surface p-5 sm:p-6 shadow-xs flex flex-col justify-between">
      <CardContent className="p-0 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-500 border border-indigo-100 dark:border-indigo-900/40 shadow-2xs">
            <Users className="h-5 w-5 text-indigo-500" strokeWidth={2} />
          </div>
          <div>
            <h3 className="text-[15px] sm:text-base font-bold text-slate-900 dark:text-white tracking-tight">
              Account Posture
            </h3>
            <p className="text-xs text-slate-400 font-normal mt-0.5">
              Role distribution across all employee accounts.
            </p>
          </div>
        </div>

        {/* Main Donut & Legend */}
        <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] items-center gap-4 pt-1">
          {/* Donut Chart with Center Total */}
          <div className="relative flex items-center justify-center h-[140px] w-[140px] mx-auto">
            <ResponsiveContainer width={140} height={140}>
              <PieChart>
                <Pie
                  data={roles}
                  cx="50%"
                  cy="50%"
                  innerRadius={48}
                  outerRadius={68}
                  paddingAngle={2}
                  dataKey="count"
                  strokeWidth={0}
                >
                  {roles.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
              <span className="font-data text-2xl font-bold text-slate-900 dark:text-white leading-none">
                {totalAccounts}
              </span>
              <span className="text-[10px] text-slate-400 font-normal mt-1">
                Total accounts
              </span>
            </div>
          </div>

          {/* Role Counts List beside Donut */}
          <div className="space-y-1.5">
            {roles.map((item) => (
              <div key={item.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                  <span className="text-slate-600 dark:text-slate-300 font-medium truncate capitalize">
                    {item.name}
                  </span>
                </div>
                <span className="font-data font-bold text-slate-900 dark:text-white tabular-nums shrink-0 ml-2">
                  {item.count}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Divider & Disabled Roles */}
        <div className="border-t border-slate-100 dark:border-slate-800/80 pt-3">
          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider mb-2">
            Disabled roles
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {disabledRoles.map((role) => (
              <Link
                key={role}
                href="/settings/users"
                className="rounded-full bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200/60 dark:border-amber-900/40 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors"
              >
                {role}
              </Link>
            ))}
            {disabledExtra > 0 && (
              <Link
                href="/settings/users"
                className="rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                +{disabledExtra} more
              </Link>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------
// 4. Recent System Activities Card
// ----------------------------------------------------------------------
const ACTION_TONE_STYLES = {
  blue: "bg-blue-50 text-blue-600 border-blue-200/60 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900/40",
  purple: "bg-purple-50 text-purple-600 border-purple-200/60 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-900/40",
  green: "bg-emerald-50 text-emerald-600 border-emerald-200/60 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900/40",
  teal: "bg-teal-50 text-teal-600 border-teal-200/60 dark:bg-teal-950/40 dark:text-teal-400 dark:border-teal-900/40",
  red: "bg-rose-50 text-rose-600 border-rose-200/60 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900/40",
};

export function RecentSystemActivitiesCard({ activities = [] }) {
  return (
    <Card className="rounded-2xl sm:rounded-3xl border border-slate-200/70 dark:border-border/70 bg-white dark:bg-surface p-5 sm:p-6 shadow-xs flex flex-col justify-between">
      <CardContent className="p-0 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-50 dark:bg-sky-950/40 text-sky-500 border border-sky-100 dark:border-sky-900/40 shadow-2xs">
              <svg className="h-5 w-5 text-sky-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <h3 className="text-[15px] sm:text-base font-bold text-slate-900 dark:text-white tracking-tight">
                Recent System Activities
              </h3>
              <p className="text-xs text-slate-400 font-normal mt-0.5">
                Latest important actions across the system
              </p>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            asChild
            className="rounded-full border-slate-200/80 dark:border-slate-700 h-8 px-3 text-xs font-semibold"
          >
            <Link href="/system/audit">View all</Link>
          </Button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 border-b border-slate-100 dark:border-slate-800/80">
                <th className="py-2 pr-4 font-bold">TIME</th>
                <th className="py-2 px-3 font-bold">USER</th>
                <th className="py-2 px-3 font-bold">ACTION</th>
                <th className="py-2 px-3 font-bold">MODULE</th>
                <th className="py-2 pl-3 font-bold">DETAILS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
              {activities.map((row, index) => (
                <tr key={index} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  {/* TIME */}
                  <td className="py-2.5 pr-4 text-slate-400 font-data whitespace-nowrap">
                    {row.time}
                  </td>
                  {/* USER */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300 font-bold text-[10px]">
                        {row.initials}
                      </span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {row.user}
                      </span>
                    </div>
                  </td>
                  {/* ACTION */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold",
                        ACTION_TONE_STYLES[row.actionTone] || ACTION_TONE_STYLES.blue
                      )}
                    >
                      {row.action}
                    </span>
                  </td>
                  {/* MODULE */}
                  <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 font-medium whitespace-nowrap">
                    {row.module}
                  </td>
                  {/* DETAILS */}
                  <td className="py-2.5 pl-3 text-slate-500 dark:text-slate-400 max-w-xs truncate">
                    {row.details}
                  </td>
                </tr>
              ))}
              {activities.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                    No recent system activity.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------
// 5. Recent Errors Card
// ----------------------------------------------------------------------
const ERROR_SEVERITY_STYLES = {
  CRITICAL: "bg-rose-50 text-rose-700 border-rose-200/80 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-900/50",
  ERROR: "bg-orange-50 text-orange-700 border-orange-200/80 dark:bg-orange-950/50 dark:text-orange-300 dark:border-orange-900/50",
  WARNING: "bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900/50",
};

export function RecentErrorsCard({ errors = [] }) {
  return (
    <Card className="rounded-2xl sm:rounded-3xl border border-slate-200/70 dark:border-border/70 bg-white dark:bg-surface p-5 sm:p-6 shadow-xs flex flex-col justify-between">
      <CardContent className="p-0 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-500 border border-rose-100 dark:border-rose-900/40 shadow-2xs">
              <AlertTriangle className="h-5 w-5 text-rose-500" strokeWidth={2} />
            </div>
            <h3 className="text-[15px] sm:text-base font-bold text-slate-900 dark:text-white tracking-tight">
              Recent Errors
            </h3>
          </div>

          <Button
            variant="outline"
            size="sm"
            asChild
            className="rounded-full border-slate-200/80 dark:border-slate-700 h-8 px-3 text-xs font-semibold"
          >
            <Link href="/system/errors">View all</Link>
          </Button>
        </div>

        {/* Error Items */}
        <div className="divide-y divide-slate-100 dark:divide-slate-800/80 pt-1">
          {errors.map((err) => (
            <Link
              key={err.id}
              href="/system/errors"
              className="py-3 flex items-center justify-between gap-3 group hover:bg-slate-50/50 dark:hover:bg-slate-800/30 -mx-2 px-2 rounded-lg transition-colors"
            >
              <div className="flex items-start gap-3 min-w-0">
                <span
                  className={cn(
                    "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold shrink-0 mt-0.5",
                    ERROR_SEVERITY_STYLES[err.severity] || ERROR_SEVERITY_STYLES.ERROR
                  )}
                >
                  {err.severity}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-900 dark:text-white tracking-tight truncate">
                    {err.title}
                  </p>
                  <p className="text-[11px] text-slate-400 font-normal mt-0.5">
                    {err.occurrences} {err.occurrences === 1 ? "occurrence" : "occurrences"} · Last seen {err.lastSeen}
                  </p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
            </Link>
          ))}
          {errors.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No active errors.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------
// 6. Recent Security and Change Audit Card
// ----------------------------------------------------------------------
export function RecentSecurityAuditCard({ logs = [] }) {
  return (
    <Card className="rounded-2xl sm:rounded-3xl border border-slate-200/70 dark:border-border/70 bg-white dark:bg-surface p-5 sm:p-6 shadow-xs flex flex-col justify-between">
      <CardContent className="p-0 space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-500 border border-emerald-100 dark:border-emerald-900/40 shadow-2xs">
              <ShieldCheck className="h-5 w-5 text-emerald-500" strokeWidth={2} />
            </div>
            <div>
              <h3 className="text-[15px] sm:text-base font-bold text-slate-900 dark:text-white tracking-tight">
                Recent Security and Change Audit
              </h3>
              <p className="text-xs text-slate-400 font-normal mt-0.5">
                Actor, action, target and timestamp from the immutable audit trail.
              </p>
            </div>
          </div>

          <Link
            href="/system/audit"
            className="text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-1 shrink-0 self-start sm:self-auto"
          >
            <span>Open full audit</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {/* Audit Rows */}
        <div className="divide-y divide-slate-100 dark:divide-slate-800/80 pt-1">
          {logs.map((item) => (
            <div key={item.id} className="py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">
                  {item.type === "security" ? (
                    <Shield className="h-4 w-4" />
                  ) : (
                    <User className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900 dark:text-white tracking-tight truncate">
                    {item.event}
                  </p>
                  <p className="text-[11px] text-slate-400 font-normal mt-0.5">
                    {item.actor}
                  </p>
                </div>
              </div>
              <span className="text-xs font-medium text-slate-400 font-data whitespace-nowrap shrink-0">
                {item.time}
              </span>
            </div>
          ))}
          {logs.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No recent audit activity.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
