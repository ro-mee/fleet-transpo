"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { CardSkeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Shared query-state contract.
 *
 * Renders the four states every data surface owes the user:
 *   loading  -> skeleton (mirrors layout, never a bare spinner)
 *   error    -> explicit failure copy + Retry (never dressed up as "empty")
 *   empty    -> EmptyState with actionable guidance
 *   ready    -> children(data)
 *
 * Usage:
 *   <QueryBoundary query={myQuery} isEmpty={(d) => !d?.length}
 *     emptyTitle="..." emptyDescription="...">
 *     {(data) => <MyList data={data} />}
 *   </QueryBoundary>
 *
 * `query` is a TanStack useQuery result. Retry reuses the query's own refetch,
 * so no cache keys are duplicated here.
 */
export function QueryBoundary({
  query,
  children,
  isEmpty = (data) => !data || (Array.isArray(data) ? data.length === 0 : Object.keys(data).length === 0),
  skeleton,
  skeletonClassName,
  errorTitle = "Couldn't load this data",
  errorDescription = "Something went wrong on our side. Your data is safe — try again.",
  emptyTitle = "Nothing here yet",
  emptyDescription,
  emptyAction,
  className,
}) {
  const { data, isLoading, isError, refetch, isRefetching } = query || {};

  if (isLoading) {
    return (
      <div className={cn(className)} aria-busy="true" aria-live="polite">
        {skeleton ?? (
          <div className={cn("grid gap-4 md:grid-cols-2", skeletonClassName)}>
            <CardSkeleton />
            <CardSkeleton />
          </div>
        )}
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center text-center px-6 py-12 rounded-2xl border border-danger/20 bg-danger-bg/40",
          className
        )}
        role="alert"
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-danger/10 mb-4">
          <AlertTriangle className="w-5 h-5 text-danger" />
        </div>
        <p className="text-sm font-medium text-foreground">{errorTitle}</p>
        <p className="text-sm text-foreground-secondary mt-1 max-w-sm leading-relaxed">{errorDescription}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()} disabled={isRefetching}>
          <RefreshCw className={cn("mr-2 h-3.5 w-3.5", isRefetching && "animate-spin")} />
          Try again
        </Button>
      </div>
    );
  }

  if (isEmpty(data)) {
    return (
      <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} className={className} />
    );
  }

  return typeof children === "function" ? children(data) : children;
}

/**
 * Inline error banner for pages that keep their own layout but need the
 * standard failure treatment (e.g. above a table that stays mounted).
 */
export function QueryErrorBanner({ query, title, description, className }) {
  if (!query?.isError) return null;
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border border-danger/30 bg-danger-bg px-4 py-3",
        className
      )}
      role="alert"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
      <div className="flex-1">
        <p className="text-sm font-medium text-foreground">
          {title || "Couldn't refresh this data"}
        </p>
        {(description || "Showing possibly outdated information.") && (
          <p className="text-xs text-foreground-secondary mt-0.5">
            {description || "Showing possibly outdated information."}
          </p>
        )}
      </div>
      <Button variant="outline" size="sm" onClick={() => query.refetch()} disabled={query.isRefetching}>
        <RefreshCw className={cn("mr-2 h-3.5 w-3.5", query.isRefetching && "animate-spin")} />
        Retry
      </Button>
    </div>
  );
}
