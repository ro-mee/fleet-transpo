import { cn } from "@/lib/utils";

const tones = {
  primary: { chip: "bg-primary/10 text-primary border border-primary/20", value: "text-foreground" },
  success: { chip: "bg-success/10 text-success border border-success/20", value: "text-success" },
  warning: { chip: "bg-warning/10 text-warning border border-warning/20", value: "text-warning" },
  danger: { chip: "bg-danger/10 text-danger border border-danger/20", value: "text-danger" },
  info: { chip: "bg-info/10 text-info border border-info/20", value: "text-info" },
  neutral: { chip: "bg-hover text-foreground-secondary border border-border/60", value: "text-foreground" },
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
        "rounded-3xl border border-border/80 bg-surface shadow-xs p-5 flex flex-col justify-between space-y-3 transition-all select-none",
        onClick && "cursor-pointer hover:border-primary/40 hover:shadow-sm",
        active && "border-primary bg-primary/10 shadow-xs",
        className
      )}
      onClick={onClick}
      {...props}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider truncate">{label}</span>
        {Icon && (
          <span className={cn("flex h-9 w-9 items-center justify-center rounded-2xl shrink-0 transition-colors", t.chip)}>
            <Icon className="w-4 h-4" />
          </span>
        )}
      </div>
      <div>
        <p className={cn("text-3xl font-black font-data leading-none tracking-tight", t.value)}>
          {value}
        </p>
        {trend && <p className="text-[11px] font-semibold text-foreground-muted mt-1.5 truncate">{trend}</p>}
      </div>
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
    <div className={cn("grid grid-cols-1 sm:grid-cols-2 gap-4", gridCols[cols] || gridCols[4], className)}>
      {children}
    </div>
  );
}
