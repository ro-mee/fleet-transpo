"use client";

import { Card, CardContent } from "@/components/ui/card";
import { MapPin } from "lucide-react";

export default function TrackingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">GPS Tracking</h1>
        <p className="text-foreground-secondary mt-1">Real-time vehicle tracking</p>
      </div>
      <Card className="border-0 shadow-sm">
        <CardContent className="py-12 text-center text-foreground-muted">
          <MapPin className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg font-medium">Tracking module coming soon</p>
          <p className="text-sm mt-1">Live map, route history, and geofences</p>
        </CardContent>
      </Card>
    </div>
  );
}
