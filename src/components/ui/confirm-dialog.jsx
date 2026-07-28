import { useCallback, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Trash2, Archive, LogOut, Info } from "lucide-react";

const variantConfig = {
  destructive: {
    icon: Trash2,
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

export function ConfirmDialog({
  open,
  onOpenChange,
  title = "Confirm",
  message = "Are you sure?",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "destructive",
  onConfirm,
}) {
  const config = variantConfig[variant] || variantConfig.destructive;
  const Icon = config.icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className={`w-10 h-10 rounded-xl ${config.iconBg} flex items-center justify-center mb-3`}>
            <Icon className={`w-5 h-5 ${config.iconColor}`} />
          </div>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button variant={config.confirmVariant} onClick={() => { onConfirm?.(); onOpenChange(false); }}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
          message: config.message || "Are you sure?",
          confirmLabel: config.confirmLabel || "Confirm",
          cancelLabel: config.cancelLabel || "Cancel",
          variant: config.variant || "destructive",
        },
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    state.resolve(true);
    setState((prev) => ({ ...prev, open: false }));
  }, [state.resolve]);

  const handleCancel = useCallback(() => {
    state.resolve(false);
    setState((prev) => ({ ...prev, open: false }));
  }, [state.resolve]);

  const ConfirmDialogComponent = state.open ? (
    <ConfirmDialog
      open={state.open}
      onOpenChange={(open) => {
        if (!open) {
          state.resolve(false);
          setState((prev) => ({ ...prev, open: false }));
        }
      }}
      title={state.config.title}
      message={state.config.message}
      confirmLabel={state.config.confirmLabel}
      cancelLabel={state.config.cancelLabel}
      variant={state.config.variant}
      onConfirm={handleConfirm}
    />
  ) : null;

  return [confirm, ConfirmDialogComponent];
}
