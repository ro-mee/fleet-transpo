import { Skeleton } from "@/components/ui/skeleton";

// Route-group fallback, shown while ANY (dashboard) page streams in.
//
// Deliberately generic: this same file precedes every dashboard route, from
// /tracking/live-map to /settings/profile, so it must not sketch a KPI-grid or
// table that most pages never render — that would paint a layout, then reflow
// into something else. Pages with heavier data (queue, dispatch, detail views)
// own their own skeletons via their react-query loading state; this is just the
// header + a neutral block so navigation never flashes blank.
export default function DashboardLoading() {
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-56 rounded-lg" />
          <Skeleton className="h-4 w-80 rounded-lg" />
        </div>
        <Skeleton className="h-10 w-32 rounded-lg" />
      </div>
      <Skeleton className="h-[340px] w-full" />
    </div>
  );
}
