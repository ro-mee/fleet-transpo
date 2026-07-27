"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Wrench } from "lucide-react";

export default function MaintenancePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Maintenance</h1>
        <p className="text-foreground-secondary mt-1">Vehicle maintenance and inspections</p>
      </div>
      <Card className="border-0 shadow-sm">
        <CardContent className="py-12 text-center text-foreground-muted">
          <Wrench className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg font-medium">Maintenance module coming soon</p>
          <p className="text-sm mt-1">Schedules, history, and predictive maintenance</p>
        </CardContent>
      </Card>
    </div>
  );
}
