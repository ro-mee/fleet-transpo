"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";

export default function NotificationTemplatesPage() {
  useRequireRole(["admin", "system_admin"]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Email Templates</h1>
        <p className="text-foreground-secondary mt-1">Manage notification and email templates</p>
      </div>
      <Card className="border-0 shadow-sm">
        <CardContent className="py-12 text-center text-foreground-muted">
          <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg font-medium">Email templates coming soon</p>
          <p className="text-sm mt-1">Customize templates for reservation confirmations, trip alerts, and maintenance reminders</p>
        </CardContent>
      </Card>
    </div>
  );
}
