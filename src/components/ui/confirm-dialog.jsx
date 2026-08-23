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
      <DialogContent>
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
      <DialogHeader>
        <div className={`w-10 h-10 rounded-xl ${config.iconBg} flex items-center justify-center mb-3`}>
          <Icon className={`w-5 h-5 ${config.iconColor}`} />
        </div>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{bodyText}</DialogDescription>
      </DialogHeader>
      {requireReason && (
        <div className="space-y-1.5">
          <label htmlFor="confirm-reason" className="text-xs font-medium text-foreground-secondary">
            {reasonLabel} <span className="text-danger">*</span>
          </label>
          <textarea
            id="confirm-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={reasonPlaceholder}
            rows={3}
            maxLength={500}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10 resize-none"
          />
          {!reason.trim() && (
            <p className="text-[11px] text-foreground-muted">A short reason is recorded with this action.</p>
          )}
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button
          variant={config.confirmVariant}
          onClick={handleConfirm}
          disabled={!canConfirm}
        >
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {actionLabel}
        </Button>
      </DialogFooter>
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
