"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { APP_NAME } from "@/lib/constants";
import {
  getHotelLocationSettings,
  updateHotelLocationSettings,
  seedNaiaRoutes,
  getConnectors,
} from "@/services/settings.service";
import { useRequireRole } from "@/lib/auth/role-guard";
import { useTheme } from "@/hooks/use-theme";
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
  Database,
  Map,
  BrainCircuit,
  Bot,
  Cable,
  Check,
  Sun,
  Moon,
  Monitor,
  AppWindow,
  Clock,
  Languages,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SIDEBAR_MODES, useSidebar } from "@/hooks/use-sidebar";
import { HeroHeader } from "@/components/ui/hero-header";

// Nested "island" architecture: an outer shell (subtle tint, hairline ring,
// generous padding) holds an inner card with a concentric radius. Keeps the
// panels from sitting flat on the page background.
const SHELL = "rounded-[1.75rem] p-1.5 bg-foreground/[0.035] ring-1 ring-border/50";
const INNER_CARD = "rounded-[calc(1.75rem-0.375rem)] border-0 shadow-xs overflow-hidden";

const THEME_MODES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

const CONNECTOR_ICONS = {
  supabase: Database,
  tomtom: Map,
  gemini: BrainCircuit,
  "custom-ai": Bot,
  booking: Cable,
};

const STATUS_META = {
  connected: { label: "Connected", badge: "success", dot: "bg-success" },
  partial: { label: "Partial", badge: "warning", dot: "bg-warning" },
  mock: {
    label: "Preview",
    badge: "info",
    dot: "bg-info",
    title: "Connector not yet configured — showing sample data",
  },
  missing: { label: "Not configured", badge: "secondary", dot: "bg-foreground-muted" },
};

// Never seeded into the form — the form starts empty and is hydrated only
// from what the server actually returns, so a premature Save can't overwrite
// real configuration with hard-coded defaults.
const EMPTY_HOTEL = {
  hotel_name: "",
  address: "",
  latitude: "",
  longitude: "",
  google_maps_url: "",
};

export default function SettingsGeneralPage() {
  useRequireRole(["admin", "system_admin"]);
  const queryClient = useQueryClient();
  const { mode: sidebarMode, setMode: setSidebarMode } = useSidebar();
  const { mode: themeMode, setMode: setThemeMode } = useTheme();

  const { data: hotelData, isLoading: hotelLoading } = useQuery({
    queryKey: ["hotel-settings"],
    queryFn: () => getHotelLocationSettings(),
  });

  const { data: connectors, isLoading: connectorsLoading, refetch: refetchConnectors } = useQuery({
    queryKey: ["connectors"],
    queryFn: () => getConnectors(),
  });

  const [form, setForm] = useState(EMPTY_HOTEL);
  const [naiaConfirmOpen, setNaiaConfirmOpen] = useState(false);
  // Hydrate the form once the server values arrive. Done in an effect (not a
  // render-time sync) so the form is provably empty until real config lands —
  // no early Save can persist defaults over the live configuration.
  useEffect(() => {
    if (!hotelData) return;
    setForm({
      hotel_name: hotelData.hotel_name || "",
      address: hotelData.address || "",
      latitude: hotelData.latitude ?? "",
      longitude: hotelData.longitude ?? "",
      google_maps_url: hotelData.google_maps_url || "",
    });
  }, [hotelData]);

  // Real values instead of hardcoded text — the server's locale may not be
  // Manila and the calendar format is whatever the browser resolves.
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Manila",
    []
  );
  const dateExample = useMemo(
    () => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date()),
    []
  );

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

  const connectorCounts = useMemo(() => {
    const counts = { connected: 0, partial: 0, mock: 0, missing: 0 };
    (connectors || []).forEach((c) => {
      if (STATUS_META[c.status]) counts[c.status] += 1;
    });
    return counts;
  }, [connectors]);

  const summaryChips = [
    { n: connectorCounts.connected, label: "Connected", dot: "bg-success", cls: "bg-success-bg text-success", title: undefined },
    { n: connectorCounts.partial, label: "Partial", dot: "bg-warning", cls: "bg-warning-bg text-warning", title: undefined },
    { n: connectorCounts.mock, label: "Preview", dot: "bg-info", cls: "bg-info-bg text-info", title: STATUS_META.mock.title },
    { n: connectorCounts.missing, label: "Missing", dot: "bg-foreground-muted", cls: "bg-hover text-foreground-secondary", title: undefined },
  ].filter((c) => c.n > 0);

  return (
    <div className="space-y-6">
      {/* ── Hero Header ── */}
      <HeroHeader
        icon={Settings}
        title="General Settings"
        badge="System Config"
        description="System-wide configuration, hotel base location, and the live state of every external connector."
      />

      {/* ── HOTEL BASE LOCATION MANAGEMENT ── */}
      <div className={SHELL}>
        <Card className={INNER_CARD}>
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <CardTitle className="text-base font-extrabold text-foreground">
                    Hotel Base Location &amp; Coordinates
                  </CardTitle>
                </div>
                <CardDescription className="text-xs text-foreground-secondary mt-1.5">
                  The central base for all dispatch routes and pickup calculations. Changes take effect on
                  every route that originates here.
                </CardDescription>
              </div>
              {form.google_maps_url && (
                <a
                  href={form.google_maps_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Opens in a new tab"
                  className="group inline-flex items-center gap-2 h-9 pl-2.5 pr-1.5 rounded-full border border-info/25 bg-info/[0.06] shrink-0 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-info/45 hover:bg-info/[0.1] hover:shadow-[0_10px_24px_-12px_rgba(59,130,246,0.55)] active:scale-[0.97]"
                >
                  <MapPin
                    className="w-3.5 h-3.5 text-info transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-110"
                    strokeWidth={2.2}
                  />
                  <span className="text-xs font-bold text-foreground">View on Google Maps</span>
                  <span className="w-6 h-6 rounded-full bg-info/15 text-info flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:scale-105">
                    <ExternalLink className="w-3 h-3" strokeWidth={2.2} />
                  </span>
                </a>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-5 space-y-4">
            {hotelLoading ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="h-10 rounded-xl bg-hover animate-pulse" />
                  <div className="h-10 rounded-xl bg-hover animate-pulse" />
                </div>
                <div className="h-10 rounded-xl bg-hover animate-pulse" />
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="hotel_name" className="text-xs font-bold text-foreground mb-1.5 block">Hotel Name</label>
                    <Input
                      id="hotel_name"
                      value={form.hotel_name}
                      onChange={(e) => setForm((p) => ({ ...p, hotel_name: e.target.value }))}
                      placeholder="e.g. CoCo Star Hotel"
                      className="h-10 rounded-xl border-border/80"
                    />
                  </div>

                  <div>
                    <label htmlFor="google_maps_url" className="text-xs font-bold text-foreground mb-1.5 block">
                      Google Maps URL / Share Link
                    </label>
                    <Input
                      id="google_maps_url"
                      value={form.google_maps_url}
                      onChange={(e) => setForm((p) => ({ ...p, google_maps_url: e.target.value }))}
                      placeholder="https://maps.app.goo.gl/..."
                      className="h-10 rounded-xl border-border/80 font-data text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="hotel_address" className="text-xs font-bold text-foreground mb-1.5 block">Full Physical Address</label>
                  <Input
                    id="hotel_address"
                    value={form.address}
                    onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                    placeholder="Street, District, City, Country"
                    className="h-10 rounded-xl border-border/80"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="hotel_latitude" className="text-xs font-bold text-foreground mb-1.5 block flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-primary" /> Latitude
                    </label>
                    <Input
                      id="hotel_latitude"
                      type="number"
                      step="any"
                      value={form.latitude}
                      onChange={(e) => setForm((p) => ({ ...p, latitude: e.target.value }))}
                      className="h-10 rounded-xl border-border/80 font-data"
                    />
                  </div>

                  <div>
                    <label htmlFor="hotel_longitude" className="text-xs font-bold text-foreground mb-1.5 block flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-primary" /> Longitude
                    </label>
                    <Input
                      id="hotel_longitude"
                      type="number"
                      step="any"
                      value={form.longitude}
                      onChange={(e) => setForm((p) => ({ ...p, longitude: e.target.value }))}
                      className="h-10 rounded-xl border-border/80 font-data"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-border/60">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={seedNaiaMutation.isPending}
                    onClick={() => setNaiaConfirmOpen(true)}
                    className="h-9 text-xs rounded-xl"
                  >
                    <Plane className="w-4 h-4 mr-1.5 text-info" />
                    {seedNaiaMutation.isPending ? "Syncing Routes..." : "Sync All NAIA Airport Terminal Routes"}
                  </Button>

                  <div className="flex flex-col items-end gap-1">
                    <Button
                      type="submit"
                      size="sm"
                      disabled={!hotelData || updateMutation.isPending}
                      className="h-9 text-xs rounded-xl active:scale-[0.98] transition-transform"
                      title={!hotelData ? "Loading current configuration…" : undefined}
                    >
                      <Save className="w-4 h-4 mr-1.5" />
                      {updateMutation.isPending ? "Saving Location..." : "Save Hotel Location & Coordinates"}
                    </Button>
                    {!hotelData && (
                      <span className="text-[11px] text-foreground-muted">Loading current configuration…</span>
                    )}
                  </div>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── SYSTEM PREFERENCES + APPEARANCE ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className={SHELL}>
          <Card className={INNER_CARD}>
            <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Globe className="w-4 h-4" />
                </div>
                <CardTitle className="text-sm font-extrabold text-foreground">System Preferences</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-4 space-y-3">
              {[
                { icon: AppWindow, label: "Application Name", value: APP_NAME, mono: false },
                { icon: Clock, label: "Timezone", value: timezone, mono: true },
                { icon: Languages, label: "Date Format", value: dateExample, mono: true },
              ].map((row) => (
                <div
                  key={row.label}
                  className="flex items-center gap-3 p-3 rounded-2xl border border-border/60 bg-surface"
                >
                  <div className="w-9 h-9 rounded-xl bg-hover text-foreground-secondary flex items-center justify-center shrink-0">
                    <row.icon className="w-4 h-4" strokeWidth={1.75} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-foreground-muted uppercase tracking-wide">{row.label}</p>
                    <p className={cn("text-sm font-semibold text-foreground truncate", row.mono && "font-data")}>
                      {row.value}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className={SHELL}>
          <Card className={INNER_CARD}>
            <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Palette className="w-4 h-4" />
                </div>
                <CardTitle className="text-sm font-extrabold text-foreground">Appearance</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-5 pt-4">
              <div>
                <label className="text-xs font-bold text-foreground-secondary mb-2 block">Theme</label>
                <div className="grid grid-cols-3 gap-2">
                  {THEME_MODES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={(e) => setThemeMode(t.value, e)}
                      className={cn(
                        "relative flex flex-col items-center gap-1.5 p-3 rounded-2xl border text-center cursor-pointer transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98]",
                        themeMode === t.value
                          ? "border-primary bg-primary/10"
                          : "border-border/80 bg-surface hover:border-primary/40"
                      )}
                    >
                      <t.icon
                        className={cn(
                          "w-4 h-4",
                          themeMode === t.value ? "text-primary" : "text-foreground-secondary"
                        )}
                        strokeWidth={1.75}
                      />
                      <span
                        className={cn(
                          "text-xs font-bold",
                          themeMode === t.value ? "text-primary" : "text-foreground-secondary"
                        )}
                      >
                        {t.label}
                      </span>
                      {themeMode === t.value && (
                        <span className="absolute top-1.5 right-1.5 w-3.5 h-3.5 rounded-full bg-primary text-surface flex items-center justify-center">
                          <Check className="w-2.5 h-2.5" strokeWidth={3} />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-foreground-muted mt-2">
                  System follows your device&apos;s appearance setting.
                </p>
              </div>

              <div>
                <label className="text-xs font-bold text-foreground-secondary mb-2 block">Sidebar Behavior</label>
                <div className="grid grid-cols-3 gap-2">
                  {SIDEBAR_MODES.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setSidebarMode(m.value)}
                      title={m.description}
                      className={cn(
                        "relative flex flex-col items-center gap-1.5 p-3 rounded-2xl border text-center cursor-pointer transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98]",
                        m.value === sidebarMode
                          ? "border-primary bg-primary/10"
                          : "border-border/80 bg-surface hover:border-primary/40"
                      )}
                    >
                      <m.icon
                        className={cn(
                          "w-4 h-4",
                          m.value === sidebarMode ? "text-primary" : "text-foreground-secondary"
                        )}
                        strokeWidth={1.75}
                      />
                      <span
                        className={cn(
                          "text-xs font-bold",
                          m.value === sidebarMode ? "text-primary" : "text-foreground-secondary"
                        )}
                      >
                        {m.label}
                      </span>
                      {m.value === sidebarMode && (
                        <span className="absolute top-1.5 right-1.5 w-3.5 h-3.5 rounded-full bg-primary text-surface flex items-center justify-center">
                          <Check className="w-2.5 h-2.5" strokeWidth={3} />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-foreground-muted mt-2">
                  {SIDEBAR_MODES.find((m) => m.value === sidebarMode)?.description}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── INTEGRATIONS & CONNECTORS ── */}
      <div className={SHELL}>
        <Card className={INNER_CARD}>
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Share2 className="w-4 h-4" />
                  </div>
                  <CardTitle className="text-sm font-extrabold text-foreground">
                    Integrations &amp; Connectors
                  </CardTitle>
                </div>
                <CardDescription className="text-xs text-foreground-secondary mt-1.5">
                  Live configuration status for every external service, verified server-side.
                </CardDescription>
              </div>
              {!connectorsLoading && connectors && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {summaryChips.map((chip) => (
                    <span
                      key={chip.label}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold",
                        chip.cls
                      )}
                    >
                      <span className={cn("w-1.5 h-1.5 rounded-full", chip.dot)} />
                      {chip.n} {chip.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {connectorsLoading ? (
              <div className="p-1">
                {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                    <div className="w-10 h-10 rounded-2xl bg-hover animate-pulse" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-32 bg-hover rounded-full animate-pulse" />
                      <div className="h-2.5 w-48 bg-hover rounded-full animate-pulse" />
                    </div>
                    <div className="h-5 w-20 bg-hover rounded-full animate-pulse" />
                  </div>
                ))}
              </div>
            ) : connectors ? (
              <div className="divide-y divide-border/50">
                {connectors.map((c) => {
                  const meta = STATUS_META[c.status] || STATUS_META.missing;
                  const Icon = CONNECTOR_ICONS[c.id] || Cable;
                  return (
                    <div
                      key={c.id}
                      className="group flex items-center gap-4 px-4 py-3.5 transition-colors duration-200 hover:bg-primary/[0.03]"
                    >
                      <div className="relative shrink-0">
                        <div className="w-10 h-10 rounded-2xl border border-border/70 bg-surface flex items-center justify-center text-foreground-secondary transition-colors duration-200 group-hover:text-primary group-hover:border-primary/40">
                          <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
                        </div>
                        <span
                          className={cn(
                            "absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-surface",
                            meta.dot
                          )}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-bold text-foreground">{c.name}</p>
                          <span className="text-[11px] font-data text-foreground-muted">{c.category}</span>
                        </div>
                        <p className="text-xs text-foreground-muted truncate">{c.description}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <Badge
                          variant={meta.badge}
                          title={meta.title}
                          className="text-[10px] font-bold rounded-full px-2.5 py-0.5"
                        >
                          {meta.label}
                        </Badge>
                        <p className="text-[11px] font-data text-foreground-muted mt-1 max-w-[200px] truncate">
                          {c.detail}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 px-4 py-6">
                <p className="text-xs text-foreground-muted">Couldn&apos;t verify connector status.</p>
                <Button variant="outline" size="xs" className="rounded-xl" onClick={() => refetchConnectors()}>
                  Retry
                </Button>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-muted/20 border-t border-border/50">
              <p className="text-[11px] text-foreground-muted">
                Status is derived from server-side configuration. Keys are never exposed.
              </p>
              <Button
                variant="ghost"
                size="xs"
                asChild
                className="text-primary gap-1 rounded-xl h-7"
              >
                <a href="/settings/api">
                  Manage credentials <ArrowRight className="w-3 h-3" />
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={naiaConfirmOpen}
        onOpenChange={setNaiaConfirmOpen}
        variant="warning"
        title="Re-seed NAIA routes?"
        message="This creates and updates the NAIA airport terminal routes used for pickups and drop-offs. Existing terminal routes will be refreshed with the latest schedule."
        confirmLabel="Sync routes"
        loading={seedNaiaMutation.isPending}
        onConfirm={() => {
          seedNaiaMutation.mutate(undefined, {
            onSettled: () => setNaiaConfirmOpen(false),
          });
        }}
      />
    </div>
  );
}