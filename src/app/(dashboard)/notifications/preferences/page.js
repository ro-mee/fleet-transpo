"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HeroHeader } from "@/components/ui/hero-header";
import { cn } from "@/lib/utils";
import { Bell, Mail, Smartphone } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { getNotificationPreferences, updateNotificationPreference } from "@/services/notification.service";
import { NOTIFICATION_EVENTS } from "@/lib/constants";

const channelOptions = [
  { id: "in_app", label: "In-App", icon: Bell, description: "Notifications within the FleetOps dashboard" },
  { id: "email", label: "Email", icon: Mail, description: "Send notifications via email" },
  { id: "push", label: "Push", icon: Smartphone, description: "Mobile push notifications" },
];

export default function NotificationPreferencesPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: () => getNotificationPreferences(),
  });

  const preferences = data?.preferences ?? null;

  const toggleMutation = useMutation({
    mutationFn: updateNotificationPreference,
    onSuccess: (result) => {
      queryClient.setQueryData(["notification-preferences"], (prev) => {
        if (!prev?.preferences) return prev;
        return {
          ...prev,
          preferences: {
            ...prev.preferences,
            [result.event_key]: {
              ...prev.preferences[result.event_key],
              [result.channel]: result.enabled,
            },
          },
        };
      });
    },
    onError: (err) => toast.error(err?.message || "Could not save preference"),
  });

  const toggle = (event, channel) => {
    if (channel === "in_app") {
      if (preferences?.[event]?.in_app) {
        toast.info("In-app notifications can't be disabled");
        return;
      }
    }
    const next = !preferences?.[event]?.[channel];
    toggleMutation.mutate({ event_key: event, channel, enabled: next });
  };

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={Bell}
        title="Notification Preferences"
        badge="System"
        description="Configure how and when you receive notifications."
      />

      <div className="flex items-center gap-3 mb-4 p-4 rounded-xl bg-info/10 border border-info/30 text-xs text-foreground-secondary">
        <Bell className="w-4 h-4 text-info shrink-0" />
        <span>
          In-app alerts are always on and preferences save automatically. Email and push delivery are
          enabled here so they take effect as those channels roll out.
        </span>
      </div>

      <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/30 border border-border">
        {channelOptions.map((ch) => (
          <div key={ch.id} className="flex items-center gap-2 text-sm">
            <ch.icon className="w-4 h-4 text-foreground-muted" />
            <span className="font-medium">{ch.label}</span>
          </div>
        ))}
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Notification Events</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-sm text-foreground-muted">Loading your preferences…</div>
          ) : error ? (
            <div className="p-6 text-sm text-danger">Could not load preferences. {error?.message}</div>
          ) : (
            <div className="divide-y divide-border">
              {Object.entries(NOTIFICATION_EVENTS).map(([event, config]) => (
                <div key={event} className="flex items-center justify-between px-5 py-3.5 hover:bg-hover transition-colors">
                  <div>
                    <p className="text-sm font-medium text-foreground">{config.label}</p>
                    <p className="text-xs text-foreground-muted mt-0.5 capitalize">{event.replace(/_/g, " ")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {channelOptions.map((ch) => {
                      const on = preferences?.[event]?.[ch.id] ?? config.defaults[ch.id];
                      const disabled = ch.id === "in_app" && on;
                      return (
                        <button
                          key={ch.id}
                          onClick={() => toggle(event, ch.id)}
                          disabled={disabled}
                          title={disabled ? "In-app notifications can't be disabled" : undefined}
                          aria-pressed={on}
                          className={cn(
                            "p-2 rounded-3xl border transition-all",
                            on
                              ? "bg-primary/10 border-primary/30 text-primary"
                              : "bg-surface border-border text-foreground-muted hover:border-foreground-muted/30",
                            disabled && "cursor-default opacity-90"
                          )}
                        >
                          <ch.icon className="w-4 h-4" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}