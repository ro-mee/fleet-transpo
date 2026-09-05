"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Key, ShieldCheck, Plug } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { HeroHeader } from "@/components/ui/hero-header";
import { EmptyState } from "@/components/ui/empty-state";
import Link from "next/link";

// Honest placeholder. This page previously rendered a fabricated key list
// (fake names, keys and last-used times) which presented invented credentials
// as real ones — a trust failure on a security screen. API-key management is
// not implemented yet; until it ships, this surface says exactly that and
// points admins at the integrations that DO exist today.
export default function ApiKeysPage() {
  useRequireRole();

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={Key}
        title="API Keys & Access Tokens"
        badge="Security & API"
        description="Manage secure secret keys for external system integrations, webhooks, and mobile client authorization."
      />

      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
        <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
          <CardTitle className="text-sm font-extrabold flex items-center gap-2 text-foreground">
            <ShieldCheck className="w-4 h-4 text-primary" /> API Key Management
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={Key}
            title="API key management is coming soon"
            description="FleetOps doesn't issue browser-managed API keys yet. Integrations today authenticate with server-side secrets configured by your administrator — nothing to rotate from this screen."
            variant="waiting"
            size="compact"
          />
          <div className="mt-2 rounded-2xl border border-border bg-surface p-5">
            <p className="flex items-center gap-2 text-sm font-bold text-foreground mb-1.5">
              <Plug className="w-4 h-4 text-primary" />
              Live integrations
            </p>
            <ul className="text-xs text-foreground-secondary space-y-1.5 list-disc pl-5">
              <li>
                Booking gateway ingest — push/pull transport requests (
                <Link href="/reservations/new" className="text-primary hover:underline">try a pull</Link> or see the{" "}
                <Link href="/system/audit" className="text-primary hover:underline">audit log</Link>)
              </li>
              <li>Mobile driver app — bearer-token auth, managed per driver account</li>
              <li>TomTom routing &amp; AI providers — configured in <Link href="/settings/ai" className="text-primary hover:underline">AI Providers</Link></li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
