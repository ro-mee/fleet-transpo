"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { APP_NAME } from "@/lib/constants";
import {
  getHotelLocationSettings,
  updateHotelLocationSettings,
  seedNaiaRoutes,
} from "@/services/settings.service";
import { useRequireRole } from "@/lib/auth/role-guard";
import {
  Globe,
  Palette,
  Share2,
  MapPin,
  ExternalLink,
  Save,
  Plane,
  Building2,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SIDEBAR_MODES, useSidebar } from "@/hooks/use-sidebar";
import { HeroHeader, heroButtonOutlineClass, heroButtonPrimaryClass } from "@/components/ui/hero-header";

export default function SettingsGeneralPage() {
  useRequireRole(["admin", "system_admin"]);
  const queryClient = useQueryClient();
  const { mode: sidebarMode, setMode: setSidebarMode } = useSidebar();

  const [form, setForm] = useState({
    hotel_name: "CoCo Star Hotel",
    address: "CoCo Star Hotel, Manila, Philippines",
    latitude: 14.5159034,
    longitude: 120.9953405,
    google_maps_url: "https://maps.app.goo.gl/jmKkcqiUrSbr1i747",
  });

  const { data: hotelData, isLoading } = useQuery({
    queryKey: ["hotel-settings"],
    queryFn: () => getHotelLocationSettings(),
  });

  useEffect(() => {
    if (hotelData) {
      setForm({
        hotel_name: hotelData.hotel_name || "CoCo Star Hotel",
        address: hotelData.address || "CoCo Star Hotel, Manila, Philippines",
        latitude: hotelData.latitude ?? 14.5159034,
        longitude: hotelData.longitude ?? 120.9953405,
        google_maps_url: hotelData.google_maps_url || "https://maps.app.goo.gl/jmKkcqiUrSbr1i747",
      });
    }
  }, [hotelData]);

  const updateMutation = useMutation({
    mutationFn: (data) => updateHotelLocationSettings(data),
    onSuccess: () => {
      toast.success("Hotel Base Location updated successfully!");
      queryClient.invalidateQueries({ queryKey: ["hotel-settings"] });
      queryClient.invalidateQueries({ queryKey: ["routes"] });
      queryClient.invalidateQueries({ queryKey: ["locations"] });
    },
    onError: (err) => {
      toast.error(err.message || "Failed to update hotel location");
    },
  });

  const seedNaiaMutation = useMutation({
    mutationFn: () => seedNaiaRoutes(),
    onSuccess: () => {
      toast.success("NAIA Airport Terminal routes synced successfully!");
      queryClient.invalidateQueries({ queryKey: ["routes"] });
    },
    onError: (err) => {
      toast.error(err.message || "Failed to sync NAIA routes");
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    updateMutation.mutate(form);
  };

  return (
    <div className="space-y-6">
      {/* ── Hero Header ── */}
      <HeroHeader
        icon={Settings}
        title="General Settings"
        badge="System Config"
        description="System-wide configuration, hotel base location, and integrated services."
      />

      {/* ── HOTEL BASE LOCATION MANAGEMENT CARD ── */}
      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
        <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-extrabold flex items-center gap-2 text-foreground">
                <Building2 className="w-4 h-4 text-primary" /> Hotel Base Location &amp; Coordinates
              </CardTitle>
              <CardDescription className="text-xs text-foreground-secondary mt-0.5">
                System Administrators can set or change the central hotel base coordinates. All dispatch routes and pickup calculations will originate from this location.
              </CardDescription>
            </div>
            {form.google_maps_url && (
              <Button variant="outline" size="xs" asChild className="h-8 text-xs shrink-0 rounded-xl">
                <a href={form.google_maps_url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-3.5 h-3.5 mr-1 text-primary" /> View on Google Maps
                </a>
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-5 space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-foreground mb-1 block">
                  Hotel Name
                </label>
                <Input
                  value={form.hotel_name}
                  onChange={(e) => setForm((p) => ({ ...p, hotel_name: e.target.value }))}
                  placeholder="e.g. CoCo Star Hotel"
                  className="h-10 rounded-3xl border border-border/80"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-foreground mb-1 block">
                  Google Maps URL / Share Link
                </label>
                <Input
                  value={form.google_maps_url}
                  onChange={(e) => setForm((p) => ({ ...p, google_maps_url: e.target.value }))}
                  placeholder="https://maps.app.goo.gl/..."
                  className="h-10 rounded-3xl border border-border/80 font-data text-xs"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-foreground mb-1 block">
                Full Physical Address
              </label>
              <Input
                value={form.address}
                onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                placeholder="Street, District, City, Country"
                className="h-10 rounded-3xl border border-border/80"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-foreground mb-1 block flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-primary" /> Latitude
                </label>
                <Input
                  type="number"
                  step="any"
                  value={form.latitude}
                  onChange={(e) => setForm((p) => ({ ...p, latitude: e.target.value }))}
                  className="h-10 rounded-3xl border border-border/80 font-data"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-foreground mb-1 block flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-primary" /> Longitude
                </label>
                <Input
                  type="number"
                  step="any"
                  value={form.longitude}
                  onChange={(e) => setForm((p) => ({ ...p, longitude: e.target.value }))}
                  className="h-10 rounded-3xl border border-border/80 font-data"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border/60">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={seedNaiaMutation.isPending}
                onClick={() => seedNaiaMutation.mutate()}
                className="h-9 text-xs rounded-xl"
              >
                <Plane className="w-4 h-4 mr-1.5 text-info" />
                {seedNaiaMutation.isPending ? "Syncing Routes..." : "Sync All NAIA Airport Terminal Routes"}
              </Button>

              <Button type="submit" size="sm" disabled={updateMutation.isPending} className="h-9 text-xs rounded-xl">
                <Save className="w-4 h-4 mr-1.5" />
                {updateMutation.isPending ? "Saving Location..." : "Save Hotel Location & Coordinates"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
            <CardTitle className="text-sm font-extrabold flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary" /> System Preferences
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div>
              <label className="text-xs font-bold text-foreground-secondary mb-1 block">Application Name</label>
              <div className="h-10 px-3 rounded-3xl border border-border/80 bg-surface flex items-center text-sm font-semibold">
                {APP_NAME}
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-foreground-secondary mb-1 block">Timezone</label>
              <div className="h-10 px-3 rounded-3xl border border-border/80 bg-surface flex items-center text-sm font-data text-foreground-muted">
                Asia/Manila (UTC+8)
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-foreground-secondary mb-1 block">Date Format</label>
              <div className="h-10 px-3 rounded-3xl border border-border/80 bg-surface flex items-center text-sm font-data text-foreground-muted">
                MM/DD/YYYY
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
            <CardTitle className="text-sm font-extrabold flex items-center gap-2">
              <Palette className="w-4 h-4 text-primary" /> Appearance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div>
              <label className="text-xs font-bold text-foreground-secondary mb-2 block">Theme</label>
              <div className="flex gap-2">
                {["Light", "Dark", "System"].map((theme) => (
                  <div
                    key={theme}
                    className={cn(
                      "flex-1 p-3 rounded-3xl border text-center cursor-pointer transition-all",
                      theme === "Light"
                        ? "border-primary bg-primary/10 font-bold text-primary"
                        : "border-border/80 bg-surface hover:border-primary/40 text-foreground-secondary"
                    )}
                  >
                    <p className="text-xs font-bold">{theme}</p>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-foreground-secondary mb-2 block">Sidebar Behavior</label>
              <div className="flex gap-2">
                {SIDEBAR_MODES.map((m) => (
                  <div
                    key={m.value}
                    onClick={() => setSidebarMode(m.value)}
                    title={m.description}
                    className={cn(
                      "flex-1 p-3 rounded-3xl border text-center cursor-pointer transition-all",
                      m.value === sidebarMode
                        ? "border-primary bg-primary/10 font-bold text-primary"
                        : "border-border/80 bg-surface hover:border-primary/40 text-foreground-secondary"
                    )}
                  >
                    <p className="text-xs font-bold">{m.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
        <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
          <CardTitle className="text-sm font-extrabold flex items-center gap-2">
            <Share2 className="w-4 h-4 text-primary" /> Integrations &amp; Connectors
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 divide-y divide-border/50">
          {[
            { name: "Supabase", status: "Connected", desc: "Database & Authentication" },
            { name: "Google Maps", status: "Configured", desc: "Geocoding & Routing" },
            { name: "Twilio SMS", status: "Not Configured", desc: "SMS Notifications" },
            { name: "SendGrid Email", status: "Not Configured", desc: "Email Notifications" },
            { name: "OpenAI", status: "Configured", desc: "AI Recommendations" },
          ].map((int) => (
            <div key={int.name} className="flex items-center gap-3 p-4 hover:bg-primary/[0.04] transition-colors">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-foreground">{int.name}</p>
                  <Badge
                    variant={
                      int.status === "Connected"
                        ? "success"
                        : int.status === "Configured"
                        ? "info"
                        : "secondary"
                    }
                    className="text-[10px] font-bold rounded-full"
                  >
                    {int.status}
                  </Badge>
                </div>
                <p className="text-xs text-foreground-muted mt-0.5">{int.desc}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
