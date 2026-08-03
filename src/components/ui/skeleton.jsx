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

export function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-surface shadow-xs p-4 space-y-3">
            <Skeleton className="h-5 w-32" />
            {Array.from({ length: 4 }).map((_, j) => (
              <Skeleton key={j} className="h-4 w-full" />
            ))}
          </div>
        ))}
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
