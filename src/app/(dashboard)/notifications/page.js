"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getNotifications, markAsRead, markAllAsRead, deleteNotification } from "@/services/notification.service";
import { formatDate } from "@/lib/utils";
import {
  Bell, Info, AlertTriangle, CheckCircle2, CalendarCheck,
  Send, Wrench, Fuel, Route, X, CheckCheck, Trash2,
} from "lucide-react";

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

const typeColors = {
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
  Info: "bg-info/10",
  Warning: "bg-warning/10",
  Alert: "bg-danger/10",
  Success: "bg-success/10",
  Reservation: "bg-primary/10",
  Dispatch: "bg-primary/10",
  Maintenance: "bg-warning/10",
  Fuel: "bg-warning/10",
  Trip: "bg-primary/10",
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAllMutation = useMutation({
    mutationFn: markAllAsRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteNotification,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unread = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
            {unread > 0 && <Badge variant="default">{unread} unread</Badge>}
          </div>
          <p className="text-foreground-secondary mt-1">View and manage system notifications</p>
        </div>
        <div className="flex items-center gap-2">
          {unread > 0 && (
            <Button variant="outline" size="sm" className="h-9" onClick={() => markAllMutation.mutate()}>
              <CheckCheck className="w-4 h-4 mr-1.5" />
              Mark All Read
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-9">
            <Bell className="w-4 h-4 mr-1.5" />
            Send Test
          </Button>
        </div>
      </div>

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
            <div className="py-12 text-center text-foreground-muted">
              <Bell className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">No notifications</p>
              <p className="text-sm mt-1">You're all caught up!</p>
            </div>
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
                      <Icon className={`w-4 h-4 ${typeColors[notif.type] ? `text-${typeColors[notif.type]}` : "text-foreground-muted"}`} />
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
                      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-foreground-muted">
                        <Badge variant={typeColors[notif.type] || "secondary"} className="text-[9px]">{notif.type}</Badge>
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
