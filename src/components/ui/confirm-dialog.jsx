import { useCallback, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Trash2, Archive, LogOut, Info, Loader2 } from "lucide-react";

const variantConfig = {
  destructive: {
    icon: Trash2,
    iconColor: "text-danger",
    iconBg: "bg-danger/10",
    confirmVariant: "destructive",
  },
  // Alias so call sites can say what they mean.
  danger: {
    icon: AlertTriangle,
    iconColor: "text-danger",
    iconBg: "bg-danger/10",
    confirmVariant: "destructive",
  },
  warning: {
    icon: AlertTriangle,
    iconColor: "text-warning",
    iconBg: "bg-warning/10",
    confirmVariant: "warning",
  },
  archive: {
    icon: Archive,
    iconColor: "text-warning",
    iconBg: "bg-warning/10",
    confirmVariant: "warning",
  },
  logout: {
    icon: LogOut,
    iconColor: "text-foreground-secondary",
    iconBg: "bg-hover",
    confirmVariant: "default",
  },
  info: {
    icon: Info,
    iconColor: "text-info",
    iconBg: "bg-info/10",
    confirmVariant: "default",
  },
};

/**
 * Confirmation ladder in one component:
 *   - plain confirm        -> title + message + Confirm
 *   - requireReason        -> adds a mandatory reason textarea (audit trails)
 *   - loading              -> disables both buttons, spins the confirm label
 * Aliases accepted for legacy call sites: `description` -> message,
 * `confirmText` -> confirmLabel, `isLoading` -> loading, `variant="danger"`.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title = "Confirm",
  message,
  description,
  confirmLabel,
  confirmText,
  cancelLabel = "Cancel",
  variant = "destructive",
  requireReason = false,
  reasonLabel = "Reason",
  reasonPlaceholder = "Explain why (required)",
  loading = false,
  isLoading = false,
  onConfirm,
}) {
  const config = variantConfig[variant] || variantConfig.destructive;
  const Icon = config.icon;
  const busy = loading || isLoading;
  const bodyText = message ?? description ?? "Are you sure?";
  const actionLabel = confirmLabel ?? confirmText ?? "Confirm";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-[95vw] md:w-[440px] p-0 overflow-hidden rounded-3xl bg-surface border border-border/80 shadow-2xl">
        {/* Keyed by `open` so the reason textarea remounts fresh each time the
            dialog opens — no reset-in-effect. */}
        <DialogBody
          key={String(open)}
          config={config}
          Icon={Icon}
          title={title}
          bodyText={bodyText}
          requireReason={requireReason}
          reasonLabel={reasonLabel}
          reasonPlaceholder={reasonPlaceholder}
          busy={busy}
          actionLabel={actionLabel}
          cancelLabel={cancelLabel}
          onOpenChange={onOpenChange}
          onConfirm={onConfirm}
        />
      </DialogContent>
    </Dialog>
  );
}

function DialogBody({
  config,
  Icon,
  title,
  bodyText,
  requireReason,
  reasonLabel,
  reasonPlaceholder,
  busy,
  actionLabel,
  cancelLabel,
  onOpenChange,
  onConfirm,
}) {
  const [reason, setReason] = useState("");
  const canConfirm = !busy && (!requireReason || reason.trim().length > 0);

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm?.(requireReason ? reason.trim() : undefined);
    // Parent owns closing when it needs to await its mutation; close eagerly
    // otherwise so the dialog never lingers behind a toast.
    if (!busy) onOpenChange(false);
  };

  return (
    <>
      <div className="p-6 pb-4">
        <div className="flex items-start gap-3.5">
          <div className={`w-11 h-11 rounded-2xl ${config.iconBg} border border-border/60 flex items-center justify-center shrink-0 shadow-2xs`}>
            <Icon className={`w-5 h-5 ${config.iconColor}`} />
          </div>
          <div className="min-w-0 pt-0.5">
            <h3 className="text-base font-bold text-foreground tracking-tight leading-snug">
              {title}
            </h3>
            <p className="text-xs text-foreground-secondary mt-1 leading-relaxed">
              {bodyText}
            </p>
          </div>
        </div>

        {requireReason && (
          <div className="mt-4 space-y-1.5 pt-3 border-t border-border/60">
            <label htmlFor="confirm-reason" className="text-xs font-semibold text-foreground flex items-center justify-between">
              <span>{reasonLabel} <span className="text-danger">*</span></span>
              <span className="text-[10px] font-mono text-foreground-muted">{reason.length}/500</span>
            </label>
            <textarea
              id="confirm-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={reasonPlaceholder}
              rows={3}
              maxLength={500}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-xs text-foreground placeholder:text-foreground-muted focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10 resize-none shadow-2xs"
            />
            {!reason.trim() && (
              <p className="text-[11px] text-foreground-muted">A short reason is recorded in the operational audit log.</p>
            )}
          </div>
        )}
      </div>

      <div className="px-6 py-3.5 border-t border-border/70 bg-surface/90 backdrop-blur-md flex items-center justify-end gap-2.5">
        <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy} className="text-xs h-9 px-4">
          {cancelLabel}
        </Button>
        <Button
          variant={config.confirmVariant}
          size="sm"
          onClick={handleConfirm}
          disabled={!canConfirm}
          className="text-xs h-9 px-4 font-semibold shadow-xs"
        >
          {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          {actionLabel}
        </Button>
      </div>
    </>
  );
}

export function useConfirm() {
  const [state, setState] = useState({
    open: false,
    resolve: null,
    config: {},
  });

  const confirm = useCallback((config = {}) => {
    return new Promise((resolve) => {
      setState({
        open: true,
        resolve,
        config: {
          title: config.title || "Confirm",
          message: config.message || config.description || "Are you sure?",
          confirmLabel: config.confirmLabel || config.confirmText || "Confirm",
          cancelLabel: config.cancelLabel || "Cancel",
          variant: config.variant === "danger" ? "destructive" : config.variant || "destructive",
          requireReason: config.requireReason || false,
          reasonLabel: config.reasonLabel || "Reason",
          reasonPlaceholder: config.reasonPlaceholder || "Explain why (required)",
        },
      });
    });
  }, []);

  const settle = useCallback(
    (value) => {
      state.resolve?.(value);
      setState((prev) => ({ ...prev, open: false }));
    },
    [state]
  );

  const ConfirmDialogComponent = (
    <ConfirmDialog
      open={state.open}
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
      title={state.config.title}
      message={state.config.message}
      confirmLabel={state.config.confirmLabel}
      cancelLabel={state.config.cancelLabel}
      variant={state.config.variant}
      requireReason={state.config.requireReason}
      reasonLabel={state.config.reasonLabel}
      reasonPlaceholder={state.config.reasonPlaceholder}
      onConfirm={(reason) =>
        settle(state.config.requireReason ? { confirmed: true, reason } : true)
      }
    />
  );

  return [confirm, ConfirmDialogComponent];
}
