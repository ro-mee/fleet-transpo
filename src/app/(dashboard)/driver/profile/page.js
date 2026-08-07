"use client";

import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { DocumentScanCard } from "@/components/ui/document-scan-card";
import { toast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { getMyDriverProfile, updateMyDriverProfile, scanLicenseDocument } from "@/services/driver.service";
import { formatDate } from "@/lib/utils";
import { useRequireRole } from "@/lib/auth/role-guard";
import { DriverConsentGate } from "@/components/driver/consent-gate";
import { rotateBase64Image } from "@/lib/images";
import { IdCard, Award, Fingerprint, Pencil, Phone, Upload, RotateCw, Lock, ScanLine } from "lucide-react";

function Stat({ label, value }) {
  return (
    <div className="p-3 rounded-xl bg-muted/40">
      <p className="text-lg font-bold text-foreground">{value}</p>
      <p className="text-[11px] text-foreground-muted">{label}</p>
    </div>
  );
}

// Per-side (front/back) license scan tile with the scan-then-save flow.
//
// A scan is only persisted after the AI pass returns `ok` — an "unclear" result
// keeps the upload open so the driver retakes it, and the DB never stores an
// unreadable image. When the side is locked (scan on file, outside the 30-day
// re-upload window) it renders view-only.
function LicenseScanTile({ side, label, imageUrl, canUpload, windowDays }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [pendingImage, setPendingImage] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [unclearMsg, setUnclearMsg] = useState("");
  const [enlargeUrl, setEnlargeUrl] = useState(null);

  const saveScan = useMutation({
    mutationFn: (image) =>
      updateMyDriverProfile(
        side === "back" ? { license_back_image_url: image } : { license_image_url: image }
      ),
    onSuccess: () => {
      toast.success(`${label} scan saved.`);
      setPendingImage(null);
      setPreviewUrl(null);
      setUnclearMsg("");
      queryClient.invalidateQueries({ queryKey: ["driver-me"] });
    },
    onError: (err) => toast.error(err.message || "Could not save your scan."),
  });

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File size must be less than 10MB.");
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setPendingImage(reader.result);
      setPreviewUrl(reader.result);
      setUnclearMsg("");
    };
    reader.readAsDataURL(file);
  };

  const handleRotate = async () => {
    if (!pendingImage) return;
    const rotated = await rotateBase64Image(pendingImage, 90);
    setPendingImage(rotated);
    setPreviewUrl(rotated);
  };

  const handleScanAndUpload = async () => {
    if (!pendingImage) return;
    setIsScanning(true);
    setUnclearMsg("");
    try {
      const res = await scanLicenseDocument({ side, file_url: pendingImage });
      if (res?.ok) {
        saveScan.mutate(pendingImage);
      } else {
        setUnclearMsg(
          "We couldn't read the photo clearly. Please retake with better lighting and keep the card flat and in frame."
        );
      }
    } catch (err) {
      toast.error(err.message || "Could not scan the photo.");
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="space-y-3">
      {imageUrl ? (
        <DocumentScanCard
          title={`${label} Scan`}
          icon={IdCard}
          fileUrl={imageUrl}
          onPreview={setEnlargeUrl}
        />
      ) : (
        <div className="p-3 rounded-xl bg-muted/30 border border-dashed border-border text-xs text-foreground-muted flex items-center gap-2">
          <ScanLine className="w-4 h-4" /> No {label.toLowerCase()} scan on file yet.
        </div>
      )}

      {canUpload ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFile}
            />
            <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload className="w-3.5 h-3.5 mr-1.5" />
              {imageUrl ? "Replace scan" : "Upload scan"}
            </Button>
            {pendingImage && (
              <>
                <Button type="button" variant="outline" size="sm" onClick={handleRotate}>
                  <RotateCw className="w-3.5 h-3.5 mr-1.5" /> Rotate
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={isScanning || saveScan.isPending}
                  onClick={handleScanAndUpload}
                >
                  {isScanning || saveScan.isPending ? "Checking…" : "Scan & Upload"}
                </Button>
              </>
            )}
          </div>
          {unclearMsg && (
            <p className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-lg px-3 py-2">
              {unclearMsg}
            </p>
          )}
          {pendingImage && (
            <img
              src={previewUrl}
              alt={`${label} scan preview`}
              className="max-h-40 rounded-3xl border border-border object-contain bg-black/5"
            />
          )}
        </div>
      ) : (
        <p className="text-[11px] text-foreground-muted flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5" />
          This scan is view-only. You can re-upload within {windowDays} days of your license expiry.
        </p>
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
        <PageHeader
          eyebrow="Account"
          title="Profile & Credentials"
          description={`${profile.firstName} ${profile.lastName} — your license, performance, attendance and contact details.`}
        />

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
            <div>
              <p className="text-foreground-muted">Driver Status</p>
              <p className="mt-1"><StatusBadge status={profile.driverStatus} entity="driver" /></p>
            </div>
            <div>
              <p className="text-foreground-muted">Years of Experience</p>
              <p className="font-medium mt-1">{profile.license.yearsExperience ?? 0} yrs</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <ScanLine className="w-4 h-4 text-primary" /> License Scans
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
            <LicenseScanTile
              side="front"
              label="Front"
              imageUrl={profile.license.frontScanImageUrl}
              canUpload={profile.license.canUploadFront}
              windowDays={profile.license.reuploadWindowDays}
            />
            <LicenseScanTile
              side="back"
              label="Back"
              imageUrl={profile.license.backScanImageUrl}
              canUpload={profile.license.canUploadBack}
              windowDays={profile.license.reuploadWindowDays}
            />
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

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Fingerprint className="w-4 h-4 text-primary" /> My Attendance
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
    </DriverConsentGate>
  );
}
