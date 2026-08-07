"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Key, Copy, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { useState } from "react";
import { toast } from "@/components/ui/toast";
import { HeroHeader, heroButtonOutlineClass, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { cn } from "@/lib/utils";

const mockKeys = [
  { id: 1, name: "Production API Key", key: "fop_live_sk_xxxxxxxxxxxxx", created: "2026-01-15", lastUsed: "2 min ago", status: "Active" },
  { id: 2, name: "Development API Key", key: "fop_test_sk_xxxxxxxxxxxxx", created: "2026-03-20", lastUsed: "1 hr ago", status: "Active" },
  { id: 3, name: "Mobile App Key", key: "fop_live_pk_xxxxxxxxxxxxx", created: "2026-05-10", lastUsed: "5 hrs ago", status: "Active" },
];

export default function ApiKeysPage() {
  useRequireRole(["admin", "system_admin"]);
  const [visibleKeys, setVisibleKeys] = useState({});

  const toggleVisibility = (id) => {
    setVisibleKeys((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const copyToClipboard = (text) => {
    navigator.clipboard?.writeText(text);
    toast.success("API Key copied to clipboard!");
  };

  return (
    <div className="space-y-6">
      {/* ── Hero Header ── */}
      <HeroHeader
        icon={Key}
        title="API Keys & Access Tokens"
        badge="Security & API"
        description="Manage secure secret keys for external system integrations, webhooks, and mobile client authorization."
      />

      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
        <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
          <CardTitle className="text-sm font-extrabold flex items-center gap-2 text-foreground">
            <ShieldCheck className="w-4 h-4 text-primary" /> Active API Keys
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-5 space-y-4">
          {mockKeys.map((apiKey) => (
            <div key={apiKey.id} className="p-4.5 rounded-3xl border border-border/80 bg-surface shadow-xs hover:border-primary/40 transition-all space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-primary shrink-0" />
                  <h4 className="text-sm font-bold text-foreground">{apiKey.name}</h4>
                  <Badge variant={apiKey.status === "Active" ? "success" : "secondary"} className="text-[10px] rounded-full font-bold px-2.5 py-0.5">
                    {apiKey.status}
                  </Badge>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-muted/40 border border-border/60 px-3.5 py-2.5 rounded-xl font-data font-bold text-foreground">
                  {visibleKeys[apiKey.id] ? apiKey.key : apiKey.key.substring(0, 14) + "••••••••••••••••"}
                </code>
                <button
                  type="button"
                  onClick={() => toggleVisibility(apiKey.id)}
                  className="p-2 rounded-3xl border border-border/80 hover:bg-hover text-foreground-muted hover:text-foreground transition-colors cursor-pointer"
                  title={visibleKeys[apiKey.id] ? "Hide API key" : "Show API key"}
                >
                  {visibleKeys[apiKey.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => copyToClipboard(apiKey.key)}
                  className="p-2 rounded-3xl border border-border/80 hover:bg-hover text-foreground-muted hover:text-foreground transition-colors cursor-pointer"
                  title="Copy to clipboard"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-4 text-xs font-medium text-foreground-muted font-data pt-1">
                <span>Created: {apiKey.created}</span>
                <span>•</span>
                <span>Last used: {apiKey.lastUsed}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
        <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
          <CardTitle className="text-sm font-extrabold text-foreground">Usage &amp; Security Guidelines</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 text-xs text-foreground-secondary space-y-2">
          <p className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
            Keep your API keys secure and never share them publicly or commit them to public version control.
          </p>
          <p className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
            Rotate keys regularly for security best practices across environments.
          </p>
          <p className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
            Use distinct credentials for development, staging, and production clusters.
          </p>
          <p className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
            Revoke compromised or unused keys immediately.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
