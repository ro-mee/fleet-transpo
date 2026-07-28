"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Key, Copy, RefreshCw, Eye, EyeOff, Plus } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { useState } from "react";

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">API Keys</h1>
          <p className="text-foreground-secondary mt-1">Manage API keys for external integrations</p>
        </div>
        <Button className="h-10">
          <Plus className="w-4 h-4 mr-2" />
          Generate Key
        </Button>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Key className="w-4 h-4 text-primary" /> Your API Keys
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {mockKeys.map((apiKey) => (
            <div key={apiKey.id} className="p-4 rounded-xl border border-border/50 hover:shadow-sm transition-all">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-foreground-muted" />
                  <h4 className="text-sm font-semibold text-foreground">{apiKey.name}</h4>
                  <Badge variant={apiKey.status === "Active" ? "success" : "secondary"} className="text-[9px]">{apiKey.status}</Badge>
                </div>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <code className="flex-1 text-xs bg-muted px-3 py-2 rounded-lg font-data text-foreground-secondary">
                  {visibleKeys[apiKey.id] ? apiKey.key : apiKey.key.substring(0, 12) + "••••••••••••"}
                </code>
                <button onClick={() => toggleVisibility(apiKey.id)} className="p-1.5 rounded-lg hover:bg-hover">
                  {visibleKeys[apiKey.id] ? <EyeOff className="w-4 h-4 text-foreground-muted" /> : <Eye className="w-4 h-4 text-foreground-muted" />}
                </button>
                <button onClick={() => navigator.clipboard?.writeText(apiKey.key)} className="p-1.5 rounded-lg hover:bg-hover">
                  <Copy className="w-4 h-4 text-foreground-muted" />
                </button>
              </div>
              <div className="flex items-center gap-4 text-xs text-foreground-muted">
                <span>Created: {apiKey.created}</span>
                <span>Last used: {apiKey.lastUsed}</span>
                <button className="text-danger hover:underline ml-auto">Revoke</button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Usage Guidelines</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-foreground-secondary space-y-2">
          <p>• Keep your API keys secure and never share them publicly</p>
          <p>• Rotate keys regularly for security best practices</p>
          <p>• Use different keys for development and production</p>
          <p>• Revoke compromised keys immediately</p>
        </CardContent>
      </Card>
    </div>
  );
}
