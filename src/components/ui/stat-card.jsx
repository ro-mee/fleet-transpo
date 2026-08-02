import { cn } from "@/lib/utils";

const tones = {
  primary: { chip: "bg-primary/10 text-primary", value: "text-foreground" },
  success: { chip: "bg-success/10 text-success", value: "text-success" },
  warning: { chip: "bg-warning/10 text-warning", value: "text-warning" },
  danger: { chip: "bg-danger/10 text-danger", value: "text-danger" },
  info: { chip: "bg-info/10 text-info", value: "text-info" },
  neutral: { chip: "bg-hover text-foreground-secondary", value: "text-foreground" },
};

export function StatCard({
  icon: Icon,
  label,
  value,
  trend,
  tone = "primary",
  active = false,
  className,
  onClick,
  ...props
}) {
  const t = tones[tone] || tones.neutral;
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface shadow-xs p-4",
        onClick && "cursor-pointer transition-all hover:shadow-md",
        active && "ring-2 ring-primary bg-primary/5",
        className
      )}
      onClick={onClick}
      {...props}
    >
      <div className="flex items-center gap-2 mb-2">
        {Icon && (
          <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", t.chip)}>
            <Icon className="w-4 h-4" />
          </span>
        )}
        <span className="text-xs font-medium text-foreground-secondary truncate">{label}</span>
      </div>
      <p className={cn("text-2xl font-semibold font-data leading-none tracking-tight", t.value)}>
        {value}
      </p>
      {trend && <p className="text-xs text-foreground-muted mt-1.5 truncate">{trend}</p>}
    </div>
  );
}

const gridCols = {
  2: "md:grid-cols-2",
  3: "md:grid-cols-2 lg:grid-cols-3",
  4: "md:grid-cols-2 lg:grid-cols-4",
  5: "md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
  6: "md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6",
};

export function StatGrid({ cols = 4, className, children }) {
  return (
    <div className={cn("grid grid-cols-2 gap-3", gridCols[cols] || gridCols[4], className)}>
      {children}
    </div>
  );
}
