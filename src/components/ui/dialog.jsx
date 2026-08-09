import * as DialogPrimitive from "@radix-ui/react-dialog";

export function Dialog({ children, ...props }) {
  return <DialogPrimitive.Root {...props}>{children}</DialogPrimitive.Root>;
}

export function DialogTrigger({ children, ...props }) {
  return <DialogPrimitive.Trigger asChild {...props}>{children}</DialogPrimitive.Trigger>;
}

export function DialogContent({ children, className = "", ...props }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dialog-overlay fixed inset-0 bg-black/60 backdrop-blur-md z-40 transition-all duration-200 animate-in fade-in" />
      <DialogPrimitive.Content
        className={`dialog-content fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-surface/95 backdrop-blur-xl rounded-3xl shadow-2xl border border-border/80 p-0 z-50 max-h-[85vh] overflow-y-auto min-w-[320px] transition-all duration-200 animate-in zoom-in-95 ${className}`}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ children, className = "" }) {
  return <div className={`p-6 pb-0 ${className}`}>{children}</div>;
}

export function DialogTitle({ children, className = "" }) {
  return <h2 className={`text-lg font-semibold text-foreground ${className}`}>{children}</h2>;
}

export function DialogDescription({ children, className = "" }) {
  return <p className={`text-sm text-foreground-secondary mt-1.5 ${className}`}>{children}</p>;
}

export function DialogFooter({ children, className = "" }) {
  return <div className={`flex items-center justify-end gap-3 p-6 pt-4 ${className}`}>{children}</div>;
}
