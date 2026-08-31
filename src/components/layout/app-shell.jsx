import { useState, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useRoleAccess } from "@/hooks/use-role-access";
import { getWorkspace } from "@/lib/workspaces";
import { DISPATCH_STATUS as D, RESERVATION_LIFECYCLE as L } from "@/lib/constants";
import { useQuery } from "@tanstack/react-query";
import { getAllIncidents } from "@/services/driver.service";
import { getDispatches } from "@/services/dispatch.service";
import { getFuelRequests } from "@/services/fuel.service";
import { getTransportRequests } from "@/services/transport.service";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CarFront,
  Bell,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { UserDropdown } from "@/components/ui/user-dropdown";
import { NotificationDropdown } from "@/components/ui/notification-dropdown";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { getInitials } from "@/lib/utils";
import { useSidebar } from "@/hooks/use-sidebar";

const accentChip = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  info: "bg-info/10 text-info",
  danger: "bg-danger/10 text-danger",
  neutral: "bg-foreground text-surface",
};

// Every collapsed-rail class comes in two halves: the pinned-narrow look and the
// `group-hover:` half that widens it back out. Only Auto mode wants the second
// half — in Collapsed mode the rail stays narrow, so those classes must not be
// emitted at all.
function onPeek(peek, classes) {
  return peek ? classes : "";
}

function isActive(pathname, href, allHrefs = []) {
  if (pathname === href) return true;
  if (href === "/dashboard") return false;
  if (!pathname.startsWith(href + "/")) return false;

  const hasBetterMatch = allHrefs.some(
    (otherHref) =>
      otherHref !== href &&
      otherHref.length > href.length &&
      (pathname === otherHref || pathname.startsWith(otherHref + "/"))
  );

  return !hasBetterMatch;
}

const NAV_BADGE_TONES = {
  danger: "bg-danger text-white",
  warning: "bg-warning/10 text-warning-700 ring-1 ring-warning/20",
};

function SidebarBadge({ count, collapsed, tone = "warning" }) {
  if (!(Number(count) > 0)) return null;

  return (
    <span
      className={cn(
        "rounded-full transition-all duration-300",
        NAV_BADGE_TONES[tone] || NAV_BADGE_TONES.warning,
        collapsed
          ? "absolute top-1 right-1 h-2 w-2 p-0 ring-2 ring-sidebar group-hover:static group-hover:ml-auto group-hover:flex group-hover:h-5 group-hover:min-w-5 group-hover:w-auto group-hover:items-center group-hover:justify-center group-hover:px-1 group-hover:text-[11px] group-hover:font-bold group-hover:ring-0"
          : "ml-auto flex h-5 min-w-5 items-center justify-center px-1 text-[11px] font-bold"
      )}
    >
      <span className={cn("transition-all duration-300", collapsed ? "hidden group-hover:block" : "block")}>
        {count}
      </span>
    </span>
  );
}

function badgeAriaLabel(item, badge) {
  if (!badge || !(Number(badge.count) > 0)) return undefined;
  return `${item.label}: ${badge.count} ${badge.noun}${badge.count === 1 ? "" : "s"}${badge.suffix || ""}`;
}

export function Sidebar() {
  const pathname = usePathname();
  const { employee, signOut, loading } = useAuth();
  const { filterNav, userRole } = useRoleAccess();
  const { collapsed, peek, toggle } = useSidebar();
  const workspace = getWorkspace(userRole);
  const visibleGroups = filterNav(workspace.nav || []);
  const homeHref = workspace.home;
  const chip = accentChip[workspace.accent] || accentChip.neutral;
  const requestQueueVisible = visibleGroups.some((group) =>
    (group.items || []).some((item) => item.href === "/reservations/queue")
  );
  const incidentVisible = visibleGroups.some((group) =>
    (group.items || []).some((item) => item.href === "/incidents")
  );
  const dispatchVisible = visibleGroups.some((group) =>
    (group.items || []).some((item) => item.href === "/dispatch")
  );
  const fuelVisible = visibleGroups.some((group) =>
    (group.items || []).some((item) => item.href === "/fuel")
  );

  const { data: openIncidents = [] } = useQuery({
    queryKey: ["pending-incidents"],
    // Incidents only have Open and Resolved states. Open is the actionable
    // state and remains counted until a resolver closes it.
    queryFn: () => getAllIncidents({ status: "Open" }),
    enabled: incidentVisible,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });
  const openIncidentCount = openIncidents.length;

  // Request records have no persisted viewed/unread flag. Pending is the
  // current lifecycle's "received, not yet acted on" state.
  const { data: pendingRequests } = useQuery({
    queryKey: ["transport-requests", "sidebar-pending-count"],
    queryFn: () => getTransportRequests({ fleet_status: L.PENDING, limit: 1 }),
    enabled: requestQueueVisible,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });
  const pendingRequestCount = Number(pendingRequests?.total) || 0;

  // Fuel requests have an explicit Pending -> Approved/Rejected review step.
  // Pending therefore stays visible until staff acts on the request.
  const { data: pendingFuelRequests } = useQuery({
    queryKey: ["fuel-requests", "sidebar-pending-count"],
    queryFn: () => getFuelRequests({ status: "Pending" }),
    enabled: fuelVisible && ["admin", "system_admin", "fleet_manager"].includes(userRole),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });
  const pendingFuelCount = Number(pendingFuelRequests?.counts?.pending)
    || (Array.isArray(pendingFuelRequests?.rows) ? pendingFuelRequests.rows.length : 0);

  // A dispatch marked Pending Reassignment needs a new vehicle/driver pair;
  // assignment or cancellation removes it from this attention count.
  const { data: pendingDispatches = [] } = useQuery({
    queryKey: ["dispatches", "sidebar-pending-reassignment-count"],
    queryFn: () => getDispatches({ status: D.PENDING_REASSIGNMENT }),
    enabled: dispatchVisible,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });
  const pendingReassignmentCount = Array.isArray(pendingDispatches) ? pendingDispatches.length : 0;

  const navBadges = {
    "/incidents": { count: openIncidentCount, tone: "danger", noun: "open incident" },
    "/reservations/queue": { count: pendingRequestCount, tone: "warning", noun: "pending request" },
    "/fuel": { count: pendingFuelCount, tone: "warning", noun: "fuel request", suffix: " awaiting review" },
    "/dispatch": { count: pendingReassignmentCount, tone: "danger", noun: "dispatch", suffix: " pending reassignment" },
  };

  const allHrefs = useMemo(() => {
    const hrefs = [];
    visibleGroups.forEach((group) => {
      (group.items || []).forEach((item) => {
        if (item.href) hrefs.push(item.href);
        if (item.children) {
          item.children.forEach((child) => {
            if (child.href) hrefs.push(child.href);
          });
        }
      });
    });
    return hrefs;
  }, [visibleGroups]);

  return (
    <aside
      className={cn(
        "peer fixed left-0 top-0 z-40 flex h-full flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300 select-none overflow-x-hidden whitespace-nowrap",
        // `group` is what arms every group-hover: below, so Collapsed mode drops
        // it entirely and the rail stops reacting to the pointer.
        peek && "group",
        collapsed ? "w-[72px]" : "w-60",
        onPeek(peek, "hover:w-60")
      )}
    >
      {/* ── ORIGINAL CLEAN BRAND HEADER ── */}
      <div className={cn(
        "group/brand relative flex h-14 items-center border-b border-sidebar-border transition-all duration-300",
        collapsed ? "justify-center px-0" : "px-4",
        collapsed && onPeek(peek, "group-hover:justify-start group-hover:px-4")
      )}>
        <Link href={homeHref} className={cn("flex items-center overflow-hidden", collapsed ? cn("gap-0", onPeek(peek, "group-hover:gap-2.5")) : "gap-2.5")}>
          <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded", chip)}>
            <CarFront className="h-4 w-4" />
          </div>
          <span className={cn(
            "text-base font-semibold tracking-tight text-foreground transition-all duration-300",
            collapsed ? "w-0 opacity-0" : "w-[150px] opacity-100",
            collapsed && onPeek(peek, "group-hover:w-[150px] group-hover:opacity-100 group-hover:ml-0")
          )}>
            {workspace.name}
          </span>
        </Link>
        <button
          onClick={toggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded text-foreground-muted hover:text-foreground hover:bg-hover transition-all duration-200 cursor-pointer",
            !collapsed && "ml-auto",
            // Pinned narrow: the mark and the toggle share one 72px slot, so the
            // toggle only surfaces while the header itself is hovered.
            collapsed && !peek && "absolute left-1/2 -translate-x-1/2 bg-sidebar opacity-0 pointer-events-none group-hover/brand:opacity-100 group-hover/brand:pointer-events-auto",
            // Auto: hidden on the rail, rejoins the row once hover re-flows it.
            collapsed && peek && "hidden group-hover:flex group-hover:ml-auto"
          )}
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* ── NAVIGATION LIST WITH SMOOTH HOVER ANIMATION ── */}
      <nav className="flex-1 overflow-y-auto scrollbar-none px-2 py-4 space-y-6">
        {visibleGroups.map((group) => (
          <div key={group.label}>
            <p className={cn(
              "px-2 mb-1.5 text-[11px] font-medium uppercase tracking-wider text-foreground-muted transition-all duration-300",
              collapsed ? "w-0 opacity-0 h-0 overflow-hidden group-hover:w-auto group-hover:opacity-100 group-hover:h-4" : "w-auto opacity-100 h-4"
            )}>
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href, allHrefs);
                if (item.children) {
                  return (
                    <NavGroupItem
                      key={item.href}
                      item={item}
                      pathname={pathname}
                      collapsed={collapsed}
                      userRole={userRole}
                      allHrefs={allHrefs}
                      navBadges={navBadges}
                    />
                  );
                }
                const badge = navBadges[item.href];
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center rounded-md py-2 text-sm transition-all duration-300 relative cursor-pointer hover:translate-x-0.5",
                      collapsed ? "gap-0 px-1 justify-center group-hover:gap-3 group-hover:justify-start group-hover:px-2" : "gap-3 px-2",
                      active
                        ? "bg-hover text-foreground font-medium"
                        : "text-foreground-secondary hover:text-foreground hover:bg-hover"
                    )}
                    title={collapsed ? item.label : undefined}
                    aria-label={badgeAriaLabel(item, badge)}
                  >
                    {active && (
                      <span className={cn(
                        "absolute left-0 top-1.5 bottom-1.5 w-[2.5px] bg-foreground rounded-r-full pointer-events-none transition-all duration-300",
                        collapsed ? "opacity-0 group-hover:opacity-100" : "opacity-100"
                      )} />
                    )}
                    {active && (
                      <span className={cn(
                        "absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-foreground ring-2 ring-sidebar pointer-events-none transition-all duration-300",
                        collapsed ? "opacity-100 group-hover:opacity-0" : "opacity-0"
                      )} />
                    )}
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className={cn(
                      "transition-all duration-300 overflow-hidden",
                      collapsed ? "w-0 opacity-0 group-hover:w-[140px] group-hover:opacity-100 group-hover:ml-0" : "w-[140px] opacity-100 ml-0"
                    )}>
                      {item.label}
                    </span>
                    <SidebarBadge count={badge?.count} collapsed={collapsed} tone={badge?.tone} />
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* ── ORIGINAL USER FOOTER CARD ── */}
      {!loading && (
        <div className={cn(
          "border-t border-sidebar-border py-3 transition-all duration-300",
          collapsed ? "flex justify-center px-2 group-hover:justify-start group-hover:px-3" : "px-3"
        )}>
          <UserDropdown
            employee={employee}
            signOut={signOut}
            side="top"
            align="start"
            chevron="up"
            triggerClassName={cn(
              "rounded-md py-1.5 hover:bg-hover transition-colors duration-150 cursor-pointer overflow-hidden flex items-center",
              collapsed ? "gap-0 w-9 px-1 justify-center group-hover:gap-2.5 group-hover:w-full group-hover:px-2 group-hover:justify-start" : "gap-2.5 w-full px-2 justify-start"
            )}
          >
            <Avatar className="h-7 w-7 shrink-0">
              <AvatarFallback className="bg-hover text-foreground-secondary text-[11px]">
                {employee ? getInitials(employee.first_name + " " + employee.last_name) : "U"}
              </AvatarFallback>
            </Avatar>
            <div className={cn(
              "flex-1 min-w-0 text-left transition-all duration-300",
              collapsed ? "w-0 opacity-0 group-hover:w-auto group-hover:opacity-100" : "w-auto opacity-100"
            )}>
              <p className="text-sm font-medium text-foreground truncate leading-tight">
                {employee ? employee.first_name + " " + employee.last_name : "User"}
              </p>
              <p className="text-[11px] text-foreground-muted truncate">
                {employee?.roles?.role_name ?? ""}
              </p>
            </div>
          </UserDropdown>
        </div>
      )}
    </aside>
  );
}

function NavGroupItem({ item, pathname, collapsed, userRole, allHrefs, navBadges }) {
  const [expanded, setExpanded] = useState(
    pathname.startsWith(item.href) && item.href !== "/dashboard"
  );
  const active = isActive(pathname, item.href, allHrefs);
  const visibleChildren = item.children || [];
  const badge = navBadges[item.href];

  if (visibleChildren.length === 0) return null;

  return (
    <div className="group/navitem relative">
      <button
        onClick={() => {
          // If completely collapsed and not hovered, clicking redirects to first child.
          // Otherwise, it toggles the accordion.
          if (collapsed && !expanded) {
            // we let hover open it visually, clicking toggles expansion
            setExpanded(!expanded);
          } else {
            setExpanded(!expanded);
          }
        }}
        className={cn(
          "flex w-full items-center rounded-md py-2 text-sm transition-all duration-300 relative cursor-pointer hover:translate-x-0.5",
          collapsed ? "gap-0 px-1 justify-center group-hover:gap-3 group-hover:justify-start group-hover:px-2" : "gap-3 px-2",
          active
            ? "bg-hover text-foreground font-medium"
            : "text-foreground-secondary hover:text-foreground hover:bg-hover"
        )}
        aria-label={badgeAriaLabel(item, badge)}
      >
        {active && (
          <span className={cn(
            "absolute left-0 top-1.5 bottom-1.5 w-[2.5px] bg-foreground rounded-r-full pointer-events-none transition-all duration-300",
            collapsed ? "opacity-0 group-hover:opacity-100" : "opacity-100"
          )} />
        )}
        {active && (
          <span className={cn(
            "absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-foreground ring-2 ring-sidebar pointer-events-none transition-all duration-300",
            collapsed ? "opacity-100 group-hover:opacity-0" : "opacity-0"
          )} />
        )}
        <item.icon className="h-4 w-4 shrink-0" />
        <span className={cn(
          "text-left transition-all duration-300 overflow-hidden",
          collapsed ? "w-0 opacity-0 group-hover:w-[140px] group-hover:opacity-100" : "flex-1 w-[140px] opacity-100"
        )}>
          {item.label}
        </span>
        <SidebarBadge count={badge?.count} collapsed={collapsed} tone={badge?.tone} />
        {/* Width lives only in the ternary — declaring w-3.5 in the base class too
            would out-specify the collapsed w-0 and keep 14px of chevron in the
            flex row, pushing the icon off the axis the plain nav links center on. */}
        <ChevronDown className={cn(
          "h-3.5 shrink-0 text-foreground-muted transition-all duration-300",
          expanded && "rotate-180",
          collapsed ? "w-0 opacity-0 group-hover:w-3.5 group-hover:opacity-100" : "w-3.5 opacity-100"
        )} />
      </button>
      <div className={cn(
        "overflow-hidden transition-all duration-300",
        expanded ? "mt-0.5 max-h-[500px]" : "max-h-0",
        collapsed ? "opacity-0 group-hover:opacity-100" : "opacity-100"
      )}>
        <div className="ml-3 space-y-0.5">
          {visibleChildren.map((child) => {
            const isChildActive = child.href === item.href
              ? pathname === child.href
              : isActive(pathname, child.href, allHrefs);
            const childBadge = navBadges[child.href];
            return (
              <Link
                key={child.href}
                href={child.href}
                className={cn(
                  "relative block rounded-md px-3 py-1.5 text-sm transition-all duration-150 hover:translate-x-0.5 cursor-pointer",
                  isChildActive
                    ? "bg-hover text-foreground font-medium"
                    : "text-foreground-secondary hover:text-foreground hover:bg-hover"
                )}
              >
                {isChildActive && (
                  <span className="absolute left-0 top-1 bottom-1 w-[2.5px] bg-foreground rounded-r-full pointer-events-none" />
                )}
                <span className="flex items-center justify-between">
                  <span>{child.label}</span>
                  <SidebarBadge count={childBadge?.count} collapsed={false} tone={childBadge?.tone} />
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function TopNav() {
  const pathname = usePathname();
  const { signOut, user, employee, loading } = useAuth();
  const { collapsed, peek } = useSidebar();

  const workspace = getWorkspace(employee?.roles?.role_name || user?.role);
  const segments = pathname.split("/").filter(Boolean);

  return (
    <header
      className={cn(
        "fixed top-0 right-0 z-30 flex h-14 items-center border-b border-border bg-surface transition-all duration-300 select-none",
        collapsed ? "left-[72px]" : "left-60",
        collapsed && peek && "peer-hover:left-60"
      )}
    >
      <div className="flex items-center gap-2 px-6">
        <span className="text-sm font-medium text-foreground">{workspace.name}</span>
        {segments.length > 0 && <span className="text-foreground-muted text-xs">/</span>}
        {segments.map((seg, i) => {
          const href = "/" + segments.slice(0, i + 1).join("/");
          const label = seg.replace(/-/g, " ");
          const isLast = i === segments.length - 1;
          return (
            <span key={href} className="flex items-center gap-2">
              {i > 0 && <span className="text-foreground-muted text-xs">/</span>}
              {isLast ? (
                <span className="text-sm font-medium text-foreground capitalize">{label}</span>
              ) : (
                <Link href={href} className="text-xs text-foreground-muted hover:text-foreground capitalize">
                  {label}
                </Link>
              )}
            </span>
          );
        })}
      </div>

      <div className="ml-auto flex items-center gap-2 px-6">
        <ThemeToggle />

        <NotificationDropdown />

        <div className="h-5 w-px bg-border" />

        {!loading && (
          <UserDropdown employee={employee} signOut={signOut} side="bottom" align="end" chevron="down" />
        )}
      </div>
    </header>
  );
}
