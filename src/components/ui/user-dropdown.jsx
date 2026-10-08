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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
} from "lucide-react";

export function formatRole(role) {
  if (!role) return "User";
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function UserDropdown({
  employee,
  signOut,
  side = "bottom",
  align = "end",
  children,
  chevron,
  triggerClassName,
  showDetails = false,
}) {
  const [open, setOpen] = useState(false);
  const [behaviorOpen, setBehaviorOpen] = useState(false);
  const router = useRouter();
  const { mode, setMode } = useSidebar();

  const activeMode = SIDEBAR_MODES.find((m) => m.value === mode) || SIDEBAR_MODES[0];

  const name = employee
    ? `${employee.first_name} ${employee.last_name}`
    : "Fleet Administrator";
  const role = employee?.roles?.role_name || "admin";
  const avatarUrl = employee?.face_image_url || employee?.avatar_url || employee?.image || employee?.image_url || null;

  const ChevronIcon = chevron === "up" ? ChevronUp : ChevronDown;

  const defaultContent = showDetails ? (
    <div className="flex items-center gap-2.5 min-w-0">
      <Avatar className="h-8 w-8 shrink-0">
        {avatarUrl ? (
          <AvatarImage
            src={avatarUrl}
            alt={name}
            className="object-cover"
          />
        ) : null}
        <AvatarFallback className="bg-hover text-foreground-secondary text-xs font-semibold">
          {employee ? getInitials(name) : "FF"}
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-col text-left min-w-0">
        <span className="text-xs font-semibold text-foreground truncate max-w-[130px] leading-tight">
          {name}
        </span>
        <span className="text-[11px] text-foreground-muted truncate max-w-[130px] leading-tight">
          {formatRole(role)}
        </span>
      </div>
    </div>
  ) : (
    <Avatar className="h-7 w-7">
      {avatarUrl ? (
        <AvatarImage
          src={avatarUrl}
          alt={name}
          className="object-cover"
        />
      ) : null}
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
            "flex items-center gap-2 outline-none cursor-pointer transition-colors duration-150 select-none",
            showDetails
              ? "px-2 py-1 -mr-1 rounded-lg hover:bg-hover active:bg-hover/80"
              : "hover:bg-hover rounded-md",
            open && "bg-hover",
            triggerClassName
          )}
        >
          {children || defaultContent}
          {chevron && (
            <ChevronIcon
              className={cn(
                "h-3.5 w-3.5 text-foreground-muted transition-transform duration-150 flex-shrink-0",
                open && "rotate-180"
              )}
            />
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side={side}
        align={align}
        className="w-56 rounded-xl p-1.5 border border-border/80 bg-surface shadow-xl space-y-0.5 select-none"
      >
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
