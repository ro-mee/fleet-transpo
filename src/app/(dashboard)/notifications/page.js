"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { getNotificationHref } from "@/lib/notifications/target";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  NotificationCard,
  NotificationCardSkeleton,
} from "@/components/notifications/notification-card";
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
} from "@/services/notification.service";
import { cn } from "@/lib/utils";
import { Bell, CheckCheck } from "lucide-react";
import { toast } from "@/components/ui/toast";
import {
  HeroHeader,
  heroButtonOutlineClass,
} from "@/components/ui/hero-header";

export default function NotificationsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { employee } = useAuth();
  const role = employee?.roles?.role_name;
  const [filter, setFilter] = useState("all");
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ["notifications", filter],
    queryFn: () =>
      getNotifications(filter === "unread" ? { is_read: false } : {}),
    // New notifications should appear without a page reload: poll every 15s,
    // keep polling in background tabs, and refetch on window focus.
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  const markReadMutation = useMutation({
    mutationFn: markAsRead,
    onSuccess: () => {
      toast.success("Notification marked as read");
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const markAllMutation = useMutation({
    mutationFn: markAllAsRead,
    onSuccess: () => {
      toast.success("All notifications marked as read");
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteNotification,
    onSuccess: () => {
      toast.success("Notification deleted");
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const uniqueNotifications = useMemo(() => {
    const seen = new Set();
    return (notifications || []).filter((notif) => {
      // Prefer the stable id: content-key deduping would collapse genuinely
      // different notifications that happen to share the same text.
      const key =
        notif.notification_id ??
        `${notif.message}-${notif.title}-${notif.reference_type}-${notif.reference_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [notifications]);

  const openNotification = (notif) => {
    if (!notif.is_read) markReadMutation.mutate(notif.notification_id);
    const href = getNotificationHref(notif, role);
    if (href) router.push(href);
  };

  const unread = uniqueNotifications.filter((n) => !n.is_read).length;

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={Bell}
        title="Notification Center"
        badge={unread > 0 ? `${unread} Unread` : "All Read"}
        description="System alerts, trip updates, and operational notifications."
        actions={
          unread > 0 && (
            <Button
              variant="outline"
              size="sm"
              className={cn("h-9", heroButtonOutlineClass)}
              onClick={() => markAllMutation.mutate()}
            >
              <CheckCheck className="w-4 h-4 mr-1.5" />
              Mark All Read
            </Button>
          )
        }
      />

      {/* Filter Tabs */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={cn(
            "px-4 h-8 sm:h-9 rounded-full text-xs font-bold border transition-all cursor-pointer",
            filter === "all"
              ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950 border-slate-900 dark:border-white shadow-2xs"
              : "bg-white dark:bg-slate-900 border-[#d7dee7] dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-600"
          )}
        >
          All Notifications
        </button>
        <button
          type="button"
          onClick={() => setFilter("unread")}
          className={cn(
            "px-4 h-8 sm:h-9 rounded-full text-xs font-bold border transition-all cursor-pointer flex items-center gap-1.5",
            filter === "unread"
              ? "bg-blue-600 text-white border-blue-600 shadow-2xs"
              : "bg-white dark:bg-slate-900 border-[#d7dee7] dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-blue-300 dark:hover:border-blue-700"
          )}
        >
          <span>Unread</span>
          {unread > 0 && (
            <span
              className={cn(
                "px-1.5 py-0.2 rounded-full text-[10px] font-extrabold",
                filter === "unread"
                  ? "bg-white/20 text-white"
                  : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
              )}
            >
              {unread}
            </span>
          )}
        </button>
      </div>

      {/* Main Notification Stack */}
      {isLoading ? (
        <NotificationCardSkeleton count={3} />
      ) : uniqueNotifications.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-[#d7dee7] dark:border-slate-800 rounded-[22px] p-8 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
          <EmptyState
            icon={Bell}
            title="No notifications"
            description="You're all caught up. Alerts and trip updates will appear here."
            variant="relief"
            size="compact"
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4 sm:gap-5">
          {uniqueNotifications.map((notif) => (
            <NotificationCard
              key={
                notif.notification_id ||
                `${notif.message}-${notif.title}-${notif.reference_type}-${notif.reference_id}`
              }
              notification={notif}
              onClick={openNotification}
              onMarkAsRead={(id) => markReadMutation.mutate(id)}
              onDelete={(item) => setDeleteTarget(item)}
            />
          ))}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        variant="danger"
        title="Delete notification?"
        message="This permanently removes it from your feed."
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteMutation.mutate(deleteTarget.notification_id, {
            onSettled: () => setDeleteTarget(null),
          });
        }}
      />
    </div>
  );
}
