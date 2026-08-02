"use client";

import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { FileText } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";

export default function NotificationTemplatesPage() {
  useRequireRole(["admin", "system_admin"]);
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="System"
        title="Email Templates"
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
