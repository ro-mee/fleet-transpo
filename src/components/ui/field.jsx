import { AlertCircle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Double-bezel shell shared by every floating form control.
 *
 * Outer tray: a thin gradient recessed against the page, defined by `ring-1` +
 * a top-light gradient. Inner core: the `bg-surface` field with a hairline
 * inset highlight. The floating pill label bridges the seam. Elevation comes
 * from the ring + inset highlight; the focus state promotes the ring to the
 * primary hue and adds a soft glow.
 */
function FloatingShell({ icon: Icon, label, required, error, hint, children, className }) {
  return (
    <div className={cn("relative pt-2", className)}>
      <div
        className={cn(
          "group relative flex items-center rounded-xl border border-border bg-surface px-4 py-2.5 min-h-[44px] select-none",
          "transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
          error
            ? "border-danger/60 shadow-[0_0_0_1px_rgba(239,68,68,0.1)]"
            : "hover:border-primary/50 hover:-translate-y-[1.5px] hover:shadow-xs focus-within:border-primary focus-within:-translate-y-[1.5px] focus-within:shadow-[0_4px_12px_-2px_rgba(17,24,39,0.08)] focus-within:ring-4 focus-within:ring-primary/5"
        )}
      >
        <label
          className={cn(
            "-top-2.5 left-4 absolute bg-surface border border-border/80 px-2.5 py-0.5 rounded-full text-[11px] font-bold text-foreground-secondary flex items-center gap-1.5 pointer-events-none z-10",
            "transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
            error
              ? "text-danger border-danger/40"
              : "group-hover:-translate-y-0.5 group-hover:scale-[1.03] group-hover:border-primary/45 group-hover:text-primary group-focus-within:-translate-y-0.5 group-focus-within:scale-[1.03] group-focus-within:border-primary group-focus-within:text-primary"
          )}
        >
          {Icon && (
            <Icon
              className={cn(
                "w-3.5 h-3.5 text-foreground-muted shrink-0 transition-colors duration-300",
                !error && "group-hover:text-primary group-focus-within:text-primary"
              )}
            />
          )}
          <span>{label}</span>
          {required && <span className="text-danger ml-0.5">*</span>}
        </label>
        {children}
      </div>
      {hint && <p className="text-xs text-foreground-muted mt-1 px-1">{hint}</p>}
      {error && (
        <p className="text-xs text-danger font-medium mt-1 px-1 flex items-center gap-1">
          <AlertCircle className="w-3 h-3 shrink-0" /> {error}
        </p>
      )}
    </div>
  );
}

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

export function FloatingField({ icon, label, required, error, hint, children, className }) {
  return (
    <FloatingShell icon={icon} label={label} required={required} error={error} hint={hint} className={className}>
      <div className="w-full pt-1 text-sm font-semibold text-foreground">{children}</div>
    </FloatingShell>
  );
}

export function FloatingSelect({ icon, label, required, error, hint, className, children, ...props }) {
  return (
    <FloatingShell icon={icon} label={label} required={required} error={error} hint={hint} className={className}>
      <div className="w-full pt-1 text-sm font-semibold text-foreground relative">
        <select
          {...props}
          className="w-full appearance-none bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1 cursor-pointer pr-7"
        >
          {children}
        </select>
        <ChevronDown className="w-3.5 h-3.5 text-foreground-muted pointer-events-none absolute right-0 top-1/2 -translate-y-1/2" />
      </div>
    </FloatingShell>
  );
}