"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, Key, Lock, Smartphone, History, AlertTriangle } from "lucide-react";

export default function SecurityPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Security</h1>
        <p className="text-foreground-secondary mt-1">Manage account security and authentication methods</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Key className="w-4 h-4 text-primary" /> Change Password
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm text-foreground-secondary mb-1 block">Current Password</label>
              <div className="h-10 px-3 rounded-xl border border-border bg-surface flex items-center text-sm text-foreground-muted">••••••••</div>
            </div>
            <div>
              <label className="text-sm text-foreground-secondary mb-1 block">New Password</label>
              <div className="h-10 px-3 rounded-xl border border-border bg-surface flex items-center text-sm text-foreground-muted">••••••••</div>
            </div>
            <div>
              <label className="text-sm text-foreground-secondary mb-1 block">Confirm New Password</label>
              <div className="h-10 px-3 rounded-xl border border-border bg-surface flex items-center text-sm text-foreground-muted">••••••••</div>
            </div>
            <Button>Update Password</Button>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-primary" /> Two-Factor Authentication
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
              <Shield className="w-8 h-8 text-foreground-muted" />
              <div>
                <p className="text-sm font-medium">2FA Status</p>
                <Badge variant="secondary" className="mt-1">Not Enabled</Badge>
              </div>
            </div>
            <p className="text-sm text-foreground-secondary">
              Add an extra layer of security to your account by enabling two-factor authentication.
            </p>
            <Button variant="outline">Enable 2FA</Button>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <History className="w-4 h-4 text-primary" /> Recent Sessions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { device: "Chrome on Windows", location: "Manila, PH", ip: "192.168.1.100", lastActive: "2 min ago", current: true },
              { device: "Safari on iPhone", location: "Quezon City, PH", ip: "192.168.1.101", lastActive: "2 hrs ago", current: false },
              { device: "Firefox on macOS", location: "Makati, PH", ip: "192.168.1.102", lastActive: "3 days ago", current: false },
            ].map((session, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg hover:bg-hover transition-colors">
                <div className={`w-2 h-2 rounded-full ${session.current ? "bg-success" : "bg-muted"}`} />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{session.device}</p>
                    {session.current && <Badge variant="success" className="text-[9px]">Current</Badge>}
                  </div>
                  <p className="text-xs text-foreground-muted">{session.location} · {session.ip}</p>
                </div>
                <span className="text-xs text-foreground-muted">{session.lastActive}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
