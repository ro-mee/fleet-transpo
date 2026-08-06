export function Skeleton({ className, ...props }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-muted motion-reduce:animate-none ${className || ""}`}
      {...props}
    />
  );
}

// Chrome below mirrors the real components these stand in for, so swapping
// skeleton -> content doesn't shift layout:
//   CardSkeleton / StatsGridSkeleton -> StatCard  ("rounded-lg border border-border bg-surface shadow-xs p-4")
//   TableSkeleton                    -> the <table> inside data-table's own bordered wrapper

export function CardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface shadow-xs p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <Skeleton className="h-3.5 w-24 rounded" />
      </div>
      <Skeleton className="h-7 w-20" />
      <Skeleton className="h-3 w-32 rounded" />
    </div>
  );
}

// Renders inside data-table's existing bordered wrapper — no border of its own,
// or the two nest and you get a double outline.
export function TableSkeleton({ rows = 5, cols = 5 }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-4">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1 rounded" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-5 flex-1 rounded" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Detail page skeleton — mirrors the Top Banner + KPI + 2-col card layout. */
export function DetailSkeleton() {
  return (
    <div className="space-y-6 w-full pb-6 animate-pulse">
      {/* ── Top Banner ── */}
      <div className="bg-surface border border-border p-6 rounded-2xl shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
            <div className="flex items-center gap-4">
              <Skeleton className="h-16 w-16 rounded-full" />
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-7 w-48 rounded-lg" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
                <Skeleton className="h-4 w-64 rounded" />
              </div>
            </div>
          </div>
          <div className="flex gap-2.5">
            <Skeleton className="h-9 w-28 rounded-xl" />
            <Skeleton className="h-9 w-32 rounded-xl" />
          </div>
        </div>
        {/* KPI Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-border/60">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-3.5 rounded-xl bg-muted/20 border border-border/50 space-y-2">
              <Skeleton className="h-3 w-24 rounded" />
              <Skeleton className="h-4 w-20 rounded" />
            </div>
          ))}
        </div>
      </div>

      {/* ── Tabs bar ── */}
      <Skeleton className="h-12 w-full rounded-2xl" />

      {/* ── Two-column content ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left col */}
        <div className="lg:col-span-7 space-y-6">
          <div className="rounded-2xl border border-border bg-surface shadow-sm p-6 space-y-4">
            <div className="flex items-center gap-3 pb-3 border-b border-border/60">
              <Skeleton className="h-8 w-8 rounded-xl" />
              <Skeleton className="h-5 w-40 rounded" />
            </div>
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex justify-between items-center py-1.5 border-b border-border/30 last:border-0">
                <Skeleton className="h-3.5 w-28 rounded" />
                <Skeleton className="h-3.5 w-36 rounded" />
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-border bg-surface shadow-sm p-6 space-y-4">
            <div className="flex items-center gap-3 pb-3 border-b border-border/60">
              <Skeleton className="h-8 w-8 rounded-xl" />
              <Skeleton className="h-5 w-44 rounded" />
            </div>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex justify-between items-center py-1.5 border-b border-border/30 last:border-0">
                <Skeleton className="h-3.5 w-24 rounded" />
                <Skeleton className="h-3.5 w-32 rounded" />
              </div>
            ))}
          </div>
        </div>
        {/* Right col */}
        <div className="lg:col-span-5 space-y-6">
          <div className="rounded-2xl border border-border bg-surface shadow-sm p-5 space-y-4">
            <Skeleton className="h-5 w-40 rounded" />
            <div className="space-y-2.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex justify-between">
                  <Skeleton className="h-3.5 w-24 rounded" />
                  <Skeleton className="h-3.5 w-28 rounded" />
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-surface shadow-sm p-5 space-y-4">
            <Skeleton className="h-5 w-48 rounded" />
            <Skeleton className="h-24 w-full rounded-xl" />
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-muted/30 space-y-2">
                <Skeleton className="h-6 w-16 rounded" />
                <Skeleton className="h-3 w-20 rounded" />
              </div>
              <div className="p-3 rounded-xl bg-muted/30 space-y-2">
                <Skeleton className="h-6 w-16 rounded" />
                <Skeleton className="h-3 w-20 rounded" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Form page skeleton — mirrors the Top Banner + two-column form card layout. */
export function FormSkeleton() {
  return (
    <div className="space-y-6 w-full pb-6 animate-pulse">
      {/* ── Top Action Banner ── */}
      <div className="bg-surface border border-border p-5 rounded-2xl shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <Skeleton className="h-10 w-10 rounded-xl" />
            <div className="space-y-1.5">
              <Skeleton className="h-6 w-48 rounded-lg" />
              <Skeleton className="h-4 w-64 rounded" />
            </div>
          </div>
          <div className="flex gap-2.5">
            <Skeleton className="h-9 w-24 rounded-xl" />
            <Skeleton className="h-9 w-32 rounded-xl" />
          </div>
        </div>
      </div>

      {/* ── Two-column form layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left form cards */}
        <div className="lg:col-span-7 space-y-6">
          {Array.from({ length: 2 }).map((_, ci) => (
            <div key={ci} className="rounded-2xl border border-border bg-surface shadow-sm p-6 space-y-5">
              <div className="flex items-center gap-3 pb-3 border-b border-border/60">
                <Skeleton className="h-8 w-8 rounded-xl" />
                <Skeleton className="h-5 w-40 rounded" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {Array.from({ length: 6 }).map((_, fi) => (
                  <div key={fi} className="space-y-1.5">
                    <Skeleton className="h-3.5 w-24 rounded" />
                    <Skeleton className="h-10 w-full rounded-xl" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Right upload/scan cards */}
        <div className="lg:col-span-5 space-y-6">
          {Array.from({ length: 2 }).map((_, ci) => (
            <div key={ci} className="rounded-2xl border border-border bg-surface shadow-sm p-6 space-y-4">
              <div className="flex items-center gap-3 pb-3 border-b border-border/60">
                <Skeleton className="h-8 w-8 rounded-xl" />
                <Skeleton className="h-5 w-36 rounded" />
              </div>
              <Skeleton className="h-36 w-full rounded-xl" />
              <Skeleton className="h-9 w-full rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


// Mirrors StatGrid's responsive columns, so a skeleton can't reflow the moment
// data lands. `count` picks a matching column map; pass `gridClass` to override
// when the real layout isn't one of these (e.g. the 8-up dashboard grid).
const gridCols = {
  2: "md:grid-cols-2",
  3: "md:grid-cols-2 lg:grid-cols-3",
  4: "md:grid-cols-2 lg:grid-cols-4",
  5: "md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
  6: "md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6",
};

export function StatsGridSkeleton({ count = 4, gridClass, ...props }) {
  const grid = gridClass || gridCols[count] || gridCols[4];
  return (
    <div className={`grid grid-cols-2 gap-3 ${grid}`} {...props}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-surface shadow-xs p-4">
          <div className="flex items-center gap-2 mb-2">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-3.5 w-20 rounded" />
          </div>
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-3 w-24 rounded mt-1.5" />
        </div>
      ))}
    </div>
  );
}
