"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { getNotificationHref } from "@/lib/notifications/target";
import { NotificationCard } from "@/components/notifications/notification-card";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { getNotifications, markAsRead, markAllAsRead } from "@/services/notification.service";
import { cn } from "@/lib/utils";
import { Bell, CheckCheck, ChevronRight } from "lucide-react";
import { toast } from "@/components/ui/toast";

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

        {/* List of recent notifications with clean neutral cards */}
        <div className="max-h-[380px] overflow-y-auto p-3 space-y-2">
          {recent.length === 0 ? (
            <div className="p-8 text-center text-foreground-muted space-y-1.5">
              <div className="w-12 h-12 rounded-2xl bg-muted/40 flex items-center justify-center mx-auto mb-3 text-foreground-muted/60">
                <Bell className="w-6 h-6" />
              </div>
              <p className="text-sm font-bold text-foreground">No notifications</p>
              <p className="text-xs text-foreground-secondary">You&apos;re all caught up!</p>
            </div>
          ) : (
            recent.map((notif) => (
              <NotificationCard
                key={notif.notification_id || `${notif.message}-${notif.title}`}
                notification={notif}
                compact={true}
                onClick={openNotification}
                onMarkAsRead={(id) => markReadMut.mutate(id)}
              />
            ))
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
