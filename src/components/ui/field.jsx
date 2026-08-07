import { cn } from "@/lib/utils";

export function Field({ label, required, error, hint, children, className }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <label className="text-sm font-medium text-foreground">
          {label}
          {required && <span className="text-danger ml-0.5">*</span>}
        </label>
      )}
      {children}
      {hint && <p className="text-xs text-foreground-muted">{hint}</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

export function FloatingField({ label, icon: Icon, required, error, hint, children, className }) {
  return (
    <div className={cn("relative pt-2", className)}>
      <div className="relative flex items-center border border-border/80 hover:border-primary/50 focus-within:border-primary bg-surface rounded-2xl px-4 py-2 transition-all select-none min-h-[46px]">
        {/* Floating Top Pill Label */}
        <label className="-top-2.5 left-3.5 absolute bg-surface border border-primary/30 px-2.5 py-0.5 rounded-full text-[11px] font-bold text-primary flex items-center gap-1.5 pointer-events-none z-10">
          {Icon && <Icon className="w-3.5 h-3.5 text-primary shrink-0" />}
          <span>{label}</span>
          {required && <span className="text-danger ml-0.5">*</span>}
        </label>

        {/* Form Control Child */}
        <div className="w-full pt-1 text-sm font-semibold text-foreground">
          {children}
        </div>
      </div>
      {hint && <p className="text-xs text-foreground-muted mt-1 px-1">{hint}</p>}
      {error && <p className="text-xs text-danger font-medium mt-1 px-1">{error}</p>}
    </div>
  );
}
