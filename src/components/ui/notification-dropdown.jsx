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

  const uniqueNotifications = (notifications || []).filter((notif, index, self) =>
    index === self.findIndex((n) => n.message === notif.message && n.title === notif.title)
  );

  const unreadCount = uniqueNotifications.filter((n) => !n.is_read).length;

  const recent = uniqueNotifications.slice(0, 5);

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
            "relative flex h-8 w-8 items-center justify-center rounded-md text-foreground-muted hover:text-foreground hover:bg-hover transition-colors cursor-pointer outline-none",
            open && "bg-hover text-foreground"
          )}
          title="Notifications"
        >
          <motion.span
            key={bellPulse}
            className="relative inline-flex"
            initial={{ rotate: 0, scale: 1 }}
            animate={
              bellPulse > 0
                ? { rotate: [0, -16, 14, -8, 0], scale: [1, 1.25, 1] }
                : { rotate: 0, scale: 1 }
            }
            transition={{ duration: 0.55, ease: EASE }}
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-[11px] font-bold text-white shadow-sm">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </motion.span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="bottom" align="end" className="w-80 sm:w-96 p-0 overflow-hidden shadow-xl border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-foreground">Notifications</span>
            {unreadCount > 0 && (
              <Badge variant="primary" className="text-[11px] py-0 px-1.5 font-bold">
                {unreadCount} new
              </Badge>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              onClick={() => markAllMut.mutate()}
              className="text-[11px] font-medium text-primary hover:underline flex items-center gap-1 cursor-pointer"
            >
              <CheckCheck className="w-3 h-3" />
              Mark all read
            </button>
          )}
        </div>

        {/* List of recent notifications */}
        <div className="max-h-80 overflow-y-auto divide-y divide-border/60">
          {recent.length === 0 ? (
            <div className="p-6 text-center text-foreground-muted space-y-1">
              <Bell className="w-6 h-6 mx-auto text-foreground-muted opacity-40 mb-2" />
              <p className="text-xs font-semibold text-foreground">No notifications</p>
              <p className="text-[11px]">You're all caught up!</p>
            </div>
          ) : (
            recent.map((notif) => {
              const Icon = typeIcons[notif.type] || Info;
              const category = notificationCategory(notif.reference_type);
              const severity = severityBadge(notif.severity);
              const isUnread = !notif.is_read;

              return (
                <div
                  key={notif.notification_id}
                  onClick={() => openNotification(notif)}
                  className={cn(
                    "flex items-start gap-3 p-3 text-left transition-colors cursor-pointer hover:bg-hover",
                    isUnread && "bg-primary/[0.03]"
                  )}
                >
                  <div className={cn("p-1.5 rounded-lg shrink-0 mt-0.5", typeBg[notif.type] || "bg-muted")}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center justify-between gap-1">
                      <p className={cn("text-xs truncate", isUnread ? "font-bold text-foreground" : "font-medium text-foreground-secondary")}>
                        {notif.title}
                      </p>
                      {isUnread && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                    </div>
                    {notif.message && (
                      <p className="text-[11px] text-foreground-muted line-clamp-2 leading-snug">
                        {notif.message}
                      </p>
                    )}
                    <span className="text-[11px] text-foreground-muted block pt-0.5">
                      {notif.sent_at ? formatDate(notif.sent_at) : ""}
                    </span>
                    {(category || severity) && (
                      <div className="flex flex-wrap items-center gap-1 pt-0.5">
                        {category?.label && (
                          <span className={cn("px-1.5 py-0.5 rounded-full text-[9px] font-bold", category.chipClass)}>
                            {category.label}{notif.reference_id ? ` #${notif.reference_id}` : ""}
                          </span>
                        )}
                        {severity && (
                          <span className={cn("px-1.5 py-0.5 rounded-full text-[9px] font-bold", severity.chipClass)}>
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
        <div className="border-t border-border p-2.5 bg-muted/10 text-center">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
          >
            View All Notifications
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
