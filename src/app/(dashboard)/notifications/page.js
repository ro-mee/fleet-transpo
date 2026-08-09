"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { getNotificationHref } from "@/lib/notifications/target";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
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

  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications", filter],
    queryFn: () => getNotifications(filter === "unread" ? { is_read: false } : {}),
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
          {uniqueNotifications.length === 0 ? (
            <EmptyState
              icon={Bell}
              title="No notifications"
              description="You're all caught up. Alerts and trip updates will appear here."
            />
          ) : (
            <div className="divide-y divide-border">
              {uniqueNotifications.map((notif) => {
                const Icon = typeIcons[notif.type] || Info;
                const isUnread = !notif.is_read;

                return (
                  <div
                    key={notif.notification_id}
                    onClick={() => openNotification(notif)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openNotification(notif); } }}
                    className={`flex items-start gap-4 px-5 py-4 transition-colors cursor-pointer hover:bg-hover ${isUnread ? "bg-primary/[0.02]" : ""}`}
                  >
                    <div className={`p-2 rounded-xl ${typeBg[notif.type] || "bg-muted"} mt-0.5`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className={`text-sm font-bold ${isUnread ? "text-foreground" : "text-foreground"}`}>
                          {notif.title}
                        </p>
                        {isUnread && <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
                      </div>
                      {notif.message && (
                        <p className="text-xs text-foreground-secondary">{notif.message}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1.5 text-[11px] text-foreground-muted">
                        <Badge variant={typeVariant[notif.type] || "secondary"} className="text-[11px]">{notif.type}</Badge>
                        <span>{notif.sent_at ? formatDate(notif.sent_at) : ""}</span>
                        {notif.reference_type && <span>{notif.reference_type} #{notif.reference_id}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {isUnread && (
                        <Button variant="ghost" size="icon" className="w-7 h-7" onClick={(e) => { e.stopPropagation(); markReadMutation.mutate(notif.notification_id); }}>
                          <CheckCheck className="w-3.5 h-3.5 text-foreground-muted" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="w-7 h-7 text-danger/60 hover:text-danger" onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(notif.notification_id); }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
