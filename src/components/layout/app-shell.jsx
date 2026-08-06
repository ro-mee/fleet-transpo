import { useState, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useRoleAccess } from "@/hooks/use-role-access";
import { getWorkspace } from "@/lib/workspaces";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CarFront,
  Sun,
  Moon,
  Bell,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { UserDropdown } from "@/components/ui/user-dropdown";
import { NotificationDropdown } from "@/components/ui/notification-dropdown";
import { getInitials } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";

const accentChip = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  info: "bg-info/10 text-info",
  danger: "bg-danger/10 text-danger",
  neutral: "bg-foreground text-surface",
};

function isActive(pathname, href, allHrefs = []) {
  if (pathname === href) return true;
  if (href === "/dashboard") return false;
  if (!pathname.startsWith(href + "/")) return false;

  // Suppress parent route highlight if a longer/more specific visible nav item matches
  const hasBetterMatch = allHrefs.some(
    (otherHref) =>
      otherHref !== href &&
      otherHref.length > href.length &&
      (pathname === otherHref || pathname.startsWith(otherHref + "/"))
  );

  return !hasBetterMatch;
}

export function Sidebar({ collapsed, setCollapsed }) {
  const pathname = usePathname();
  const { employee, signOut, loading } = useAuth();
  const { filterNav, userRole } = useRoleAccess();
  const workspace = getWorkspace(userRole);
  const visibleGroups = filterNav(workspace.nav || []);
  const homeHref = workspace.home;
  const chip = accentChip[workspace.accent] || accentChip.neutral;

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
        "fixed left-0 top-0 z-40 flex h-full flex-col bg-sidebar border-r border-sidebar-border transition-all duration-200",
        collapsed ? "w-[72px]" : "w-60"
      )}
    >
      <div className={cn(
        "flex h-14 items-center border-b border-sidebar-border",
        collapsed ? "justify-center px-0" : "px-4"
      )}>
        {!collapsed ? (
          <Link href={homeHref} className="flex items-center gap-2.5">
            <div className={cn("flex h-7 w-7 items-center justify-center rounded", chip)}>
              <CarFront className="h-4 w-4" />
            </div>
            <span className="text-base font-semibold tracking-tight text-foreground">{workspace.name}</span>
          </Link>
        ) : (
          <Link href={homeHref}>
            <div className={cn("flex h-7 w-7 items-center justify-center rounded", chip)}>
              <CarFront className="h-4 w-4" />
            </div>
          </Link>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded text-foreground-muted hover:text-foreground hover:bg-hover transition-colors cursor-pointer",
            collapsed ? "mt-4" : "ml-auto"
          )}
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto scrollbar-none px-2 py-4 space-y-6">
        {visibleGroups.map((group) => (
          <div key={group.label}>
            {!collapsed && (
              <p className="px-2 mb-1.5 text-[11px] font-medium uppercase tracking-wider text-foreground-muted">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href, allHrefs);
                if (item.children && !collapsed) {
                  return (
                    <NavGroupItem
                      key={item.href}
                      item={item}
                      pathname={pathname}
                      collapsed={collapsed}
                      userRole={userRole}
                      allHrefs={allHrefs}
                    />
                  );
                }
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors relative",
                      collapsed && "justify-center px-1",
                      active
                        ? "bg-hover text-foreground font-medium"
                        : "text-foreground-secondary hover:text-foreground hover:bg-hover"
                    )}
                    title={collapsed ? item.label : undefined}
                  >
                    {active && !collapsed && (
                      <span className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] bg-foreground rounded-r-full pointer-events-none" />
                    )}
                    {active && collapsed && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-foreground ring-2 ring-sidebar pointer-events-none" />
                    )}
                    <item.icon className="h-4 w-4 flex-shrink-0" />
                    {!collapsed && <span>{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {!loading && (
        <div className={cn(
          "border-t border-sidebar-border py-3",
          collapsed ? "flex justify-center px-2" : "px-3"
        )}>
          {!collapsed ? (
            <UserDropdown
              employee={employee}
              signOut={signOut}
              side="top"
              align="start"
              chevron="up"
              triggerClassName="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-hover transition-colors duration-150"
            >
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-hover text-foreground-secondary text-[11px]">
                  {employee ? getInitials(employee.first_name + " " + employee.last_name) : "U"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-sm font-medium text-foreground truncate leading-tight">
                  {employee ? employee.first_name + " " + employee.last_name : "User"}
                </p>
                <p className="text-[11px] text-foreground-muted truncate">
                  {employee?.roles?.role_name ?? ""}
                </p>
              </div>
            </UserDropdown>
          ) : (
            <UserDropdown
              employee={employee}
              signOut={signOut}
              side="top"
              align="start"
              chevron="up"
              triggerClassName="justify-center w-full rounded-md px-1 py-1.5 hover:bg-hover transition-colors duration-150"
            >
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-hover text-foreground-secondary text-[11px]">
                  {employee ? getInitials(employee.first_name + " " + employee.last_name) : "U"}
                </AvatarFallback>
              </Avatar>
            </UserDropdown>
          )}
        </div>
      )}
    </aside>
  );
}

function NavGroupItem({ item, pathname, collapsed, userRole, allHrefs }) {
  const [expanded, setExpanded] = useState(
    pathname.startsWith(item.href) && item.href !== "/dashboard"
  );
  const active = isActive(pathname, item.href, allHrefs);

  if (collapsed) {
    return (
      <Link
        href={item.children?.[0]?.href || item.href}
        className={cn(
          "flex items-center justify-center rounded-md px-1 py-2 text-sm transition-colors relative",
          active
            ? "bg-hover text-foreground"
            : "text-foreground-secondary hover:text-foreground hover:bg-hover"
        )}
        title={item.label}
      >
        {active && (
          <span className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-foreground ring-2 ring-sidebar pointer-events-none" />
        )}
        <item.icon className="h-4 w-4" />
      </Link>
    );
  }

  const visibleChildren = item.children || [];

  if (visibleChildren.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors relative cursor-pointer",
          active
            ? "bg-hover text-foreground font-medium"
            : "text-foreground-secondary hover:text-foreground hover:bg-hover"
        )}
      >
        {active && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] bg-foreground rounded-r-full pointer-events-none" />
        )}
        <item.icon className="h-4 w-4 flex-shrink-0" />
        <span className="flex-1 text-left">{item.label}</span>
        <ChevronDown className={cn(
          "h-3.5 w-3.5 text-foreground-muted transition-transform",
          expanded && "rotate-180"
        )} />
      </button>
      <div className={cn(
        "overflow-hidden transition-all duration-200",
        expanded ? "mt-0.5" : "h-0"
      )}>
        <div className="ml-3 space-y-0.5">
          {visibleChildren.map((child) => {
            const isChildActive = child.href === item.href
              ? pathname === child.href
              : isActive(pathname, child.href, allHrefs);
            return (
              <Link
                key={child.href}
                href={child.href}
                className={cn(
                  "relative block rounded-md px-3 py-1.5 text-sm transition-colors",
                  isChildActive
                    ? "bg-hover text-foreground font-medium"
                    : "text-foreground-secondary hover:text-foreground hover:bg-hover"
                )}
              >
                {isChildActive && (
                  <span className="absolute left-0 top-1 bottom-1 w-[2.5px] bg-foreground rounded-r-full pointer-events-none" />
                )}
                {child.label}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function TopNav({ collapsed }) {
  const pathname = usePathname();
  const { signOut, user, employee, loading } = useAuth();
  const { theme, toggle, mounted } = useTheme();

  const workspace = getWorkspace(employee?.roles?.role_name || user?.role);
  const segments = pathname.split("/").filter(Boolean);

  return (
    <header
      className={cn(
        "fixed top-0 right-0 z-30 flex h-14 items-center border-b border-border bg-surface transition-all duration-200",
        collapsed ? "left-[72px]" : "left-60"
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
        <button
          onClick={toggle}
          className="flex h-8 w-8 items-center justify-center rounded-md text-foreground-muted hover:text-foreground hover:bg-hover transition-colors cursor-pointer"
          title={mounted ? (theme === "dark" ? "Light mode" : "Dark mode") : "Toggle theme"}
        >
          {mounted ? (
            theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />
          ) : (
            <Sun className="h-4 w-4" />
          )}
        </button>

        <NotificationDropdown />

        <div className="h-5 w-px bg-border" />

        {!loading && (
          <UserDropdown employee={employee} signOut={signOut} side="bottom" align="end" chevron="down" />
        )}
      </div>
    </header>
  );
}
