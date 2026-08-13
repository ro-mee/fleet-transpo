"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

// The status board is the dashboards' read-only readiness view: one column per
// status value, a live count in the column header, and a card per resource.
// It exists so /fleet/availability and /drivers/availability share one layout —
// the status vocabulary *is* the structure, so changing a status list never
// requires rewriting the board.

const TONE = {
  success: {
    rail: "border-l-emerald-500/70",
    chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    ring: "hover:ring-emerald-500/30",
    dot: "bg-emerald-500",
  },
  warning: {
    rail: "border-l-amber-500/70",
    chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    ring: "hover:ring-amber-500/30",
    dot: "bg-amber-500",
  },
  danger: {
    rail: "border-l-red-500/70",
    chip: "bg-red-500/10 text-red-600 dark:text-red-400",
    ring: "hover:ring-red-500/30",
    dot: "bg-red-500",
  },
  info: {
    rail: "border-l-blue-500/70",
    chip: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    ring: "hover:ring-blue-500/30",
    dot: "bg-blue-500",
  },
  primary: {
    rail: "border-l-slate-500/70",
    chip: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
    ring: "hover:ring-slate-500/30",
    dot: "bg-slate-500",
  },
  secondary: {
    rail: "border-l-zinc-500/70",
    chip: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
    ring: "hover:ring-zinc-500/30",
    dot: "bg-zinc-500",
  },
};

export function StatusBoard({
  columns,
  items,
  getStatus,
  renderCard,
  gridClass = "lg:grid-cols-2 2xl:grid-cols-3",
  loading = false,
  empty = { title: "Nothing here yet", description: "" },
  emptyIcon: EmptyIcon,
}) {
  if (loading) {
    return (
      <div className={cn("grid grid-cols-1 gap-4 md:grid-cols-2", gridClass)}>
        {columns.map((c) => (
          <div key={c.status} className="rounded-2xl border border-border bg-surface p-4 space-y-3">
            <div className="flex items-center gap-2.5 pb-2 border-b border-border/50">
              <Skeleton className="h-5 w-24 rounded" />
              <Skeleton className="h-5 w-8 rounded-full" />
            </div>
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        ))}
      </div>
    );
  }

  const groups = new Map(columns.map((c) => [c.status, []]));
  const unknown = [];
  for (const it of items || []) {
    const status = getStatus(it);
    if (groups.has(status)) groups.get(status).push(it);
    else unknown.push(it);
  }

  let visible = columns;
  if (unknown.length > 0) {
    visible = [
      ...columns,
      { status: "__other__", label: "Other", tone: "secondary", icon: undefined, empty: "Unlisted status" },
    ];
    groups.set("__other__", unknown);
  }

  return (
    <div className={cn("grid grid-cols-1 gap-4 md:grid-cols-2", gridClass)}>
      {visible.map((c) => {
        const tone = TONE[c.tone] || TONE.secondary;
        const inColumn = groups.get(c.status) || [];
        return (
          <section key={c.status} className={cn("rounded-2xl border border-border bg-surface p-3.5 border-l-[3px]", tone.rail)}>
            <header className="flex items-center justify-between gap-3 px-1 pb-3">
              <div className="flex items-center gap-2 min-w-0">
                {c.icon && <c.icon className="h-4 w-4 shrink-0 text-foreground-muted" />}
                <h3 className="text-sm font-bold text-foreground truncate">{c.label}</h3>
              </div>
              <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold font-data", tone.chip)}>
                <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />
                {inColumn.length}
              </span>
            </header>

            <div className="space-y-2">
              {inColumn.map((it) => renderCard(it, c))}
              {inColumn.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border/70 px-3 py-6 text-center">
                  <span className="text-xs font-medium text-foreground-muted">{c.empty || empty.title}</span>
                  {c.emptyHint && <span className="text-[11px] text-foreground-muted/70">{c.emptyHint}</span>}
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// Card chrome used by both boards so the two pages stay visually identical:
// a link ingredient, the row's key identifier, and a quiet one-line summary.
export function BoardCardBase({ href, onClick, leading, children, className }) {
  const body = (
    <div className={cn("flex items-start gap-3 group/card", className)}>
      {leading}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
  if (href) {
    return (
      <Link
        href={href}
        onClick={onClick}
        className="block rounded-xl border border-border/70 bg-surface px-3 py-2.5 shadow-2xs ring-1 ring-transparent transition-all hover:shadow-sm hover:border-border"
      >
        {body}
      </Link>
    );
  }
  return <div className="rounded-xl border border-border/70 bg-surface px-3 py-2.5 shadow-2xs">{body}</div>;
}

export function BoardCardTitle({ children, className }) {
  return <p className={cn("truncate text-sm font-bold text-foreground", className)}>{children}</p>;
}

export function BoardCardMeta({ children, className }) {
  return <p className={cn("mt-1 text-xs text-foreground-secondary font-medium", className)}>{children}</p>;
}

export function BoardCardKicker({ children, className }) {
  return <p className={cn("mb-1 text-[11px] font-bold uppercase tracking-wider text-foreground-muted", className)}>{children}</p>;
}

export function BoardEmptyIcon({ icon: Icon }) {
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-hover">
      <Icon className="h-4 w-4 text-foreground-muted" />
    </div>
  );
}