"use client";

import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HeroHeader } from "@/components/ui/hero-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { DocumentScanCard } from "@/components/ui/document-scan-card";
import { toast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { getMyDriverProfile, updateMyDriverProfile } from "@/services/driver.service";
import { formatDate } from "@/lib/utils";
import { useRequireRole } from "@/lib/auth/role-guard";
import { DriverConsentGate } from "@/components/driver/consent-gate";
import { IdCard, Award, Fingerprint, Pencil, Phone, Lock, ScanLine, Upload } from "lucide-react";

function Stat({ label, value }) {
  return (
    <div className="p-3 rounded-xl bg-muted/40">
      <p className="text-lg font-bold text-foreground">{value}</p>
      <p className="text-[11px] text-foreground-muted">{label}</p>
    </div>
  );
}

// Per-side (front/back) license scan tile
function LicenseScanTile({ label, imageUrl, canUpload, windowDays, side, onUploadSuccess }) {
  const [enlargeUrl, setEnlargeUrl] = useState(null);
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      // 1. Convert to Base64
      const reader = new FileReader();
      const base64Url = await new Promise((resolve, reject) => {
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // 2. Validate with AI (OCR)
      const scanRes = await fetch("/api/driver/license-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ side, file_url: base64Url }),
      });
      const scanData = await scanRes.json();
      if (!scanRes.ok || !scanData.ok) {
        throw new Error(scanData.validation_issues?.[0] || "Could not read license cleanly.");
      }

      // 3. Save to profile
      const field = side === "front" ? "license_image_url" : "license_back_image_url";
      const payload = { [field]: base64Url };
      
      if (side === "front" && scanData.extracted_data?.expiration_date) {
        payload.license_expiry = scanData.extracted_data.expiration_date;
      }

      const updateRes = await fetch("/api/driver/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!updateRes.ok) {
        const errData = await updateRes.json();
        throw new Error(errData.error || "Failed to update profile");
      }

      toast.success(`${label} scan uploaded and analyzed successfully!`);
      if (onUploadSuccess) onUploadSuccess();
    } catch (err) {
      toast.error(err.message || "Failed to upload scan");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <input
        type="file"
        accept="image/*"
        className="hidden"
        ref={fileInputRef}
        onChange={handleFileChange}
      />
      {imageUrl ? (
        <DocumentScanCard
          title={`${label} Scan`}
          icon={IdCard}
          fileUrl={imageUrl}
          onPreview={setEnlargeUrl}
        />
      ) : (
        <div className="p-3 rounded-xl bg-muted/30 border border-dashed border-border text-xs text-foreground-muted flex flex-col items-center justify-center gap-2 h-32">
          <ScanLine className="w-6 h-6 text-foreground-muted/60" />
          <span>No {label.toLowerCase()} scan on file yet.</span>
        </div>
      )}

      {!canUpload && imageUrl ? (
        <p className="text-[11px] text-foreground-muted flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5" />
          View-only. Contact your fleet administrator to update this scan
          {windowDays ? ` (re-uploads open within ${windowDays} days of expiry)` : ""}.
        </p>
      ) : null}

      {canUpload && (
        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs h-8"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? "Analyzing..." : (
            <>
              <Upload className="w-3 h-3 mr-2" />
              {imageUrl ? `Update ${label} Scan` : `Upload ${label} Scan`}
            </>
          )}
        </Button>
      )}

      <Dialog open={!!enlargeUrl} onOpenChange={() => setEnlargeUrl(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <IdCard className="w-5 h-5 text-primary" /> {label} License Scan
            </DialogTitle>
          </DialogHeader>
          <div className="p-2 flex items-center justify-center max-h-[70vh] overflow-auto bg-black/5 rounded-3xl border border-border">
            {enlargeUrl && (
              <img src={enlargeUrl} alt={`${label} license scan`} className="max-h-[65vh] w-auto object-contain rounded-lg shadow-md" />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function DriverProfilePage() {
  useRequireRole(["driver"]);
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState("");

  const { data: profile, isLoading, isError } = useQuery({
    queryKey: ["driver-me"],
    queryFn: getMyDriverProfile,
  });

  const phoneMutation = useMutation({
    mutationFn: () => updateMyDriverProfile({ phone }),
    onSuccess: () => {
      toast.success("Phone number updated.");
      queryClient.invalidateQueries({ queryKey: ["driver-me"] });
      setPhone("");
    },
    onError: (err) => toast.error(err.message || "Could not update your phone number."),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="h-40 bg-muted rounded-2xl animate-pulse" />
        <div className="h-72 bg-muted rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (isError || !profile) {
    return (
      <EmptyState
        icon={IdCard}
        title="Driver profile unavailable"
        description="We couldn't load your profile. Please try again or contact your fleet administrator."
      />
    );
  }

  return (
    <DriverConsentGate>
      <div className="space-y-6">
        <HeroHeader
          icon={IdCard}
          title="Profile & Credentials"
          badge="Account"
          description={`${profile.firstName} ${profile.lastName} — your license, performance, attendance and contact details.`}
        />

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <IdCard className="w-4 h-4 text-primary" /> License &amp; Credentials
            </CardTitle>
          </CardHeader>
          {/* Details on the left, scans alongside on the right — the same
              arrangement the mobile profile uses. Stacks on narrow screens. */}
          <CardContent className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] gap-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs self-start">
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
              <div>
                <p className="text-foreground-muted">Driver Status</p>
                <p className="mt-1"><StatusBadge status={profile.driverStatus} entity="driver" /></p>
              </div>
              <div>
                <p className="text-foreground-muted">Years of Experience</p>
                <p className="font-medium mt-1">{profile.license.yearsExperience ?? 0} yrs</p>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-foreground-muted flex items-center gap-1.5">
                <ScanLine className="w-3.5 h-3.5" /> License Scans
              </p>
              <LicenseScanTile
                label="Front"
                side="front"
                imageUrl={profile.license.frontScanImageUrl}
                canUpload={profile.license.canUploadFront}
                windowDays={profile.license.reuploadWindowDays}
                onUploadSuccess={() => queryClient.invalidateQueries({ queryKey: ["driver-me"] })}
              />
              <LicenseScanTile
                label="Back"
                side="back"
                imageUrl={profile.license.backScanImageUrl}
                canUpload={profile.license.canUploadBack}
                windowDays={profile.license.reuploadWindowDays}
                onUploadSuccess={() => queryClient.invalidateQueries({ queryKey: ["driver-me"] })}
              />
            </div>
          </CardContent>
        </Card>

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

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Phone className="w-4 h-4 text-primary" /> Contact Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 max-w-sm">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={profile.email || ""} disabled className="bg-muted/40" />
            </div>
            <div>
              <Label htmlFor="phone">Phone Number</Label>
              <Input id="phone" placeholder="+63 9XX XXX XXXX" value={phone}
                onChange={(e) => setPhone(e.target.value)} />
            </div>
            <Button
              disabled={phoneMutation.isPending || !phone.trim()}
              onClick={() => phoneMutation.mutate()}
            >
              <Pencil className="w-4 h-4 mr-2" />
              {phoneMutation.isPending ? "Saving…" : "Update Phone"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </DriverConsentGate>
  );
}
