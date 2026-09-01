"use client";

import { Card, CardContent } from "@/components/ui/card";
import { HeroHeader } from "@/components/ui/hero-header";
import { EmptyState } from "@/components/ui/empty-state";
import { FileText } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";

export default function NotificationTemplatesPage() {
  useRequireRole();
  return (
    <div className="space-y-6">
      <HeroHeader
        icon={FileText}
        title="Email Templates"
        badge="System"
        description="Manage notification and email templates."
      />
      <Card className="border-0 shadow-sm">
        <CardContent>
          <EmptyState
            icon={FileText}
            title="Email templates coming soon"
            description="Customize templates for reservation confirmations, trip alerts, and maintenance reminders."
          />
        </CardContent>
      </Card>
    </div>
  );
}
