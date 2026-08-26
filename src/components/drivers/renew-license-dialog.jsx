"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { RotateCw, Upload, IdCard, Loader2 } from "lucide-react";
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
    if (file.type !== "image/jpeg" && file.type !== "image/png") {
      toast.error("Scan must be a JPEG or PNG image");
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
      <DialogContent className="max-w-lg w-[95vw] md:w-[480px] p-0 overflow-hidden rounded-3xl bg-surface border border-border/80 shadow-2xl">
        <div className="px-6 py-4 border-b border-border/70 bg-surface/80 backdrop-blur-md flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
              <IdCard className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-foreground">
                Renew Driver License
              </DialogTitle>
              <p className="text-xs text-foreground-muted mt-0.5">
                Update LTO driver credential validity & compliance scan.
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {currentExpiry && (
            <div className="rounded-2xl border border-border/70 bg-muted/30 px-3.5 py-2.5 flex items-center justify-between text-xs">
              <span className="text-foreground-muted">Current Validity:</span>
              <span className="font-semibold text-foreground">{currentExpiry}</span>
            </div>
          )}

          <div className="rounded-2xl bg-muted/40 p-1.5 border border-border/80 shadow-2xs">
            <div className="rounded-xl bg-surface p-4 border border-border/50 space-y-3.5">
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

              <div className="space-y-1.5 pt-1">
                <label
                  htmlFor="license_scan"
                  className="flex items-center justify-center gap-2 h-20 rounded-2xl border-2 border-dashed border-border/80 bg-muted/20 hover:bg-muted/40 hover:border-primary/50 transition-all cursor-pointer text-xs text-foreground-secondary"
                >
                  <Upload className="w-4 h-4 text-primary" />
                  {scanName ? (
                    <span className="truncate max-w-[220px] font-bold text-foreground">{scanName}</span>
                  ) : (
                    <span className="font-medium">Attach new license scan (optional)</span>
                  )}
                </label>
                <input id="license_scan" type="file" accept="image/jpeg, image/png" className="hidden" onChange={handleScanUpload} />
              </div>
            </div>
          </div>

          {formError && <p className="text-xs font-semibold text-danger">{formError}</p>}

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <Button type="button" variant="outline" onClick={closeDialog} className="text-xs h-9 px-4">
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="text-xs h-9 px-5 font-bold shadow-xs">
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              Save Renewal
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
