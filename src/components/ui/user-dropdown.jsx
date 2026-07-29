"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { getInitials, cn } from "@/lib/utils";
import {
  User,
  Lock,
  LogOut,
  ChevronUp,
  ChevronDown,
} from "lucide-react";

function formatRole(role) {
  if (!role) return "";
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function UserDropdown({ employee, signOut, side = "bottom", align = "end", children, chevron, triggerClassName }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const name = employee
    ? `${employee.first_name} ${employee.last_name}`
    : "User";
  const email = employee?.email || "";
  const role = employee?.roles?.role_name || "";

  const ChevronIcon = chevron === "up" ? ChevronUp : ChevronDown;

  const defaultContent = (
    <Avatar className="h-7 w-7">
      <AvatarFallback className="bg-hover text-foreground-secondary text-[11px]">
        {employee ? getInitials(name) : "U"}
      </AvatarFallback>
    </Avatar>
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-1.5 outline-none cursor-pointer transition-colors duration-150",
            open && "bg-hover rounded-md",
            triggerClassName
          )}
        >
          {children || defaultContent}
          {chevron && (
            <ChevronIcon
              className={cn(
                "h-4 w-4 text-foreground-muted transition-transform duration-150 flex-shrink-0",
                open && "rotate-180"
              )}
            />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={align} className="w-64">
        <div className="px-2.5 py-3">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-hover text-foreground-secondary text-sm font-medium">
                {employee ? getInitials(name) : "U"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate leading-snug">
                {name}
              </p>
              <p className="text-xs text-foreground-muted truncate mt-0.5">
                {email}
              </p>
              {role && (
                <Badge variant="outline" className="mt-1.5 text-[10px] px-1.5 py-0">
                  {formatRole(role)}
                </Badge>
              )}
            </div>
          </div>
        </div>

        <DropdownMenuSeparator />

        <div className="py-1">
          <DropdownMenuItem onClick={() => router.push("/settings/profile")}>
            <User className="h-4 w-4" />
            Edit Profile
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push("/settings/security")}>
            <Lock className="h-4 w-4" />
            Change Password
          </DropdownMenuItem>

        </div>

        <DropdownMenuSeparator />

        <div className="py-1">
          <DropdownMenuItem
            onClick={() => signOut()}
            className="text-danger focus:text-danger focus:bg-danger/10"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
