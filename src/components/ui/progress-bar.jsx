import { cn } from "@/lib/utils";

const barTones = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

export function ProgressBar({
  value,
  tone = "primary",
  label,
  valueLabel,
  className,
}) {
  const clamped = Math.max(0, Math.min(100, value || 0));
  return (
    <div className={cn("w-full", className)}>
      {(label || valueLabel) && (
        <div className="mb-1.5 flex items-center justify-between text-xs">
          {label && <span className="text-foreground-secondary">{label}</span>}
          {valueLabel && <span className="font-data text-foreground">{valueLabel}</span>}
        </div>
      )}
      <div className="h-1.5 overflow-hidden rounded-full bg-hover">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            barTones[tone] || barTones.primary
          )}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
