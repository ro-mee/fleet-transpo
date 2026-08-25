"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { RotateCw, Upload, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { updateVehicle } from "@/services/vehicle.service";
import { scanDocumentWithAi } from "@/services/ai.service";
import { DatePicker } from "@/components/ui/date-picker";
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
 * the vehicle form — and attaching one triggers Gemini extraction that
 * pre-fills the expiry and OR/CR number from the scanned document.
 */
export function RenewRegistrationDialog({ canManage = false, vehicleId, currentExpiry, orCrDoc }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [newScanUrl, setNewScanUrl] = useState(null);
  const [formError, setFormError] = useState(null);
  const [scanName, setScanName] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [expiryTouched, setExpiryTouched] = useState(false);
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
    setScanning(false);
    setExpiryTouched(false);
    resetValidation();
    setOpen(true);
  }

  function closeDialog() {
    setOpen(false);
    setFormError(null);
  }

  // Scan the freshly attached OR/CR and pre-fill fields from what Gemini reads.
  // The extracted expiry replaces the +1y default guess until staff manually
  // edits the date; a typed OR/CR number always wins over the extraction.
  async function autoFillFromScan(fileUrl) {
    setScanning(true);
    try {
      const res = await scanDocumentWithAi({ document_type: "OR_CR", file_url: fileUrl });
      const data = res?.extracted_data || {};
      let filled = 0;
      if (!expiryTouched && data.expiration_date) {
        setFormData((prev) => ({ ...prev, registration_expiry: data.expiration_date }));
        filled += 1;
      }
      if (!formData.document_number.trim() && data.registration_number) {
        setFormData((prev) => ({ ...prev, document_number: String(data.registration_number).toUpperCase() }));
        filled += 1;
      }
      if (filled > 0) {
        toast.success(`OR/CR: auto-filled ${filled} field${filled === 1 ? "" : "s"} — please review before saving.`);
      } else if (res?.validation_issues?.length) {
        toast.error(res.validation_issues[0]);
      } else {
        toast.error("Couldn't read new fields from the scan. Enter them manually.");
      }
    } catch (err) {
      toast.error(err.message || "Failed to scan document with AI");
    } finally {
      setScanning(false);
    }
  }

  function handleScanUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Scan must be less than 10MB");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setNewScanUrl(reader.result);
      setScanName(file.name);
      toast.success("New scan attached! Scanning automatically...");
      autoFillFromScan(reader.result);
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
      <DialogContent className="max-w-lg w-[95vw] md:w-[480px] p-0 overflow-hidden rounded-3xl bg-surface border border-border/80 shadow-2xl">
        <div className="px-6 py-4 border-b border-border/70 bg-surface/80 backdrop-blur-md flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
              <RotateCw className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-foreground">
                Renew LTO Registration
              </DialogTitle>
              <p className="text-xs text-foreground-muted mt-0.5">
                Update official Land Transportation Office validity & OR/CR document.
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
                  id="registration_expiry"
                  label="New Expiry Date *"
                  value={formData.registration_expiry}
                  onChange={(val) => {
                    setExpiryTouched(true);
                    setFormData({ ...formData, registration_expiry: val });
                  }}
                />
                {fieldError("registration_expiry").error && (
                  <p className="text-xs text-danger">{fieldError("registration_expiry").error}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="or_cr_number" className="text-xs font-semibold text-foreground">
                  OR/CR Document Number <span className="text-foreground-muted font-normal text-[11px]">(Optional)</span>
                </Label>
                <Input
                  id="or_cr_number"
                  value={formData.document_number}
                  onChange={(e) => setFormData({ ...formData, document_number: e.target.value })}
                  placeholder="e.g. 1234-5678901"
                  className="text-xs font-mono h-9"
                />
              </div>

              <div className="space-y-1.5 pt-1">
                <Label htmlFor="or_cr_scan" className="text-xs font-semibold text-foreground">
                  Attach New Scanned OR/CR
                </Label>
                <label
                  htmlFor="or_cr_scan"
                  className="flex items-center justify-center gap-2 h-20 rounded-2xl border-2 border-dashed border-border/80 bg-muted/20 hover:bg-muted/40 hover:border-primary/50 transition-all cursor-pointer text-xs text-foreground-secondary"
                >
                  {scanning ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      <span className="font-bold text-foreground">Scanning OR/CR…</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 text-primary" />
                      {scanName ? (
                        <span className="truncate max-w-[220px] font-bold text-foreground">{scanName}</span>
                      ) : orCrDoc?.file_url ? (
                        <span className="font-medium">Replace existing scan (optional)</span>
                      ) : (
                        <span className="font-medium">Upload PDF or Image (max 10MB)</span>
                      )}
                    </>
                  )}
                </label>
                <input id="or_cr_scan" type="file" accept="image/*,.pdf" className="hidden" onChange={handleScanUpload} />
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
