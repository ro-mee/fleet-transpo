"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { ShieldCheck } from "lucide-react";
import { getMyDriverProfile, acceptDriverConsent } from "@/services/driver.service";

// Shared privacy-consent gate for every Driver Workspace page. Reads the same
// ["driver-me"] query the pages use, so the profile fetch is cached and never
// duplicated. Until the current policy is accepted, personal-data sections are
// replaced by the consent card.
export function DriverConsentGate({ children }) {
  const queryClient = useQueryClient();
  const [accepted, setAccepted] = useState(false);

  const { data: profile, isLoading } = useQuery({
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

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-40 bg-muted rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (profile?.consent && !profile.consent.accepted) {
    return (
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
    );
  }

  return <>{children}</>;
}
