"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HeroHeader } from "@/components/ui/hero-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { toast } from "@/components/ui/toast";
import { getMyIncidents, reportIncident } from "@/services/driver.service";
import { incidentTypeLabel } from "@/lib/incidents/resolution";
import { resolveIncidentCoords } from "@/lib/geo/incident-coords";
import { formatDate } from "@/lib/utils";
import { useRequireRole } from "@/lib/auth/role-guard";
import { DriverConsentGate } from "@/components/driver/consent-gate";
import { AlertTriangle, MapPin, Send } from "lucide-react";

export default function DriverIncidentsPage() {
  useRequireRole();
  const queryClient = useQueryClient();

  const { data: incidents = [] } = useQuery({
    queryKey: ["driver-incidents"],
    queryFn: getMyIncidents,
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

  return (
    <DriverConsentGate>
      <div className="space-y-6">
        <HeroHeader
          icon={AlertTriangle}
          title="Incident Reporting"
          badge="My Work"
          description="Report an incident and track the reports you have submitted."
        />

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-primary" /> Report an Incident
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="incident_type" className="text-xs font-semibold text-foreground-secondary">
                  Incident type <span className="text-danger">*</span>
                </Label>
                <Input id="incident_type" placeholder="Incident type (e.g. vehicle breakdown, accident, near miss)"
                  value={incidentForm.incident_type}
                  onChange={(e) => setIncidentForm({ ...incidentForm, incident_type: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="incident_location" className="text-xs font-semibold text-foreground-secondary">Location</Label>
                <Input id="incident_location" placeholder="Location" value={incidentForm.location}
                  onChange={(e) => setIncidentForm({ ...incidentForm, location: e.target.value })} />
              </div>
            </div>
            <div
              className="flex items-center gap-2"
              role="radiogroup"
              aria-label="Severity"
            >
              <label className="text-xs text-foreground-muted w-16">Severity</label>
              {["Minor", "Moderate", "Major", "Critical"].map((s) => (
                <button key={s} type="button"
                  role="radio"
                  aria-checked={incidentForm.severity === s}
                  onClick={() => setIncidentForm({ ...incidentForm, severity: s })}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
                    incidentForm.severity === s ? "bg-foreground text-surface border-foreground" : "border-border text-foreground-secondary hover:bg-hover"
                  }`}>
                  {s}
                </button>
              ))}
            </div>
            <div className="space-y-1">
              <Label htmlFor="incident_description" className="text-xs font-semibold text-foreground-secondary">
                Description <span className="text-danger">*</span>
              </Label>
              <textarea
                id="incident_description"
                rows={3}
                placeholder="Describe what happened…"
                value={incidentForm.description}
                onChange={(e) => setIncidentForm({ ...incidentForm, description: e.target.value })}
                className="w-full rounded-3xl border border-border bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
            <div className="flex items-center gap-3">
              <Button
                disabled={reportMutation.isPending || !incidentForm.incident_type || !incidentForm.description}
                onClick={() => reportMutation.mutate()}
              >
                <Send className="w-4 h-4 mr-2" />
                {reportMutation.isPending ? "Submitting…" : "Report Incident"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold">My Incident Reports</CardTitle>
          </CardHeader>
          <CardContent>
            {incidents.length === 0 ? (
              <EmptyState
                icon={AlertTriangle}
                title="No incidents reported"
                description="Incidents you report will appear here."
                className="py-8"
              />
            ) : (
              <div className="divide-y divide-border">
                {incidents.map((inc) => {
                  const coords = resolveIncidentCoords(inc);
                  return (
                  <div key={inc.incident_id} className="py-2.5 flex items-center justify-between text-xs">
                    <div className="min-w-0 pr-3">
                      <div className="font-medium text-foreground">{incidentTypeLabel(inc.incident_type)}</div>
                      <div className="text-foreground-muted">{inc.description}</div>
                      {inc.actions_taken && <div className="mt-1 text-foreground-secondary"><span className="font-semibold">Fleet action:</span> {inc.actions_taken}</div>}
                      {inc.location && <div className="text-foreground-muted mt-0.5">{inc.location}</div>}
                      {coords && (
                        <a
                          href={`https://www.google.com/maps?q=${coords.latitude},${coords.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-primary bg-primary/10 border border-primary/25 rounded-lg px-2 py-1 mt-1.5 hover:bg-primary/15 hover:border-primary transition-colors"
                          title="Open exact location in Google Maps to share with emergency services"
                        >
                          <MapPin className="w-3 h-3" />
                          View on Google Maps
                        </a>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <StatusBadge status={inc.status || "Open"} entity="incident" />
                        <StatusBadge
                          status={inc.severity === "Critical" ? "critical" : inc.severity === "Major" ? "high" : inc.severity === "Moderate" ? "medium" : "low"}
                          entity="severity"
                          label={inc.severity || "Minor"}
                        />
                      </div>
                      <div className="text-[11px] text-foreground-muted mt-1">{inc.incident_date ? formatDate(inc.incident_date) : "—"}</div>
                      {inc.acknowledged_at && <div className="text-[10px] text-success-700 mt-1">Acknowledged</div>}
                      {inc.resolved_at && <div className="text-[10px] text-foreground-muted mt-0.5">Resolved {formatDate(inc.resolved_at)}</div>}
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DriverConsentGate>
  );
}
