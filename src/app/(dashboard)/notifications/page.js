"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { getNotifications, markAsRead, markAllAsRead, deleteNotification } from "@/services/notification.service";
import { formatDate } from "@/lib/utils";
import {
  Bell, Info, AlertTriangle, CheckCircle2, CalendarCheck,
  Send, Wrench, Fuel, Route, X, CheckCheck, Trash2,
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
  const queryClient = useQueryClient();
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

  const unread = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="System"
        title="Notifications"
        description="View and manage system notifications."
        actions={
          <>
            {unread > 0 && (
              <Button variant="outline" size="sm" className="h-9" onClick={() => markAllMutation.mutate()}>
                <CheckCheck className="w-4 h-4 mr-1.5" />
                Mark All Read
              </Button>
            )}
            {unread > 0 && <Badge variant="default">{unread} unread</Badge>}
          </>
        }
      />

      <div className="flex items-center gap-2">
        <Button variant={filter === "all" ? "default" : "outline"} size="sm" onClick={() => setFilter("all")}>
          All
        </Button>
        <Button variant={filter === "unread" ? "default" : "outline"} size="sm" onClick={() => setFilter("unread")}>
          Unread ({unread})
        </Button>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          {notifications.length === 0 ? (
            <EmptyState
              icon={Bell}
              title="No notifications"
              description="You're all caught up. Alerts and trip updates will appear here."
            />
          ) : (
            <div className="divide-y divide-border">
              {notifications.map((notif) => {
                const Icon = typeIcons[notif.type] || Info;
                const isUnread = !notif.is_read;

                return (
                  <div
                    key={notif.notification_id}
                    className={`flex items-start gap-4 px-5 py-4 transition-colors hover:bg-hover ${isUnread ? "bg-primary/[0.02]" : ""}`}
                  >
                    <div className={`p-2 rounded-lg ${typeBg[notif.type] || "bg-muted"} mt-0.5`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className={`text-sm ${isUnread ? "font-semibold text-foreground" : "text-foreground"}`}>
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
                        <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => markReadMutation.mutate(notif.notification_id)}>
                          <CheckCheck className="w-3.5 h-3.5 text-foreground-muted" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="w-7 h-7 text-danger/60 hover:text-danger" onClick={() => deleteMutation.mutate(notif.notification_id)}>
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
