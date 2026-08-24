"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { RotateCw, Upload } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { updateVehicle } from "@/services/vehicle.service";
import { useFormValidation } from "@/lib/validation/useFormValidation";

const renewSchema = {
  registration_expiry: { required: true, type: "date", label: "New registration expiry" },
};

const EMPTY_FORM = { registration_expiry: "", document_number: "" };

function plusOneYear() {
  // Local-date math formatted as YYYY-MM-DD so an <input type="date"> accepts
  // it verbatim; toISOString would drift a day on UTC-negative timezones.
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Post-renewal update for a vehicle's LTO registration (OR/CR).
 *
 * Sends one PUT /api/vehicles/[id] carrying the new `registration_expiry`
 * plus an OR_CR document upsert. The endpoint re-runs syncVehicleStatus when
 * registration_expiry changes, so a grounded vehicle returns to Available
 * without any extra step. The scan is a base64 data URL — same convention as
 * the vehicle form.
 */
export function RenewRegistrationDialog({ canManage = false, vehicleId, currentExpiry, orCrDoc }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [newScanUrl, setNewScanUrl] = useState(null);
  const [formError, setFormError] = useState(null);
  const [scanName, setScanName] = useState(null);
  const { validate, fieldError, registerField, resetValidation } = useFormValidation(renewSchema);

  const renewMutation = useMutation({
    mutationFn: (payload) => updateVehicle(vehicleId, payload),
    onSuccess: (_data, payload) => {
      toast.success(`Registration renewed until ${payload.registration_expiry}`);
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
      closeDialog();
    },
    onError: (err) => setFormError(err.message),
  });

  if (!canManage) return null;

  function openDialog() {
    setFormData({
      registration_expiry: plusOneYear(),
      document_number: orCrDoc?.document_number || "",
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
        // The documents upsert overwrites every column it writes, so carry
        // forward the existing scan when no new one was uploaded — otherwise
        // a renewal without a fresh photo would silently blank out file_url.
        const fileUrl = newScanUrl || orCrDoc?.file_url || null;
        renewMutation.mutate({
          registration_expiry: formData.registration_expiry,
          documents: [
            {
              document_type: "OR_CR",
              document_number: formData.document_number.trim() || null,
              file_url: fileUrl,
              expiry_date: formData.registration_expiry,
            },
          ],
        });
      },
    });
  }

  const submitting = renewMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) closeDialog(); else setOpen(true); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 rounded-xl cursor-pointer" onClick={openDialog}>
          <RotateCw className="w-3.5 h-3.5 mr-1.5" />
          Renew
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Renew LTO Registration</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="p-6 pt-4 space-y-4">
          {currentExpiry && (
            <p className="text-xs text-foreground-secondary -mt-1">
              Current registration expires{" "}
              <span className="font-bold text-foreground">{currentExpiry}</span>.
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="registration_expiry">New Expiry Date *</Label>
            <Input
              id="registration_expiry"
              type="date"
              value={formData.registration_expiry}
              onChange={(e) => setFormData({ ...formData, registration_expiry: e.target.value })}
              ref={registerField("registration_expiry")}
              invalid={fieldError("registration_expiry").invalid}
            />
            {fieldError("registration_expiry").error && (
              <p className="text-xs text-danger">{fieldError("registration_expiry").error}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="or_cr_number">OR/CR Document Number</Label>
            <Input
              id="or_cr_number"
              value={formData.document_number}
              onChange={(e) => setFormData({ ...formData, document_number: e.target.value })}
              placeholder="e.g. 1234-5678901"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="or_cr_scan">New OR/CR Scan</Label>
            <label
              htmlFor="or_cr_scan"
              className="flex items-center justify-center gap-2 h-20 rounded-xl border border-dashed border-border bg-muted/10 hover:bg-muted/30 hover:border-primary/40 transition-colors cursor-pointer text-sm text-foreground-secondary"
            >
              <Upload className="w-4 h-4" />
              {scanName ? (
                <span className="truncate max-w-[220px] font-medium text-foreground">{scanName}</span>
              ) : orCrDoc?.file_url ? (
                <span>Replace existing scan (optional)</span>
              ) : (
                <span>Attach scanned OR/CR (optional)</span>
              )}
            </label>
            <input id="or_cr_scan" type="file" accept="image/*,.pdf" className="hidden" onChange={handleScanUpload} />
          </div>

          {formError && <p className="text-sm text-danger">{formError}</p>}

          <div className="flex items-center justify-end gap-3 pt-2">
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
