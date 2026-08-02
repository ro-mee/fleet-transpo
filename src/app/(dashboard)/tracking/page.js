"use client";

import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { MapPin, Route as RouteIcon, ChevronRight } from "lucide-react";
import Link from "next/link";

const modules = [
  {
    title: "Live Map",
    description: "See every active vehicle on a real-time GPS map.",
    href: "/tracking/live-map",
    icon: MapPin,
  },
  {
    title: "Route History",
    description: "Review completed trips and their route tracking data.",
    href: "/tracking/history",
    icon: RouteIcon,
  },
];

export default function TrackingPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Tracking"
        title="GPS Tracking"
        description="Real-time vehicle location and trip tracking."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl">
        {modules.map((m) => (
          <Link key={m.href} href={m.href} className="group">
            <Card className="border-0 shadow-sm transition-all hover:shadow-md">
              <CardContent className="p-6 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <m.icon className="w-5 h-5" />
                  </span>
                  <div>
                    <p className="text-base font-semibold text-foreground">{m.title}</p>
                    <p className="text-sm text-foreground-secondary mt-0.5">{m.description}</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-foreground-muted transition-transform group-hover:translate-x-0.5" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
