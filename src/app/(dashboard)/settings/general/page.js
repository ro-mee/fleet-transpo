"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { APP_NAME } from "@/lib/constants";
import { Globe, Palette, Share2 } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";

export default function SettingsGeneralPage() {
  useRequireRole(["admin", "system_admin"]);
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="General Settings"
        description="System-wide configuration and preferences."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary" /> System
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm text-foreground-secondary mb-1 block">Application Name</label>
              <div className="h-10 px-3 rounded-xl border border-border bg-surface flex items-center text-sm font-medium">{APP_NAME}</div>
            </div>
            <div>
              <label className="text-sm text-foreground-secondary mb-1 block">Timezone</label>
              <div className="h-10 px-3 rounded-xl border border-border bg-surface flex items-center text-sm text-foreground-muted">Asia/Manila (UTC+8)</div>
            </div>
            <div>
              <label className="text-sm text-foreground-secondary mb-1 block">Date Format</label>
              <div className="h-10 px-3 rounded-xl border border-border bg-surface flex items-center text-sm text-foreground-muted">MM/DD/YYYY</div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Palette className="w-4 h-4 text-primary" /> Appearance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm text-foreground-secondary mb-2 block">Theme</label>
              <div className="flex gap-2">
                {["Light", "Dark", "System"].map((theme) => (
                  <div key={theme} className={`flex-1 p-3 rounded-xl border text-center cursor-pointer transition-all ${
                    theme === "Light" ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"
                  }`}>
                    <p className="text-sm font-medium">{theme}</p>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm text-foreground-secondary mb-2 block">Sidebar Behavior</label>
              <div className="flex gap-2">
                {["Expanded", "Collapsed", "Auto"].map((mode) => (
                  <div key={mode} className={`flex-1 p-3 rounded-xl border text-center cursor-pointer transition-all ${
                    mode === "Expanded" ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"
                  }`}>
                    <p className="text-sm font-medium">{mode}</p>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Share2 className="w-4 h-4 text-primary" /> Integrations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { name: "Supabase", status: "Connected", desc: "Database & Authentication" },
            { name: "Google Maps", status: "Configured", desc: "Geocoding & Routing" },
            { name: "Twilio SMS", status: "Not Configured", desc: "SMS Notifications" },
            { name: "SendGrid Email", status: "Not Configured", desc: "Email Notifications" },
            { name: "OpenAI", status: "Configured", desc: "AI Recommendations" },
          ].map((int) => (
            <div key={int.name} className="flex items-center gap-3 p-3 rounded-lg hover:bg-hover transition-colors">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{int.name}</p>
                  <Badge variant={int.status === "Connected" ? "success" : int.status === "Configured" ? "info" : "secondary"} className="text-[11px]">{int.status}</Badge>
                </div>
                <p className="text-xs text-foreground-muted">{int.desc}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
