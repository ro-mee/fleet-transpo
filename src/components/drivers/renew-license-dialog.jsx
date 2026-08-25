"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { RotateCw, Upload } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { updateDriver } from "@/services/driver.service";
import { DatePicker } from "@/components/ui/date-picker";
import { useFormValidation } from "@/lib/validation/useFormValidation";

const renewSchema = {
  license_expiry: { required: true, type: "date", label: "New license expiry" },
};

const EMPTY_FORM = { license_expiry: "" };

function plusYears(years = 5) {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function RenewLicenseDialog({ canManage = false, driverId, currentExpiry }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [newScanUrl, setNewScanUrl] = useState(null);
  const [formError, setFormError] = useState(null);
  const [scanName, setScanName] = useState(null);
  const { validate, fieldError, resetValidation } = useFormValidation(renewSchema);

  const renewMutation = useMutation({
    mutationFn: (payload) => updateDriver(driverId, payload),
    onSuccess: (_data, payload) => {
      toast.success(`License renewed until ${payload.license_expiry}`);
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      queryClient.invalidateQueries({ queryKey: ["driver", driverId] });
      closeDialog();
    },
    onError: (err) => setFormError(err.message),
  });

  if (!canManage) return null;

  function openDialog() {
    setFormData({
      license_expiry: plusYears(5), // Philippine licenses are often 5 or 10 years
    });
    setNewScanUrl(null);
    setScanName(null);
    setFormError(null);
    resetValidation();
    setOpen(true);
  }

  function closeDialog() {
    setOpen(false);
    setFormError(null);
  }

  function handleScanUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Scan must be less than 5MB");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setNewScanUrl(reader.result);
      setScanName(file.name);
      toast.success("New scan attached — submit to save it.");
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);

    validate(formData, {
      onSuccess: () => {
        const payload = {
          license_expiry: formData.license_expiry,
        };
        if (newScanUrl) {
          payload.license_image_url = newScanUrl;
        }
        renewMutation.mutate(payload);
      },
    });
  }

  const submitting = renewMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) closeDialog(); else setOpen(true); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs font-semibold rounded-xl cursor-pointer shadow-xs border-border/80" onClick={openDialog}>
          <RotateCw className="w-3.5 h-3.5 mr-1.5" />
          Renew
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Renew Driver License</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="p-6 pt-4 space-y-4">
          {currentExpiry && (
            <p className="text-xs text-foreground-secondary -mt-1">
              Current license expires{" "}
              <span className="font-bold text-foreground">{currentExpiry}</span>.
            </p>
          )}

          <div className="space-y-1.5">
            <DatePicker
              id="license_expiry"
              label="New Expiry Date *"
              value={formData.license_expiry}
              onChange={(val) => {
                setFormData({ ...formData, license_expiry: val });
              }}
            />
            {fieldError("license_expiry").error && (
              <p className="text-xs text-danger">{fieldError("license_expiry").error}</p>
            )}
          </div>

          <div className="space-y-1.5 pt-2">
            <label
              htmlFor="license_scan"
              className="flex items-center justify-center gap-2 h-20 rounded-xl border border-dashed border-border bg-muted/10 hover:bg-muted/30 hover:border-primary/40 transition-colors cursor-pointer text-sm text-foreground-secondary"
            >
              <Upload className="w-4 h-4" />
              {scanName ? (
                <span className="truncate max-w-[220px] font-medium text-foreground">{scanName}</span>
              ) : (
                <span>Attach new license scan (optional)</span>
              )}
            </label>
            <input id="license_scan" type="file" accept="image/*,.pdf" className="hidden" onChange={handleScanUpload} />
          </div>

          {formError && <p className="text-sm text-danger">{formError}</p>}

          <div className="flex items-center justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving..." : "Save Renewal"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
