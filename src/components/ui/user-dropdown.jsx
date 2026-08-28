"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { getInitials, cn } from "@/lib/utils";
import { SIDEBAR_MODES, useSidebar } from "@/hooks/use-sidebar";
import {
  User,
  Lock,
  LogOut,
  ChevronUp,
  ChevronDown,
  PanelLeft,
  Check,
  ChevronRight,
  ShieldCheck,
  CarFront,
  Clock,
  Calendar,
  Ban,
} from "lucide-react";

function formatRole(role) {
  if (!role) return "User";
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function UserDropdown({ employee, signOut, side = "bottom", align = "end", children, chevron, triggerClassName }) {
  const [open, setOpen] = useState(false);
  const [behaviorOpen, setBehaviorOpen] = useState(false);
  const router = useRouter();
  const { mode, setMode } = useSidebar();

  const activeMode = SIDEBAR_MODES.find((m) => m.value === mode) || SIDEBAR_MODES[0];

  const name = employee
    ? `${employee.first_name} ${employee.last_name}`
    : "Fleet Administrator";
  const email = employee?.email || "admin@fleet.com";
  const role = employee?.roles?.role_name || "admin";
  const isDriver = role === "driver";
  const statusText = isDriver ? employee?.driver_status || "Available" : employee?.status || "Active";

  let statusColor = "text-success";
  let statusBg = "bg-success";
  let StatusIcon = ShieldCheck;

  if (statusText === "On Trip") {
    statusColor = "text-warning";
    statusBg = "bg-warning";
    StatusIcon = CarFront;
  } else if (statusText === "Off Duty" || statusText === "Inactive") {
    statusColor = "text-foreground-muted";
    statusBg = "bg-foreground-muted";
    StatusIcon = Clock;
  } else if (statusText === "On Leave") {
    statusColor = "text-foreground-muted";
    statusBg = "bg-foreground-muted";
    StatusIcon = Calendar;
  } else if (statusText === "Suspended") {
    statusColor = "text-danger";
    statusBg = "bg-danger";
    StatusIcon = Ban;
  }

  const ChevronIcon = chevron === "up" ? ChevronUp : ChevronDown;

  const defaultContent = (
    <Avatar className="h-7 w-7">
      <AvatarFallback className="bg-hover text-foreground-secondary text-[11px]">
        {employee ? getInitials(name) : "FF"}
      </AvatarFallback>
    </Avatar>
  );

  const handleLogout = async () => {
    try {
      if (typeof signOut === "function") {
        await signOut();
      }
    } catch (e) {
      console.error("Signout error:", e);
    } finally {
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
    }
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setBehaviorOpen(false);
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-1.5 outline-none cursor-pointer transition-colors duration-150",
            open && "bg-hover rounded-md",
            triggerClassName
          )}
        >
          {children || defaultContent}
          {chevron && (
            <ChevronIcon
              className={cn(
                "h-4 w-4 text-foreground-muted transition-transform duration-150 flex-shrink-0",
                open && "rotate-180"
              )}
            />
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side={side}
        align={align}
        className="w-64 rounded-xl p-2 border border-border/80 bg-surface shadow-xl space-y-1 select-none"
      >
        {/* ── USER PROFILE HEADER (MATCHES SIDE NAV NORMAL TEXT) ── */}
        <div className="p-3 rounded-lg bg-hover/40 border border-border/60 flex items-center gap-3">
          <div className="relative shrink-0">
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-hover text-foreground-secondary text-xs font-medium">
                {employee ? getInitials(name) : "FF"}
              </AvatarFallback>
            </Avatar>
            <span className={cn("absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-surface", statusBg)} />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate leading-snug">
              {name}
            </p>
            <p className="text-xs text-foreground-muted truncate mt-0.5">
              {email}
            </p>
            <div className="flex items-center gap-1.5 mt-1.5">
              <Badge variant="outline" className="text-[11px] font-medium px-2 py-0">
                {formatRole(role)}
              </Badge>
              <span className={cn("text-[11px] font-medium inline-flex items-center gap-1", statusColor)}>
                <StatusIcon className="w-3 h-3" /> {statusText}
              </span>
            </div>
          </div>
        </div>

        <DropdownMenuSeparator className="my-1 bg-border/60" />

        {/* ── MENU ITEMS (EXACT SAME TEXT STYLE AS SIDE NAV) ── */}
        <div className="space-y-0.5">
          <DropdownMenuItem
            onClick={() => router.push("/settings/profile")}
            className="rounded-md px-3 py-2 text-sm text-foreground-secondary hover:text-foreground hover:bg-hover focus:text-foreground focus:bg-hover cursor-pointer flex items-center justify-between group transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <User className="h-4 w-4 text-foreground-secondary group-hover:text-foreground" />
              <span>Edit Profile</span>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-foreground-muted group-hover:text-foreground group-hover:translate-x-0.5 transition-transform" />
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => router.push("/settings/security")}
            className="rounded-md px-3 py-2 text-sm text-foreground-secondary hover:text-foreground hover:bg-hover focus:text-foreground focus:bg-hover cursor-pointer flex items-center justify-between group transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <Lock className="h-4 w-4 text-foreground-secondary group-hover:text-foreground" />
              <span>Change Password</span>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-foreground-muted group-hover:text-foreground group-hover:translate-x-0.5 transition-transform" />
          </DropdownMenuItem>

          {/* Radix closes the menu on item select, so this row is a plain button
              that expands the mode list in place instead. */}
          <button
            type="button"
            onClick={() => setBehaviorOpen((v) => !v)}
            className="w-full rounded-md px-3 py-2 text-sm text-foreground-secondary hover:text-foreground hover:bg-hover cursor-pointer flex items-center justify-between group transition-colors outline-none"
          >
            <div className="flex items-center gap-2.5">
              <PanelLeft className="h-4 w-4 text-foreground-secondary group-hover:text-foreground" />
              <span>Sidebar Behavior</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-foreground-muted">{activeMode.label}</span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 text-foreground-muted transition-transform",
                  behaviorOpen && "rotate-180"
                )}
              />
            </div>
          </button>

          {behaviorOpen && (
            <div className="ml-3 space-y-0.5 border-l border-border/60 pl-2">
              {SIDEBAR_MODES.map((m) => {
                const selected = m.value === mode;
                return (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setMode(m.value)}
                    className={cn(
                      "w-full rounded-md px-2.5 py-1.5 text-left cursor-pointer flex items-center gap-2.5 transition-colors outline-none",
                      selected
                        ? "bg-hover text-foreground"
                        : "text-foreground-secondary hover:text-foreground hover:bg-hover"
                    )}
                  >
                    <m.icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm leading-tight">{m.label}</span>
                      <span className="block text-[11px] text-foreground-muted truncate">
                        {m.description}
                      </span>
                    </span>
                    {selected && <Check className="h-3.5 w-3.5 shrink-0 text-success" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <DropdownMenuSeparator className="my-1 bg-border/60" />

        {/* ── LOGOUT ACTION ── */}
        <DropdownMenuItem
          onClick={handleLogout}
          className="rounded-md px-3 py-2 text-sm font-medium text-danger hover:bg-danger/10 focus:bg-danger/10 focus:text-danger cursor-pointer flex items-center justify-between group transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <LogOut className="h-4 w-4 text-danger" />
            <span>Logout Account</span>
          </div>
          <ChevronRight className="h-3.5 w-3.5 text-danger opacity-70 group-hover:translate-x-0.5 transition-transform" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
