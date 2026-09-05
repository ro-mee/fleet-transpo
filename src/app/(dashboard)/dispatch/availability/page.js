"use client";

// Resource Availability — the pair-first dispatch-truth board. Answers "what
// can I dispatch in this window?" Individual vehicle/driver lookups live on
// their own Fleet/Driver pages, not here.

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useRequireRole } from "@/lib/auth/role-guard";
import { HeroHeader } from "@/components/ui/hero-header";
import { PairAvailabilityBoard } from "@/components/dispatch/pair-availability-board";
import { Users } from "lucide-react";

function parseDateParam(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Default window is the full day: start of today → end of today. The exact
// pickup/return picker is optional refinement, not a requirement.
function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 0, 0);
  return d;
}

export default function ResourceAvailabilityPage() {
  useRequireRole();
  const searchParams = useSearchParams();

  const initial = useMemo(() => {
    const pickup = parseDateParam(searchParams.get("pickup_at"));
    const ret = parseDateParam(searchParams.get("return_at"));
    const now = new Date();
    return {
      pickupAt: pickup || startOfDay(now),
      returnAt: ret || endOfDay(pickup || now),
      isCustomWindow: Boolean(pickup || ret),
      minCapacity:
        searchParams.get("requested_capacity") ||
        searchParams.get("min_capacity") ||
        searchParams.get("passengers") ||
        "",
      categoryId: searchParams.get("category_id") || "",
      request: {
        request_number:
          searchParams.get("request_number") || searchParams.get("request_id") || "",
        passengers: searchParams.get("passengers") || "",
        category:
          searchParams.get("category") || searchParams.get("category_name") || "",
        requested_capacity: searchParams.get("requested_capacity") || "",
      },
    };
  }, [searchParams]);

  const [pickupAt, setPickupAt] = useState(initial.pickupAt);
  const [returnAt, setReturnAt] = useState(initial.returnAt);
  const [isCustomWindow, setIsCustomWindow] = useState(initial.isCustomWindow);

  const hasRequestContext = Boolean(
    initial.request.request_number ||
      initial.request.passengers ||
      initial.request.category ||
      initial.request.requested_capacity
  );

  const resetWindow = () => {
    const now = new Date();
    setPickupAt(startOfDay(now));
    setReturnAt(endOfDay(now));
    setIsCustomWindow(false);
  };

  const fmtHead = (value, withTime) => {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
    }).format(d);
  };

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={Users}
        title="Resource Availability"
        badge={isCustomWindow ? `${fmtHead(pickupAt, true)}–${fmtHead(returnAt, true)}` : "Today Overview"}
        description={
          isCustomWindow
            ? "Checking whether each vehicle-driver pair can serve this window."
            : "Pair schedule activity and hard availability restrictions. Select an exact window to check dispatch readiness."
        }
      />

      <PairAvailabilityBoard
        pickupAt={pickupAt}
        returnAt={returnAt}
        minCapacity={initial.minCapacity}
        categoryId={initial.categoryId}
        isCustomWindow={isCustomWindow}
        requestContext={hasRequestContext ? initial.request : null}
        onWindowChange={({ pickupAt: p, returnAt: r }) => {
          if (p) setPickupAt(p);
          if (r) setReturnAt(r);
          setIsCustomWindow(true);
        }}
        onResetWindow={resetWindow}
      />
    </div>
  );
}
