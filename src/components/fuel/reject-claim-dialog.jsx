"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

const QUICK_REASONS = [
  "Amount mismatch on receipt scan",
  "Unreadable or blurry receipt image",
  "Fuel type mismatch with vehicle",
  "Missing pump receipt details",
  "Duplicate claim submission",
];

export function RejectClaimDialog({
  open,
  onOpenChange,
  record,
  rejectionReason,
  setRejectionReason,
  onConfirm,
  isPending,
  fieldError,
  registerField,
}) {
  const handleQuickSelect = (reason) => {
    setRejectionReason(reason);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-danger/10 text-danger border border-danger/20">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-foreground">
                Reject Fuel Claim {record ? `#${record.fuel_record_id}` : ""}
              </DialogTitle>
              <p className="text-xs text-foreground-secondary mt-0.5">
                Provide a clear justification for why this receipt claim is being declined.
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 p-6 pt-2">
          {/* Quick presets */}
          <div className="space-y-2">
            <span className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wider block">
              Quick Reasons
            </span>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_REASONS.map((reason) => {
                const isSelected = rejectionReason === reason;
                return (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => handleQuickSelect(reason)}
                    className={`text-xs px-2.5 py-1 rounded-lg border transition-all duration-150 text-left font-medium ${
                      isSelected
                        ? "bg-danger/15 text-danger border-danger/30 shadow-xs"
                        : "bg-surface text-foreground-secondary border-border/80 hover:bg-hover hover:text-foreground"
                    }`}
                  >
                    {reason}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rejection_reason" className="text-xs font-semibold text-foreground">
              Rejection Note / Reason *
            </Label>
            <Input
              id="rejection_reason"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              ref={registerField ? registerField("rejection_reason") : undefined}
              invalid={fieldError?.("rejection_reason")?.invalid}
              placeholder="e.g. Receipt amount does not match total claimed"
              className="text-sm"
              maxLength={500}
            />
            {fieldError?.("rejection_reason")?.error && (
              <p className="text-xs text-danger">{fieldError("rejection_reason").error}</p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border/60">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
              className="text-xs h-9 px-4"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={onConfirm}
              disabled={isPending}
              className="text-xs h-9 px-4 font-semibold shadow-xs"
            >
              {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              Confirm Rejection
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
