"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getDriver } from "@/services/driver.service";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials, formatDate } from "@/lib/utils";
import {
  User, IdCard, CalendarDays, Star,
  Phone, Mail, MapPin, Award, TrendingUp
} from "lucide-react";

const statusColors = {
  Available: "success",
  "On Trip": "warning",
  "Off Duty": "secondary",
  "On Leave": "info",
  Suspended: "danger",
};

export default function DriverDetailPage() {
  const { id } = useParams();

  const { data: driver, isLoading } = useQuery({
    queryKey: ["driver", id],
    queryFn: () => getDriver(id),
  });

  if (isLoading) return <div className="p-8 text-foreground-muted">Loading...</div>;
  if (!driver) return <div className="p-8 text-foreground-muted">Driver not found</div>;

  const emp = driver.employees || {};

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Avatar className="h-14 w-14 ring-2 ring-border">
          <AvatarFallback className="bg-primary/10 text-primary text-lg">
            {getInitials(`${emp.first_name || ""} ${emp.last_name || ""}`)}
          </AvatarFallback>
        </Avatar>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground">
              {emp.first_name} {emp.last_name}
            </h1>
            <Badge variant={statusColors[driver.driver_status] || "secondary"}>
              {driver.driver_status}
            </Badge>
          </div>
          <p className="text-foreground-secondary">License: {driver.license_number}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <User className="w-4 h-4 text-primary" /> Personal Info
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <Mail className="w-4 h-4 text-foreground-muted" />
              <span>{emp.email || "—"}</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Phone className="w-4 h-4 text-foreground-muted" />
              <span>{emp.phone || "—"}</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <MapPin className="w-4 h-4 text-foreground-muted" />
              <span>{emp.address || "—"}</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <CalendarDays className="w-4 h-4 text-foreground-muted" />
              <span>Joined {emp.hire_date ? formatDate(emp.hire_date) : "—"}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <IdCard className="w-4 h-4 text-primary" /> License Info
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-foreground-muted">Number</span>
              <span className="font-medium">{driver.license_number}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-foreground-muted">Class</span>
              <span className="font-medium">{driver.license_class || "—"}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-foreground-muted">Expiry</span>
              <span className="font-medium">
                {driver.license_expiry ? formatDate(driver.license_expiry) : "—"}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-foreground-muted">Experience</span>
              <span className="font-medium">{driver.years_experience || 0} years</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Award className="w-4 h-4 text-primary" /> Performance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Star className="w-5 h-5 text-warning fill-warning" />
              <span className="text-2xl font-bold">{driver.performance_score ? (driver.performance_score * 20).toFixed(0) : 0}</span>
              <span className="text-sm text-foreground-muted">/ 100</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-foreground-muted">Performance Score</span>
                <span>{driver.performance_score || 0}/5</span>
              </div>
              <div className="flex justify-between">
                <span className="text-foreground-muted">Experience</span>
                <span>{driver.years_of_experience || 0} years</span>
              </div>
              <div className="flex justify-between">
                <span className="text-foreground-muted">Rating</span>
                <span>{driver.rating || 0}/5</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" /> Trip Statistics
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="text-center p-4 rounded-xl bg-muted/30">
              <p className="text-2xl font-bold">{driver.total_trips || 0}</p>
              <p className="text-xs text-foreground-muted">Total Trips</p>
            </div>
            <div className="text-center p-4 rounded-xl bg-muted/30">
              <p className="text-2xl font-bold">{driver.total_distance ? `${Math.round(driver.total_distance)} km` : "0"}</p>
              <p className="text-xs text-foreground-muted">Total Distance</p>
            </div>
            <div className="text-center p-4 rounded-xl bg-muted/30">
              <p className="text-2xl font-bold">{driver.total_hours || 0}h</p>
              <p className="text-xs text-foreground-muted">Total Hours</p>
            </div>
            <div className="text-center p-4 rounded-xl bg-muted/30">
              <p className="text-2xl font-bold">{driver.license_class || "—"}</p>
              <p className="text-xs text-foreground-muted">License Class</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
