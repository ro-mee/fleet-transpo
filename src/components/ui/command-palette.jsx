"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { globalSearch } from "@/services/search.service";
import { useRoleAccess } from "@/hooks/use-role-access";
import { cn } from "@/lib/utils";
import {
  Search,
  CornerDownLeft,
  CalendarClock,
  Truck,
  UserRound,
  CarFront,
  FileText,
} from "lucide-react";

// Static "jump to page" commands. Filtered at render time by the current user's
// role so an operator only ever sees pages they can actually open.
const PAGE_COMMANDS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/reservations", label: "Reservations" },
  { href: "/reservations/queue", label: "Request Queue" },
  { href: "/dispatch", label: "Dispatch Board" },
  { href: "/dispatch/calendar", label: "Dispatch Calendar" },
  { href: "/trips", label: "Trips" },
  { href: "/incidents", label: "Incidents" },
  { href: "/fuel", label: "Fuel Monitoring" },
  { href: "/fuel/analytics", label: "Fuel Analytics" },
  { href: "/maintenance", label: "Maintenance" },
  { href: "/maintenance/predictive", label: "Predictive Maintenance" },
  { href: "/tracking/live-map", label: "Live GPS Tracking" },
  { href: "/tracking/history", label: "Trip Timeline" },
  { href: "/uvvrp", label: "Number Coding (UVVRP)" },
  { href: "/routes", label: "Routes" },
  { href: "/reports", label: "Reports" },
  { href: "/analytics", label: "Analytics" },
  { href: "/ai/insights", label: "AI Insights" },
  { href: "/fleet/vehicles", label: "Vehicle Management" },
  { href: "/fleet/documents", label: "Document Expiration" },
  { href: "/drivers", label: "Drivers" },
  { href: "/drivers/performance", label: "Driver Performance" },
  { href: "/settings/general", label: "System Settings" },
];

const TYPE_META = {
  reservation: { label: "Reservations", icon: CalendarClock, subtitleKey: "subtitle" },
  dispatch: { label: "Dispatches", icon: Truck, subtitleKey: "status" },
  driver: { label: "Drivers", icon: UserRound, subtitleKey: "subtitle" },
  vehicle: { label: "Vehicles", icon: CarFront, subtitleKey: "subtitle" },
};

export function CommandPalette() {
  const router = useRouter();
  const { canAccess } = useRoleAccess();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const pageCommands = useMemo(
    () => PAGE_COMMANDS.filter((c) => canAccess(c.href)),
    [canAccess]
  );

  const { data: results = [] } = useQuery({
    queryKey: ["global-search", query],
    queryFn: () => globalSearch(query),
    enabled: open && query.trim().length >= 2,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  // Group server results by type, preserving a stable order.
  const searchSections = useMemo(() => {
    const byType = {};
    for (const r of results) {
      (byType[r.type] ||= []).push(r);
    }
    return Object.keys(TYPE_META)
      .filter((t) => byType[t]?.length)
      .map((t) => ({ type: t, items: byType[t] }));
  }, [results]);

  const hasQuery = query.trim().length >= 2;
  const sections = useMemo(() => {
    const s = [];
    if (!hasQuery) {
      s.push({ label: "Pages", items: pageCommands.map((c) => ({ ...c, type: "page" })) });
    } else {
      for (const sec of searchSections) {
        s.push({
          label: TYPE_META[sec.type].label,
          items: sec.items.map((r) => ({ ...r, type: r.type })),
        });
      }
      if (s.length === 0) s.push({ label: "No results", items: [] });
    }
    return s;
  }, [hasQuery, pageCommands, searchSections]);

  // Flat item index for arrow-key navigation.
  const { flat, count } = useMemo(() => {
    const flat = [];
    for (const sec of sections) for (const it of sec.items) flat.push(it);
    return { flat, count: flat.length };
  }, [sections]);

  // Reset scroll position whenever the result set changes.
  useEffect(() => {
    setActive(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => (count ? (a + 1) % count : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (count ? (a - 1 + count) % count : 0));
      } else if (e.key === "Enter" && flat[active]) {
        e.preventDefault();
        navigate(flat[active].href);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, count, flat, active]);

  // Global Ctrl/Cmd+K toggle.
  useEffect(() => {
    const onToggle = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onToggle);
    return () => window.removeEventListener("keydown", onToggle);
  }, []);

  const navigate = (href) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg p-0 overflow-hidden rounded-2xl">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-foreground-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search reservations, dispatches, drivers, vehicles…"
            aria-label="Search"
            className="w-full bg-transparent text-sm text-foreground placeholder:text-foreground-muted outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center gap-1 rounded-md border border-border bg-hover px-1.5 py-0.5 text-[11px] font-medium text-foreground-muted">
            <CornerDownLeft className="h-3 w-3" /> Enter
          </kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {sections.map((sec) => (
            <div key={sec.label} className="mb-1">
              <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">
                {sec.label}
              </div>
              {sec.items.length === 0 && (
                <div className="px-2 py-6 text-center text-sm text-foreground-muted">
                  Nothing matched “{query}”
                </div>
              )}
              {sec.items.map((it) => {
                const idx = flat.indexOf(it);
                const Icon = it.type === "page" ? FileText : TYPE_META[it.type].icon;
                return (
                  <button
                    key={`${it.type}-${it.href}`}
                    type="button"
                    onClick={() => navigate(it.href)}
                    onMouseMove={() => setActive(idx)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left",
                      idx === active ? "bg-hover" : "hover:bg-hover"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-foreground-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {it.label}
                      </span>
                      {it.subtitle || it.status ? (
                        <span className="block truncate text-xs text-foreground-muted">
                          {it.subtitle || it.status}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
