"use client"; // Error boundaries must be Client Components.

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TriangleAlert } from "lucide-react";

// Phase 17 — the dashboard error boundary.
//
// It sits at the (dashboard) segment rather than on each page because error.js
// wraps its segment's children but NOT the layout.js beside it: the sidebar and
// nav survive, and only the page content is replaced. One file therefore gives
// every dashboard route a recoverable failure state while leaving the shell
// navigable — a per-page copy would add nothing.
//
// `unstable_retry` re-fetches and re-renders the boundary's children, which is
// what a transient DB or network fault needs. `reset` only clears the error state
// without re-fetching, so it would loop straight back into a failed query; it is
// kept as a fallback purely because the retry prop is still unstable-prefixed
// (added in Next 16.2; this project is on 16.2.11).
export default function DashboardError({ error, unstable_retry, reset }) {
  useEffect(() => {
    // No error reporting service is wired up, so the console is the sink. The
    // digest is what correlates a redacted client message to the server log.
    console.error("Dashboard route error:", error);
  }, [error]);

  const retry = unstable_retry || reset;

  return (
    <EmptyState
      icon={TriangleAlert}
      title="Something went wrong on this page"
      tone="danger"
      size="hero"
      description={
        // Server Component errors arrive redacted in production, so message is
        // not always something a user can act on — hence the generic fallback.
        error?.message ||
        "The page failed to render. Retrying often clears a transient fault."
      }
      action={
        <div className="flex flex-col items-center gap-3">
          <div className="flex flex-wrap items-center justify-center gap-2">
            {retry && <Button onClick={() => retry()}>Try again</Button>}
            <Button variant="outline" onClick={() => window.location.reload()}>
              Reload the page
            </Button>
          </div>
          {error?.digest && (
            <p className="font-data text-xs text-foreground-muted">
              Reference: {error.digest}
            </p>
          )}
        </div>
      }
    />
  );
}
