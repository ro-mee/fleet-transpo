import { cn } from "@/lib/utils";

// Restrained tone map — calm by default, color only where meaning needs it:
// relief earns a success tint, blocked earns a warning tint, danger is only
// ever explicit. The tile stays a quiet bordered surface in both themes.
const TONES = {
  neutral: "border-border/70 bg-hover text-foreground-secondary",
  success: "border-success/20 bg-success-bg/70 text-success-700",
  warning: "border-warning/25 bg-warning-bg/70 text-warning-700",
  danger: "border-danger/25 bg-danger-bg/70 text-danger-700",
  info: "border-info/20 bg-info-bg/70 text-info-700",
};

const VARIANT_TONE = {
  "first-run": "neutral",
  filtered: "neutral",
  relief: "success",
  waiting: "neutral",
  blocked: "warning",
};

const SIZES = {
  compact: {
    root: "px-6 py-8",
    tile: "h-10 w-10 rounded-xl",
    icon: "h-[18px] w-[18px]",
    title: "text-sm font-semibold tracking-tight",
    desc: "text-[13px] max-w-sm",
  },
  comfortable: {
    root: "px-6 py-10 sm:py-12",
    tile: "h-12 w-12 rounded-2xl",
    icon: "h-5 w-5",
    title: "text-[15px] font-semibold tracking-tight",
    desc: "text-[13px] max-w-md",
  },
  hero: {
    root: "px-6 py-14 sm:py-16",
    tile: "h-12 w-12 rounded-2xl",
    icon: "h-5 w-5",
    title: "text-base font-semibold tracking-tight",
    desc: "text-sm max-w-md",
  },
};

/**
 * Shared empty-state primitive.
 *
 * Hierarchy: eyebrow → icon tile → title → short explanation → optional actions.
 * Variants (`first-run` | `filtered` | `relief` | `waiting` | `blocked`) pick a
 * restrained tone; `tone` overrides when severity genuinely warrants it.
 * Sizes: `compact` (sub-panels), `comfortable` (dashboard feeds, table cells),
 * `hero` (true full-page moments only).
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  eyebrow,
  variant,
  tone,
  size = "comfortable",
  role = "status",
  className,
}) {
  const resolvedTone = tone || VARIANT_TONE[variant] || "neutral";
  const s = SIZES[size] || SIZES.comfortable;
  return (
    <div role={role} className={cn("flex flex-col items-center justify-center text-center", s.root, className)}>
      {Icon && (
        <div className={cn("flex items-center justify-center border shadow-xs mb-4", s.tile, TONES[resolvedTone] || TONES.neutral)}>
          <Icon className={s.icon} aria-hidden="true" />
        </div>
      )}
      {eyebrow && (
        <p className="text-[11px] font-semibold uppercase tracking-widest text-foreground-muted mb-1.5">{eyebrow}</p>
      )}
      <p className={cn("text-foreground text-balance", s.title)}>{title}</p>
      {description && (
        <p className={cn("text-foreground-secondary mt-1.5 leading-relaxed text-balance", s.desc)}>{description}</p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
