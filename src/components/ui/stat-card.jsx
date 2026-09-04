import Link from "next/link";
import { cn } from "@/lib/utils";

// Chip + valueNote text render small — status tones use the AA-safe -700
// inks instead of the base colors (~2.2-2.5:1 on white tints).
const tones = {
  primary: { chip: "bg-primary/10 text-primary border border-primary/20", active: "border-primary bg-primary/10", trend: "bg-primary/10 text-primary" },
  success: { chip: "bg-success/10 text-success-700 border border-success/20", active: "border-success bg-success/10", trend: "bg-success/10 text-success-700" },
  warning: { chip: "bg-warning/10 text-warning-700 border border-warning/20", active: "border-warning bg-warning/10", trend: "bg-warning/10 text-warning-700" },
  danger: { chip: "bg-danger/10 text-danger-700 border border-danger/20", active: "border-danger bg-danger/10", trend: "bg-danger/10 text-danger-700" },
  info: { chip: "bg-info/10 text-info-700 border border-info/20", active: "border-info bg-info/10", trend: "bg-info/10 text-info-700" },
  neutral: { chip: "bg-hover text-foreground-secondary border border-border/60", active: "border-primary bg-primary/10", trend: "bg-hover text-foreground-secondary" },
};

export function StatCard({
  icon: Icon,
  label,
  value,
  valueNote,
  trend,
  tone,
  color,
  active = false,
  interactive = false,
  href,
  className,
  onClick,
  ...props
}) {
  const t = tones[tone || color] || tones.primary;
  const isInteractive = interactive || Boolean(onClick) || Boolean(href);
  // A linked card is a real navigation target: same tactile physics as a
  // button card, with the anchor carrying focus + label semantics.
  const Component = href ? Link : onClick ? "button" : "div";
  return (
    <Component
      type={!href && onClick ? "button" : undefined}
      href={href}
      aria-pressed={!href && onClick ? active : undefined}
      aria-label={href ? `${label}: ${value}. Open ${label}.` : undefined}
      className={cn(
        "kpi-stat-card w-full rounded-3xl border border-border/80 bg-surface p-4 shadow-xs flex flex-col justify-between space-y-3 text-left select-none",
        isInteractive && "kpi-stat-card--interactive cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        active && cn(t.active, "shadow-xs"),
        className
      )}
      onClick={onClick}
      {...props}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground-secondary" title={label}>{label}</span>
        {Icon && (
          <span className={cn("flex h-9 w-9 items-center justify-center rounded-2xl shrink-0 transition-colors", t.chip)}>
            <Icon className="w-4 h-4" />
          </span>
        )}
      </div>
      <div>
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 text-3xl font-semibold leading-none tracking-tight text-foreground">
            {value}
          </p>
          {valueNote && <span className={cn("shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold leading-none", t.trend)}>{valueNote}</span>}
        </div>
        {/* Context caption — the "why does this matter" layer written by each
            dashboard config. Rendered as plain supporting text under the value. */}
        {trend && (
          <p className="mt-1.5 text-[11px] leading-snug text-foreground-muted">{trend}</p>
        )}
      </div>
    </Component>
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
