"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HeroHeader, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { cn } from "@/lib/utils";
import { Bell, Mail, Smartphone, CheckCircle2 } from "lucide-react";

const channelOptions = [
  { id: "in_app", label: "In-App", icon: Bell, description: "Notifications within the FleetOps dashboard" },
  { id: "email", label: "Email", icon: Mail, description: "Send notifications via email" },
  { id: "push", label: "Push", icon: Smartphone, description: "Mobile push notifications" },
];

const defaultPreferences = {
  reservation_created: { in_app: true, email: true, push: false },
  reservation_approved: { in_app: true, email: true, push: true },
  reservation_rejected: { in_app: true, email: true, push: false },
  trip_started: { in_app: true, email: false, push: true },
  trip_completed: { in_app: true, email: false, push: false },
  dispatch_created: { in_app: true, email: true, push: true },
  maintenance_due: { in_app: true, email: true, push: true },
  fuel_low: { in_app: true, email: false, push: true },
  driver_check_in: { in_app: true, email: false, push: false },
  document_expiring: { in_app: true, email: true, push: false },
  ai_insight: { in_app: true, email: false, push: false },
};

const eventLabels = {
  reservation_created: "Reservation Created",
  reservation_approved: "Reservation Approved",
  reservation_rejected: "Reservation Rejected",
  trip_started: "Trip Started",
  trip_completed: "Trip Completed",
  dispatch_created: "Dispatch Created",
  maintenance_due: "Maintenance Due",
  fuel_low: "Fuel Low",
  driver_check_in: "Driver Check-In",
  document_expiring: "Document Expiring",
  ai_insight: "AI Insight Generated",
};

export default function NotificationPreferencesPage() {
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const toggle = (event, channel) => {
    setPreferences((prev) => ({
      ...prev,
      [event]: { ...prev[event], [channel]: !prev[event][channel] },
    }));
    setSaved(false);
  };

  const handleSave = () => {
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }, 500);
  };

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={Bell}
        title="Notification Preferences"
        badge="System"
        description="Configure how and when you receive notifications."
        actions={
          <Button onClick={handleSave} disabled={saving} className={cn("h-10", heroButtonPrimaryClass)}>
            {saved ? (
              <><CheckCircle2 className="w-4 h-4 mr-2" /> Saved</>
            ) : (
              <>Save Preferences</>
            )}
          </Button>
        }
      />

      <div className="flex items-center gap-3 mb-4 p-4 rounded-xl bg-muted/30 border border-border">
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
          <div className="divide-y divide-border">
            {Object.entries(eventLabels).map(([event, label]) => {
              const prefs = preferences[event];
              return (
                <div key={event} className="flex items-center justify-between px-5 py-3.5 hover:bg-hover transition-colors">
                  <div>
                    <p className="text-sm font-medium text-foreground">{label}</p>
                    <p className="text-xs text-foreground-muted mt-0.5 capitalize">{event.replace(/_/g, " ")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {channelOptions.map((ch) => (
                      <button
                        key={ch.id}
                        onClick={() => toggle(event, ch.id)}
                        className={`p-2 rounded-3xl border transition-all ${
                          prefs[ch.id]
                            ? "bg-primary/10 border-primary/30 text-primary"
                            : "bg-surface border-border text-foreground-muted hover:border-foreground-muted/30"
                        }`}
                      >
                        <ch.icon className="w-4 h-4" />
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
