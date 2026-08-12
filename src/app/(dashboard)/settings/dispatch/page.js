"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { useRequireRole } from "@/lib/auth/role-guard";
import { getDispatchPolicy, updateDispatchPolicy } from "@/services/settings.service";
import {
  DEFAULT_DISPATCH_POLICY,
  MAX_DEPARTURE_TIERS,
  validateDispatchPolicy,
} from "@/lib/dispatch-policy";
import { cn } from "@/lib/utils";
import { HeroHeader } from "@/components/ui/hero-header";
import { Send, TriangleAlert, Timer, Star, Plus, X } from "lucide-react";

// Dispatch policy editor.
//
// These thresholds have always existed in system_settings and been read by the
// priority engine, but nothing ever rendered them — this is the first screen
// that lets an admin change them without a SQL client.
//
// Two independent groups share one record and one PUT: the queue priority bands
// (how a request is ranked) and the departure warnings (when the board shouts
// about an unassigned dispatch).

function ToggleRow({ label, description, checked, onChange }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-xs font-bold text-foreground">{label}</p>
        {description && (
          <p className="text-[11px] text-foreground-muted mt-0.5">{description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors cursor-pointer",
          checked ? "bg-primary" : "bg-border"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all",
            checked ? "left-4.5" : "left-0.5"
          )}
        />
      </button>
    </div>
  );
}

function MinutesField({ label, hint, value, onChange }) {
  return (
    <div className="flex items-center gap-3">
      <Label className="w-36 shrink-0 text-xs font-semibold">{label}</Label>
      <Input
        type="number"
        min="1"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        className="h-9 w-24 rounded-3xl border border-border/80 font-data text-xs"
      />
      <span className="text-[11px] text-foreground-muted">{hint}</span>
    </div>
  );
}

// Seeded from the resolved policy prop rather than an effect, the way
// settings/number-coding does it: the page renders this only once the query has
// data, so there is no fetch-then-sync round trip to reconcile.
function PolicyForm({ policy, queryClient }) {
  const [form, setForm] = useState({ ...DEFAULT_DISPATCH_POLICY, ...policy });
  const [error, setError] = useState(null);

  const saveMutation = useMutation({
    mutationFn: updateDispatchPolicy,
    onSuccess: (saved) => {
      setForm({ ...DEFAULT_DISPATCH_POLICY, ...saved });
      setError(null);
      // The board reads this same key, so an open dispatch tab picks up new
      // thresholds on its next render rather than after a reload.
      queryClient.invalidateQueries({ queryKey: ["dispatch-policy"] });
      toast.success("Dispatch policy saved.");
    },
    onError: (e) => {
      setError(e.message || "Could not save the policy.");
      toast.error(e.message || "Could not save the policy.");
    },
  });

  const tiers = form.departureAlertTiers || [];

  const setTier = (i, raw) => {
    const next = [...tiers];
    next[i] = raw === "" ? "" : Number(raw);
    setForm((f) => ({ ...f, departureAlertTiers: next }));
  };

  const addTier = () => {
    const smallest = Math.min(...tiers.map(Number).filter(Number.isFinite));
    const suggestion = Number.isFinite(smallest) && smallest > 5 ? Math.floor(smallest / 2) : 5;
    setForm((f) => ({ ...f, departureAlertTiers: [...tiers, suggestion] }));
  };

  const removeTier = (i) =>
    setForm((f) => ({ ...f, departureAlertTiers: tiers.filter((_, idx) => idx !== i) }));

  const handleSave = () => {
    // Same validator the route runs, so the admin sees the message before the
    // round trip rather than after a 400.
    const check = validateDispatchPolicy(form);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setError(null);
    saveMutation.mutate(form);
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-danger/30 bg-danger/6 px-4 py-3 text-xs font-semibold text-danger">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* ── QUEUE PRIORITY BANDS ── */}
        <Card className="border-0 shadow-xs rounded-3xl bg-surface">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
            <CardTitle className="text-sm font-extrabold flex items-center gap-2">
              <Timer className="w-4 h-4 text-primary" /> Queue Priority Bands
            </CardTitle>
            <CardDescription className="text-xs text-foreground-secondary mt-0.5">
              Minutes before pickup that separate the derived priority levels in the
              transportation queue.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5 space-y-4">
            <MinutesField
              label="Critical under"
              hint="minutes → Critical"
              value={form.criticalMinutes}
              onChange={(v) => setForm((f) => ({ ...f, criticalMinutes: v }))}
            />
            <MinutesField
              label="High under"
              hint="minutes → High"
              value={form.highMinutes}
              onChange={(v) => setForm((f) => ({ ...f, highMinutes: v }))}
            />
            <MinutesField
              label="Medium under"
              hint="minutes → Medium"
              value={form.mediumMinutes}
              onChange={(v) => setForm((f) => ({ ...f, mediumMinutes: v }))}
            />
            <div className="border-t border-border/60 pt-2">
              <ToggleRow
                label="VIP flag"
                description="Lets a VIP request rise one band toward the top."
                checked={form.enableVipFlag}
                onChange={(v) => setForm((f) => ({ ...f, enableVipFlag: v }))}
              />
              <ToggleRow
                label="Emergency flag"
                description="Emergency requests jump straight to Critical."
                checked={form.enableEmergencyFlag}
                onChange={(v) => setForm((f) => ({ ...f, enableEmergencyFlag: v }))}
              />
            </div>
          </CardContent>
        </Card>

        {/* ── DEPARTURE WARNINGS ── */}
        <Card className="border-0 shadow-xs rounded-3xl bg-surface">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
            <CardTitle className="text-sm font-extrabold flex items-center gap-2">
              <TriangleAlert className="w-4 h-4 text-warning" /> Unassigned Departure Warnings
            </CardTitle>
            <CardDescription className="text-xs text-foreground-secondary mt-0.5">
              Warns dispatchers when a dispatch is missing a vehicle or driver — or is
              pending reassignment — and its departure is approaching.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5 space-y-4">
            <ToggleRow
              label="Departure warnings"
              description="Shown on the dispatch board while it is open."
              checked={form.departureAlertsEnabled}
              onChange={(v) => setForm((f) => ({ ...f, departureAlertsEnabled: v }))}
            />

            <div className={cn("space-y-2", !form.departureAlertsEnabled && "opacity-50")}>
              <Label className="block text-xs font-semibold text-foreground">
                Warning thresholds (minutes before departure)
              </Label>
              <div className="space-y-2 rounded-2xl border border-border/60 bg-muted/20 p-3">
                {tiers.map((t, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="1"
                      value={t ?? ""}
                      disabled={!form.departureAlertsEnabled}
                      onChange={(e) => setTier(i, e.target.value)}
                      className="h-9 w-24 rounded-3xl border border-border/80 font-data text-xs"
                    />
                    <span className="text-[11px] text-foreground-muted flex-1">
                      minutes before departure
                    </span>
                    {tiers.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeTier(i)}
                        disabled={!form.departureAlertsEnabled}
                        aria-label={`Remove the ${t}-minute threshold`}
                        className="text-foreground-muted hover:text-danger transition-colors cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                {tiers.length < MAX_DEPARTURE_TIERS && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!form.departureAlertsEnabled}
                    onClick={addTier}
                    className="h-8 rounded-xl text-xs"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add threshold
                  </Button>
                )}
              </div>
              <p className="text-[11px] text-foreground-muted">
                The tightest threshold a dispatch falls under is the one it alerts at, and the
                last one in the list is treated as the most severe. Once departure time passes,
                the dispatch stays flagged as overdue.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-3">
        <Button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="rounded-xl font-semibold"
        >
          {saveMutation.isPending ? "Saving…" : "Save Dispatch Policy"}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setForm(DEFAULT_DISPATCH_POLICY);
            setError(null);
          }}
          className="rounded-xl font-semibold"
        >
          <Star className="h-3.5 w-3.5 mr-1.5" /> Reset to defaults
        </Button>
      </div>
    </div>
  );
}

export default function DispatchSettingsPage() {
  useRequireRole(["admin", "system_admin"]);
  const queryClient = useQueryClient();

  const { data: policy, isLoading } = useQuery({
    queryKey: ["dispatch-policy"],
    queryFn: getDispatchPolicy,
  });

  return (
    <div className="space-y-6 pb-12 w-full select-none">
      <HeroHeader
        icon={Send}
        title="Dispatch Settings"
        badge="Queue & Alerts"
        description="Priority thresholds for the transportation queue and departure warnings for unassigned dispatches."
      />

      {isLoading ? (
        <p className="p-6 text-sm text-foreground-muted">Loading policy…</p>
      ) : (
        // A failed GET still gets an editor seeded with the defaults, so an
        // admin can write a fresh policy rather than staring at a blank page.
        <PolicyForm policy={policy || DEFAULT_DISPATCH_POLICY} queryClient={queryClient} />
      )}
    </div>
  );
}
