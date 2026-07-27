export default function Loading() {
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-48 animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-64 animate-pulse rounded-lg bg-muted" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="border-0 shadow-sm rounded-xl p-4 space-y-3">
            <div className="h-8 w-8 animate-pulse rounded-xl bg-muted" />
            <div className="h-6 w-16 animate-pulse rounded-lg bg-muted" />
            <div className="h-3 w-24 animate-pulse rounded-lg bg-muted" />
          </div>
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}
