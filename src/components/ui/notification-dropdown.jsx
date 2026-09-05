"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { getNotificationHref } from "@/lib/notifications/target";
import { notificationCategory, severityBadge } from "@/lib/notifications/presentation";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { getNotifications, markAsRead, markAllAsRead } from "@/services/notification.service";
import { formatDate, cn } from "@/lib/utils";
import {
  Bell,
  CheckCheck,
  ChevronRight,
  Info,
  AlertTriangle,
  CheckCircle2,
  CalendarCheck,
  Send,
  Wrench,
  Fuel,
  Route,
} from "lucide-react";
import { toast } from "@/components/ui/toast";

const typeIcons = {
  Info: Info,
  Warning: AlertTriangle,
  Alert: AlertTriangle,
  Success: CheckCircle2,
  Reservation: CalendarCheck,
  Dispatch: Send,
  Maintenance: Wrench,
  Fuel: Fuel,
  Trip: Route,
};

const typeBg = {
  Info: "bg-info/10 text-info",
  Warning: "bg-warning/10 text-warning",
  Alert: "bg-danger/10 text-danger",
  Success: "bg-success/10 text-success",
  Reservation: "bg-primary/10 text-primary",
  Dispatch: "bg-primary/10 text-primary",
  Maintenance: "bg-warning/10 text-warning",
  Fuel: "bg-warning/10 text-warning",
  Trip: "bg-primary/10 text-primary",
};

function toastTypeFor(type) {
  if (type === "Alert" || type === "Warning") return "warning";
  if (type === "Success") return "success";
  return "info";
}

const EASE = [0.32, 0.72, 0, 1];

export function NotificationDropdown() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { employee } = useAuth();
  const role = employee?.roles?.role_name;
  const queryClient = useQueryClient();

  // Bumped on every newly-arrived notification so the bell icon does a quick
  // wiggle, drawing the eye before the toast grows out of it.
  const [bellPulse, setBellPulse] = useState(0);

  const { data: notifications = [], isSuccess } = useQuery({
    queryKey: ["notifications", "header-list"],
    queryFn: () => getNotifications(),
    // Stay current without a page reload: poll every 15s, keep polling in
    // background tabs, and refetch the moment the tab regains focus (the
    // global default is refetchOnWindowFocus: false).
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  // Live pop-up: when a notification we haven't seen before shows up between
  // polls, surface it as a 3-second toast. The seen set is only seeded after
  // the first fetch actually completes — seeding while data is still loading
  // (empty snapshot) would make every historical notification look "new" and
  // flood the screen with old toasts on mount.
  const seenIdsRef = useRef(new Set());
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (!isSuccess) return;
    const ids = new Set(notifications.map((n) => n.notification_id).filter(Boolean));
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true;
      seenIdsRef.current = ids;
      return;
    }
    notifications.forEach((n) => {
      if (!n.notification_id || seenIdsRef.current.has(n.notification_id)) return;
      seenIdsRef.current.add(n.notification_id);
      toast.show({
        type: toastTypeFor(n.type),
        title: n.title,
        message: n.message,
        duration: 3000,
        position: "top-right", // appear right below the notification bell
      });
      setBellPulse((p) => p + 1);
    });
  }, [notifications, isSuccess]);

  const markReadMut = useMutation({
    mutationFn: markAsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const markAllMut = useMutation({
    mutationFn: markAllAsRead,
    onSuccess: () => {
      toast.success("All notifications marked as read");
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  // Dedupe by stable id so two genuinely different notifications with identical
  // text never collapse into one row. Falls back to the content key only when
  // an id is missing, keeping the list stable either way.
  const uniqueNotifications = (notifications || []).filter((notif, index, self) =>
    index === self.findIndex((n) =>
      notif.notification_id && n.notification_id
        ? n.notification_id === notif.notification_id
        : n.message === notif.message && n.title === notif.title
    )
  );

  const unreadCount = uniqueNotifications.filter((n) => !n.is_read).length;

  // Unread first so a fresh unread item is never buried below read ones.
  // Read items stay visible (dimmed) for traceability instead of vanishing.
  const recent = [...uniqueNotifications]
    .sort((a, b) => Number(Boolean(a.is_read)) - Number(Boolean(b.is_read)))
    .slice(0, 5);

  const openNotification = (notif) => {
    if (!notif.is_read) markReadMut.mutate(notif.notification_id);
    const href = getNotificationHref(notif, role);
    setOpen(false);
    if (href) router.push(href);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "group relative flex h-8 w-8 items-center justify-center rounded-lg text-foreground-secondary hover:text-foreground hover:bg-hover transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary",
            open && "bg-hover text-foreground"
          )}
          title="Notifications"
          aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications"}
        >
          <motion.span
            key={bellPulse}
            className="flex items-center justify-center"
            initial={{ rotate: 0, scale: 1 }}
            animate={
              bellPulse > 0
                ? { rotate: [0, -16, 14, -8, 0], scale: [1, 1.2, 1] }
                : { rotate: 0, scale: 1 }
            }
            transition={{ duration: 0.55, ease: EASE }}
          >
            <Bell className="h-[18px] w-[18px] transition-transform duration-200 group-hover:scale-105" />
          </motion.span>

          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-[18px] min-w-[18px] px-1 items-center justify-center rounded-full bg-danger text-[10px] font-bold text-white shadow-[0_2px_8px_rgba(239,68,68,0.45)] ring-2 ring-surface tabular-nums leading-none pointer-events-none">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" className="w-84 sm:w-[410px] p-0 overflow-hidden rounded-[26px] shadow-2xl border border-border/80 bg-surface/95 backdrop-blur-xl">
        {/* Header with Glass Gradient */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/60 bg-gradient-to-r from-muted/30 via-surface to-muted/20">
          <div className="flex items-center gap-2.5">
            <span className="text-[15px] font-extrabold text-foreground tracking-tight">Notifications</span>
            {unreadCount > 0 && (
              <span className="bg-primary/10 text-primary border border-primary/20 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                {unreadCount} new
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              onClick={() => markAllMut.mutate()}
              className="text-[11px] font-bold text-primary hover:text-primary/80 flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Mark all read
            </button>
          )}
        </div>

        {/* List of recent notifications with Luxury Ethereal Floating Cards */}
        <div className="max-h-[380px] overflow-y-auto p-3 space-y-2.5">
          {recent.length === 0 ? (
            <div className="p-8 text-center text-foreground-muted space-y-1.5">
              <div className="w-12 h-12 rounded-2xl bg-muted/40 flex items-center justify-center mx-auto mb-3 text-foreground-muted/60">
                <Bell className="w-6 h-6" />
              </div>
              <p className="text-sm font-bold text-foreground">No notifications</p>
              <p className="text-xs text-foreground-secondary">You&apos;re all caught up!</p>
            </div>
          ) : (
            recent.map((notif) => {
              const category = notificationCategory(notif.reference_type);
              const severity = severityBadge(notif.severity);
              const isUnread = !notif.is_read;
              const type = notif.type === 'Alert' ? 'error' : (notif.type?.toLowerCase() || 'info');

              const cardStyle = {
                info: "from-sky-500/10 via-sky-500/5 to-surface/80 border-sky-500/25",
                success: "from-emerald-500/10 via-emerald-500/5 to-surface/80 border-emerald-500/25",
                warning: "from-amber-500/10 via-amber-500/5 to-surface/80 border-amber-500/25",
                error: "from-rose-500/10 via-rose-500/5 to-surface/80 border-rose-500/25",
              }[type] || "from-sky-500/10 via-sky-500/5 to-surface/80 border-sky-500/25";

              const iconBoxStyle = {
                info: "bg-sky-500/15 border-sky-500/30 text-sky-600 dark:text-sky-400",
                success: "bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
                warning: "bg-amber-500/15 border-amber-500/30 text-amber-600 dark:text-amber-400",
                error: "bg-rose-500/15 border-rose-500/30 text-rose-600 dark:text-rose-400",
              }[type] || "bg-sky-500/15 border-sky-500/30 text-sky-600 dark:text-sky-400";

              return (
                <div
                  key={notif.notification_id}
                  onClick={() => openNotification(notif)}
                  className={cn(
                    "group relative flex items-start gap-3.5 p-3.5 rounded-[18px] bg-gradient-to-r border transition-all duration-300 cursor-pointer shadow-xs hover:shadow-md hover:-translate-y-0.5",
                    cardStyle,
                    isUnread ? "ring-1 ring-primary/40 shadow-sm" : "opacity-70 hover:opacity-100"
                  )}
                >
                  {/* Glowing Squircle Icon Container */}
                  <div className={cn("w-10 h-10 rounded-[12px] border flex items-center justify-center flex-shrink-0 shadow-xs", iconBoxStyle)}>
                    {type === 'success' ? (
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="9 12 11 14 15 10" /></svg>
                    ) : type === 'warning' ? (
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                    ) : type === 'error' ? (
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                    ) : (
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
                    )}
                  </div>

                  {/* Body Content */}
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <p className={cn("text-[13px] font-extrabold tracking-tight truncate", isUnread ? "text-foreground" : "text-foreground-secondary")}>
                        {notif.title}
                      </p>
                      {isUnread && <span className="w-2 h-2 rounded-full bg-primary shrink-0 animate-pulse" />}
                    </div>
                    {notif.message && (
                      <p className="text-[12px] text-foreground-secondary/90 line-clamp-2 leading-relaxed">
                        {notif.message}
                      </p>
                    )}
                    
                    <span className="text-[10px] font-medium text-foreground-muted/70 block pt-1">
                      {notif.sent_at ? formatDate(notif.sent_at) : ""}
                    </span>

                    {(category || severity) && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1.5">
                        {category?.label && (
                          <span className={cn("px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider", category.chipClass)}>
                            {category.label}{notif.reference_id ? ` #${notif.reference_id}` : ""}
                          </span>
                        )}
                        {severity && (
                          <span className={cn("px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider", severity.chipClass)}>
                            {severity.label}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Link to View All */}
        <div className="border-t border-border/60 p-3 bg-muted/20 text-center">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-1.5 text-xs font-bold text-primary hover:text-primary/80 transition-colors"
          >
            View All Notifications
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
