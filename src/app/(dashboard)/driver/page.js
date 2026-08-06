"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { toast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useRequireRole } from "@/lib/auth/role-guard";
import {
  getMyDriverProfile,
  acceptDriverConsent,
  getMyVehicleInspection,
  getMyIncidents,
  reportIncident,
} from "@/services/driver.service";
import { formatDate } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  IdCard, Award, Truck, CalendarCheck, ShieldCheck, Fingerprint,
  CheckCircle2, Phone, Download, CarFront, AlertTriangle, Send
} from "lucide-react";

export default function DriverHomePage() {
  useRequireRole(["driver"]);
  const queryClient = useQueryClient();
  const [accepted, setAccepted] = useState(false);

  const { data: profile, isLoading, isError } = useQuery({
    queryKey: ["driver-me"],
    queryFn: getMyDriverProfile,
  });

  const consentMutation = useMutation({
    mutationFn: () => acceptDriverConsent({ policyVersion: profile?.consent?.requiredVersion, via: "web" }),
    onSuccess: () => {
      toast.success("Thank you. Your consent has been recorded.");
      queryClient.invalidateQueries({ queryKey: ["driver-me"] });
    },
    onError: (err) => toast.error(err.message || "Could not record consent."),
  });

  const needsConsent = useMemo(
    () => profile?.consent && !profile.consent.accepted,
    [profile]
  );

  const { data: inspection, isLoading: inspectionLoading } = useQuery({
    queryKey: ["driver-inspection"],
    queryFn: getMyVehicleInspection,
    enabled: !!profile && !needsConsent,
  });
  const { data: incidents = [] } = useQuery({
    queryKey: ["driver-incidents"],
    queryFn: getMyIncidents,
    enabled: !!profile && !needsConsent,
  });
  const [incidentForm, setIncidentForm] = useState({
    incident_type: "",
    severity: "Minor",
    location: "",
    description: "",
  });
  const reportMutation = useMutation({
    mutationFn: () => reportIncident(incidentForm),
    onSuccess: () => {
      toast.success("Incident reported. Thank you for flagging it.");
      setIncidentForm({ incident_type: "", severity: "Minor", location: "", description: "" });
      queryClient.invalidateQueries({ queryKey: ["driver-incidents"] });
    },
    onError: (err) => toast.error(err.message || "Could not submit the incident report."),
  });

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-5xl">
        <Skeleton className="h-8 w-64" />
        <div className="h-40 bg-muted rounded-2xl animate-pulse" />
        <div className="h-72 bg-muted rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (isError || !profile) {
    return (
      <EmptyState
        icon={Truck}
        title="Driver profile unavailable"
        description="We couldn't load your profile. Please try again or contact your fleet administrator."
      />
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader
        title={`Hello, ${profile.firstName}`}
        description="A snapshot of your profile, trips, and performance."
      />

      {/* Consent gate */}
      {needsConsent && (
        <Card className="border-primary/40 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" /> {profile.consent.policy.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-foreground-secondary">
              Our privacy policy describes what personal information we collect
              (including your driver&apos;s license scan, face photo, and live location
              while on duty), how we use it, and your rights. Please review it
              before viewing or updating your personal data.
            </p>
            <div className="space-y-2 rounded-xl bg-muted/40 border border-border p-4 text-xs">
              {profile.consent.policy.sections.map((s) => (
                <div key={s.heading}>
                  <p className="font-semibold text-foreground">{s.heading}</p>
                  <p className="text-foreground-secondary mt-0.5">{s.body}</p>
                </div>
              ))}
            </div>
            <label className="flex items-start gap-2.5 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span>
                I have read and agree to the Driver Data Privacy &amp; Terms.
              </span>
            </label>
            <Button
              disabled={!accepted || consentMutation.isPending}
              onClick={() => consentMutation.mutate()}
            >
              {consentMutation.isPending ? "Recording…" : "I agree — continue"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Trips */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Truck className="w-4 h-4 text-primary" /> My Trip History ({profile.trips.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {profile.trips.length === 0 ? (
            <EmptyState
              icon={Truck}
              title="No trips yet"
              description="Assigned trips will appear here once your dispatcher schedules you."
              className="py-10"
            />
          ) : (
            <div className="divide-y divide-border">
              {profile.trips.map((t) => (
                <div key={t.trip_id} className="py-3 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-medium text-foreground">
                      Trip #{t.trip_id} • {t.origin || "Origin"} ➔ {t.destination || "Destination"}
                    </div>
                    <div className="text-foreground-secondary mt-0.5">
                      {t.plate_number ? `Vehicle: ${t.plate_number}` : `Vehicle #${t.vehicle_id}`}
                    </div>
                  </div>
                  <div className="text-right">
                    <StatusBadge severity={t.trip_status === "Completed" ? "success" : t.trip_status === "In Progress" ? "warning" : "info"}>
                      {t.trip_status}
                    </StatusBadge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* My Vehicle */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <CarFront className="w-4 h-4 text-primary" /> My Vehicle
          </CardTitle>
        </CardHeader>
        <CardContent>
          {inspectionLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : inspection ? (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
              <div>
                <p className="text-foreground-muted">Vehicle</p>
                <p className="font-medium mt-1">{inspection.plate_number || `#${inspection.vehicle_id}`}</p>
              </div>
              <div>
                <p className="text-foreground-muted">Last Inspection</p>
                <p className="font-medium mt-1">{inspection.inspection_date ? formatDate(inspection.inspection_date) : "—"}</p>
              </div>
              <div>
                <p className="text-foreground-muted">Status</p>
                <p className="mt-1"><StatusBadge severity={inspection.status === "Passed" ? "success" : inspection.severity === "Critical" ? "danger" : inspection.severity === "Major" ? "warning" : "info"}>{inspection.status}</StatusBadge></p>
              </div>
              <div>
                <p className="text-foreground-muted">Condition</p>
                <p className="font-medium mt-1">{inspection.findings || inspection.inspection_type || "No findings"}</p>
              </div>
            </div>
          ) : (
            <EmptyState
              icon={CarFront}
              title="No vehicle assigned"
              description="Your assigned vehicle and its inspection status will appear here."
              className="py-8"
            />
          )}
        </CardContent>
      </Card>

      {/* Incident report */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-primary" /> Report an Incident
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input placeholder="Incident type (e.g. vehicle breakdown, accident, near miss)"
              value={incidentForm.incident_type}
              onChange={(e) => setIncidentForm({ ...incidentForm, incident_type: e.target.value })} />
            <Input placeholder="Location" value={incidentForm.location}
              onChange={(e) => setIncidentForm({ ...incidentForm, location: e.target.value })} />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-foreground-muted w-16">Severity</label>
            {["Minor", "Moderate", "Major", "Critical"].map((s) => (
              <button key={s} type="button"
                onClick={() => setIncidentForm({ ...incidentForm, severity: s })}
                className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
                  incidentForm.severity === s ? "bg-foreground text-surface border-foreground" : "border-border text-foreground-secondary hover:bg-hover"
                }`}>
                {s}
              </button>
            ))}
          </div>
          <textarea
            rows={3}
            placeholder="Describe what happened…"
            value={incidentForm.description}
            onChange={(e) => setIncidentForm({ ...incidentForm, description: e.target.value })}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <div className="flex items-center gap-3">
            <Button
              disabled={reportMutation.isPending || !incidentForm.incident_type || !incidentForm.description}
              onClick={() => reportMutation.mutate()}
            >
              <Send className="w-4 h-4 mr-2" />
              {reportMutation.isPending ? "Submitting…" : "Report Incident"}
            </Button>
          </div>

          {incidents.length > 0 && (
            <div className="divide-y divide-border border-t pt-3">
              {incidents.slice(0, 5).map((inc) => (
                <div key={inc.incident_id} className="py-2.5 flex items-center justify-between text-xs">
                  <div className="min-w-0 pr-3">
                    <div className="font-medium text-foreground truncate">{inc.incident_type}</div>
                    <div className="text-foreground-muted truncate">{inc.description}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <StatusBadge severity={inc.severity === "Critical" ? "danger" : inc.severity === "Major" ? "warning" : "info"}>{inc.severity}</StatusBadge>
                    <div className="text-[11px] text-foreground-muted mt-1">{inc.incident_date ? formatDate(inc.incident_date) : "—"}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* License day / credentials */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <IdCard className="w-4 h-4 text-primary" /> License &amp; Credentials
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div>
            <p className="text-foreground-muted">License Number</p>
            <p className="font-mono font-medium mt-1">{profile.license.number || "—"}</p>
          </div>
          <div>
            <p className="text-foreground-muted">Class / Type</p>
            <p className="font-medium mt-1">Class {profile.license.class || "B"} • {profile.license.type || "Professional"}</p>
          </div>
          <div>
            <p className="text-foreground-muted">Expiration</p>
            <p className="font-medium mt-1">{profile.license.expiry ? formatDate(profile.license.expiry) : "—"}</p>
          </div>
        </CardContent>
      </Card>

      {/* Performance */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Award className="w-4 h-4 text-primary" /> My Performance
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <Stat label="Total Trips" value={profile.performance?.total_trips ?? 0} />
          <Stat label="Distance" value={`${Math.round(profile.performance?.total_distance ?? 0)} km`} />
          <Stat label="Hours" value={`${Math.round(profile.performance?.total_hours ?? 0)}h`} />
          <Stat label="Rating" value={`${((profile.performance?.rating ?? 0) * 20).toFixed(0)}/100`} />
        </CardContent>
      </Card>

      {/* Attendance */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <CalendarCheck className="w-4 h-4 text-primary" /> My Attendance
          </CardTitle>
        </CardHeader>
        <CardContent>
          {profile.attendance.length === 0 ? (
            <EmptyState
              icon={Fingerprint}
              title="No attendance records"
              description="Your check-in / check-out records will appear here."
              className="py-8"
            />
          ) : (
            <div className="divide-y divide-border">
              {profile.attendance.map((a) => (
                <div key={a.attendance_id} className="py-2 flex items-center justify-between text-xs">
                  <span className="font-medium">{formatDate(a.date)}</span>
                  <span className="text-foreground-secondary">
                    In: {a.time_in ? new Date(a.time_in).toLocaleTimeString() : "—"} • Out: {a.time_out ? new Date(a.time_out).toLocaleTimeString() : "—"}
                  </span>
                  <StatusBadge severity="info">{a.status}</StatusBadge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="p-3 rounded-xl bg-muted/40">
      <p className="text-lg font-bold text-foreground">{value}</p>
      <p className="text-[11px] text-foreground-muted">{label}</p>
    </div>
  );
}