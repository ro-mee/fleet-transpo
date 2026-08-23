"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { getNotificationHref } from "@/lib/notifications/target";
import { notificationCategory, severityBadge } from "@/lib/notifications/presentation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { getNotifications, markAsRead, markAllAsRead, deleteNotification } from "@/services/notification.service";
import { formatDate, cn } from "@/lib/utils";
import {
  Bell, Info, AlertTriangle, CheckCircle2, CalendarCheck,
  Send, Wrench, Fuel, Route, X, CheckCheck, Trash2,
} from "lucide-react";
import { toast } from "@/components/ui/toast";
import { HeroHeader, heroButtonOutlineClass, heroButtonPrimaryClass } from "@/components/ui/hero-header";

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

// Static (compile-safe) tone classes per notification type.
const typeVariant = {
  Info: "info",
  Warning: "warning",
  Alert: "danger",
  Success: "success",
  Reservation: "primary",
  Dispatch: "primary",
  Maintenance: "warning",
  Fuel: "warning",
  Trip: "primary",
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

export default function NotificationsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { employee } = useAuth();
  const role = employee?.roles?.role_name;
  const [filter, setFilter] = useState("all");
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ["notifications", filter],
    queryFn: () => getNotifications(filter === "unread" ? { is_read: false } : {}),
    // New notifications should appear without a page reload: poll every 15s,
    // keep polling in background tabs, and refetch on window focus (the
    // global default is refetchOnWindowFocus: false).
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
      const key = `${notif.message}-${notif.title}-${notif.reference_type}-${notif.reference_id}`;
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
        badge={unread > 0 ? unread + ' Unread' : 'All Read'}
        description="System alerts, trip updates, and operational notifications."
        actions={
          unread > 0 && (
            <Button variant="outline" size="sm" className={cn("h-9", heroButtonOutlineClass)} onClick={() => markAllMutation.mutate()}>
              <CheckCheck className="w-4 h-4 mr-1.5" />
              Mark All Read
            </Button>
          )
        }
      />

      <div className="flex items-center gap-2">
        <button onClick={()=>setFilter('all')} className={cn('px-4 h-8 rounded-full text-xs font-bold border transition-all cursor-pointer', filter==='all' ? 'bg-primary text-white dark:text-slate-950 border-primary' : 'bg-surface border-border/60 text-foreground-secondary hover:border-primary/40')}>All Notifications</button>
        <button onClick={()=>setFilter('unread')} className={cn('px-4 h-8 rounded-full text-xs font-bold border transition-all cursor-pointer', filter==='unread' ? 'bg-warning text-white border-warning' : 'bg-surface border-border/60 text-foreground-secondary hover:border-warning/40')}>Unread ({unread})</button>
      </div>

      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-3 space-y-3 bg-muted/10" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-start gap-4 p-4 rounded-[20px] bg-surface border border-border/60 animate-pulse">
                  <div className="w-11 h-11 rounded-[14px] bg-hover shrink-0" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-3.5 w-44 rounded-full bg-hover" />
                    <div className="h-3 w-full max-w-md rounded-full bg-hover" />
                    <div className="h-2.5 w-28 rounded-full bg-hover" />
                  </div>
                </div>
              ))}
            </div>
          ) : uniqueNotifications.length === 0 ? (
            <EmptyState
              icon={Bell}
              title="No notifications"
              description="You're all caught up. Alerts and trip updates will appear here."
            />
          ) : (
            <div className="p-3 space-y-3 bg-muted/10">
              {uniqueNotifications.map((notif) => {
                const category = notificationCategory(notif.reference_type);
                const severity = severityBadge(notif.severity);
                const isUnread = !notif.is_read;
                const type = notif.type === 'Alert' ? 'error' : (notif.type?.toLowerCase() || 'info');
                
                const cardStyle = {
                  info: "from-sky-500/10 via-sky-500/5 to-surface border-sky-500/25",
                  success: "from-emerald-500/10 via-emerald-500/5 to-surface border-emerald-500/25",
                  warning: "from-amber-500/10 via-amber-500/5 to-surface border-amber-500/25",
                  error: "from-rose-500/10 via-rose-500/5 to-surface border-rose-500/25",
                }[type] || "from-sky-500/10 via-sky-500/5 to-surface border-sky-500/25";

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
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openNotification(notif); } }}
                    className={cn(
                      "relative group flex items-start gap-4 p-4 rounded-[20px] bg-gradient-to-r border transition-all duration-300 cursor-pointer shadow-xs hover:shadow-md hover:-translate-y-0.5",
                      cardStyle,
                      isUnread && "ring-1 ring-primary/40 shadow-sm"
                    )}
                  >
                    {/* Glowing Squircle Icon Container */}
                    <div className={cn("w-11 h-11 rounded-[14px] border flex items-center justify-center flex-shrink-0 shadow-xs", iconBoxStyle)}>
                      {type === 'success' ? (
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="9 12 11 14 15 10" /></svg>
                      ) : type === 'warning' ? (
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                      ) : type === 'error' ? (
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                      ) : (
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
                      )}
                    </div>

                    {/* Content Column */}
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-[14px] font-extrabold text-foreground tracking-tight">
                          {notif.title}
                        </h4>
                        {isUnread && (
                          <span className="flex h-2 w-2 relative">
                            <span className="animate-ping motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                          </span>
                        )}
                      </div>
                      {notif.message && (
                        <p className="text-[13px] text-foreground-secondary/90 leading-relaxed">{notif.message}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-2 mt-2.5 text-[11px] text-foreground-muted">
                        {category?.label && (
                          <Badge className={cn("text-[10px] uppercase font-bold tracking-wider rounded-full px-2.5 py-0.5", category.chipClass)}>
                            {category.label}{notif.reference_id ? ` #${notif.reference_id}` : ""}
                          </Badge>
                        )}
                        {severity && <Badge className={cn("text-[10px] uppercase font-bold tracking-wider rounded-full px-2.5 py-0.5", severity.chipClass)}>{severity.label}</Badge>}
                        <span className="font-medium text-foreground-muted/70">{notif.sent_at ? formatDate(notif.sent_at) : ""}</span>
                      </div>
                    </div>

                    {/* Action Controls */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {isUnread && (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="w-8 h-8 rounded-full hover:bg-black/5 dark:hover:bg-white/10" 
                          title="Mark as read"
                          onClick={(e) => { e.stopPropagation(); markReadMutation.mutate(notif.notification_id); }}
                        >
                          <CheckCheck className="w-4 h-4 text-foreground-muted" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-8 h-8 rounded-full text-danger/60 hover:text-danger hover:bg-danger/10"
                        title="Delete notification"
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(notif); }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

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
