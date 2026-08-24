"use client";

import { useEffect, useMemo, useState, useDeferredValue } from "react";
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
  { href: "/trips/active", label: "Active Trips" },
  { href: "/incidents", label: "Incidents" },
  { href: "/fuel", label: "Fuel Monitoring" },
  { href: "/fuel/analytics", label: "Fuel Analytics" },
  { href: "/maintenance", label: "Maintenance" },
  { href: "/maintenance/predictive", label: "Predictive Maintenance" },
  { href: "/tracking/live-map", label: "Live GPS Tracking" },
  { href: "/uvvrp", label: "Number Coding (UVVRP)" },
  { href: "/routes", label: "Routes" },
  { href: "/reports", label: "Reports" },
  { href: "/reports/cost", label: "Fleet Cost Dashboard" },
  { href: "/analytics", label: "Analytics" },
  { href: "/executive", label: "Executive Overview" },
  { href: "/ai/insights", label: "AI Insights" },
  { href: "/ai/predictive-maintenance", label: "AI Predictive Maintenance" },
  { href: "/fleet/vehicles", label: "Vehicle Management" },
  { href: "/drivers", label: "Drivers" },
  { href: "/drivers/performance", label: "Driver Performance" },
  { href: "/notifications", label: "Notifications" },
  { href: "/notifications/preferences", label: "Notification Preferences" },
  { href: "/system/audit", label: "Audit Logs" },
  { href: "/settings/general", label: "System Settings" },
  { href: "/settings/users", label: "User Management" },
  { href: "/settings/users/new", label: "Add User" },
  { href: "/settings/api", label: "API & Integrations" },
  { href: "/settings/ai", label: "AI Providers" },
  { href: "/settings/ai/logs", label: "AI Logs" },
  { href: "/settings/number-coding", label: "Number Coding Settings" },
  { href: "/settings/dispatch", label: "Dispatch Policy" },
  // Driver workspace
  { href: "/driver", label: "My Dashboard" },
  { href: "/driver/trips", label: "My Trips" },
  { href: "/driver/vehicle", label: "My Vehicle" },
  { href: "/driver/fuel", label: "Fuel Logs" },
  { href: "/driver/incidents", label: "Incident Reporting" },
  { href: "/driver/schedule", label: "My Schedule & Leave" },
  { href: "/driver/attendance", label: "My Attendance" },
  { href: "/driver/profile", label: "Profile & Credentials" },
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

  // Deferred entity search: typing stays instant while the network query lags
  // one render behind instead of firing per keystroke.
  const debouncedQuery = useDeferredValue(query);

  const pageCommands = useMemo(
    () => PAGE_COMMANDS.filter((c) => canAccess(c.href)),
    [canAccess]
  );

  // Deferred (not debounced) entity search handled above via useDeferredValue.

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["global-search", debouncedQuery],
    queryFn: () => globalSearch(debouncedQuery),
    enabled: open && debouncedQuery.trim().length >= 2,
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

  const hasQuery = debouncedQuery.trim().length >= 2;
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
      // Pages stay available while searching — jumping to a page mid-search is
      // a common move and the two result kinds aren't mutually exclusive.
      const q = debouncedQuery.trim().toLowerCase();
      const pageHits = pageCommands
        .filter((c) => c.label.toLowerCase().includes(q))
        .map((c) => ({ ...c, type: "page" }));
      if (pageHits.length) s.push({ label: "Pages", items: pageHits });
      if (s.length === 0 && !isFetching) s.push({ label: "No results", items: [] });
    }
    return s;
  }, [hasQuery, pageCommands, searchSections, debouncedQuery, isFetching]);

  // Flat item index for arrow-key navigation.
  const { flat, count } = useMemo(() => {
    const flat = [];
    for (const sec of sections) for (const it of sec.items) flat.push(it);
    return { flat, count: flat.length };
  }, [sections]);

  // Reset the highlighted row whenever the result set changes — done with the
  // "adjust state during render" pattern instead of an effect so the cursor
  // never points at a stale item.
  const resultKey = `${open}|${debouncedQuery}|${count}`;
  const [lastResultKey, setLastResultKey] = useState(resultKey);
  if (resultKey !== lastResultKey) {
    setLastResultKey(resultKey);
    setActive(0);
  }

  const navigate = (href) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- navigate closes over stable router.push
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
                    key={`${it.type}-${it.href}-${it.id ?? ""}`}
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
