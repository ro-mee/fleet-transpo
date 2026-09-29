"use client";

import React from "react";
import { cn, formatDate } from "@/lib/utils";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  CalendarCheck,
  Send,
  Route,
  Info,
  Check,
  Trash2,
  Fuel,
} from "lucide-react";
import { notificationCategory } from "@/lib/notifications/presentation";

/**
 * Resolves the semantic color theme and icon for a notification row.
 * Treats the reference image as the primary visual source of truth:
 * - Red squircle with AlertCircle for alerts / failed inspections
 * - Amber squircle with AlertTriangle for warnings / maintenance due soon
 * - Soft emerald squircle with CheckCircle2 for successes
 * - Soft sky/blue squircle with contextual icon for dispatches, trips, info
 */
export function getNotificationTheme(notif = {}) {
  const type = String(notif.type || "").toLowerCase();
  const severity = String(notif.severity || "").toLowerCase();
  const title = String(notif.title || "").toLowerCase();
  const refType = String(notif.reference_type || "").toLowerCase();

  // Failed inspection / Repair filed / Alert / Emergency / Critical
  if (
    type === "alert" ||
    type === "emergency" ||
    type === "danger" ||
    type === "error" ||
    severity === "critical" ||
    severity === "major" ||
    title.includes("failed") ||
    title.includes("incident") ||
    title.includes("emergency") ||
    title.includes("out of service") ||
    title.includes("urgent") ||
    title.includes("cancelled") ||
    title.includes("breakdown")
  ) {
    return {
      tone: "danger",
      icon: AlertCircle,
      iconContainerClass: "bg-[#fdebed] text-[#e5484d] dark:bg-rose-950/40 dark:text-rose-400",
      badgeClass: "bg-[#fdebed] text-[#e5484d] dark:bg-rose-950/50 dark:text-rose-400",
    };
  }

  // Maintenance Due Soon / Warning / Moderate / Document expiry
  if (
    type === "warning" ||
    severity === "moderate" ||
    refType === "maintenance" ||
    refType === "document" ||
    title.includes("due") ||
    title.includes("scheduled") ||
    title.includes("warning") ||
    title.includes("expir")
  ) {
    return {
      tone: "warning",
      icon: AlertTriangle,
      iconContainerClass: "bg-[#f9f1e3] text-[#d97706] dark:bg-amber-950/40 dark:text-amber-400",
      badgeClass: "bg-[#f9f1e3] text-[#c46b00] dark:bg-amber-950/50 dark:text-amber-400",
    };
  }

  // Success / Completed / Approved
  if (
    type === "success" ||
    title.includes("completed") ||
    title.includes("approved") ||
    title.includes("resolved") ||
    title.includes("passed")
  ) {
    return {
      tone: "success",
      icon: CheckCircle2,
      iconContainerClass: "bg-[#ecfdf5] text-[#059669] dark:bg-emerald-950/40 dark:text-emerald-400",
      badgeClass: "bg-[#ecfdf5] text-[#059669] dark:bg-emerald-950/50 dark:text-emerald-400",
    };
  }

  // Info / Dispatch / Trip / Default
  let IconComponent = Info;
  if (refType === "dispatch" || type === "dispatch") IconComponent = Send;
  else if (refType === "trip" || type === "trip") IconComponent = Route;
  else if (refType === "reservation" || type === "reservation") IconComponent = CalendarCheck;
  else if (refType === "fuel" || type === "fuel") IconComponent = Fuel;

  return {
    tone: "info",
    icon: IconComponent,
    iconContainerClass: "bg-[#eff6ff] text-[#2563eb] dark:bg-blue-950/40 dark:text-blue-400",
    badgeClass: "bg-[#eff6ff] text-[#2563eb] dark:bg-blue-950/50 dark:text-blue-400",
  };
}

/**
 * Formats badge text to uppercase with reference ID matching the reference design.
 * Example: "MAINTENANCE #57"
 */
export function getNotificationBadgeLabel(notif = {}) {
  const category = notificationCategory(notif.reference_type);
  const baseLabel = category?.label || notif.reference_type || notif.type || "Notification";
  const refId = notif.reference_id;
  if (refId) {
    return `${baseLabel.toUpperCase()} #${refId}`;
  }
  return baseLabel.toUpperCase();
}

/**
 * Modern, minimalist Notification Card based on the provided visual reference.
 * - Neutral white card surface (#ffffff) with subtle border (#d7dee7)
 * - 22px rounded corners, soft ambient shadow
 * - Semantic color localized to left squircle (56x56), badge, and status dot
 * - Right circular action buttons: Acknowledge (check) and Delete (trash)
 */
export function NotificationCard({
  notification,
  onClick,
  onMarkAsRead,
  onDelete,
  className,
  compact = false,
}) {
  if (!notification) return null;

  const isUnread = !notification.is_read;
  const theme = getNotificationTheme(notification);
  const ThemeIcon = theme.icon;
  const badgeLabel = getNotificationBadgeLabel(notification);

  const rawDate = notification.sent_at || notification.created_at;
  const dateDisplay = rawDate ? formatDate(rawDate) : formatDate(new Date());

  const handleCardClick = () => {
    if (onClick) onClick(notification);
  };

  // Compact variant for dropdown menus or tighter UI slots
  if (compact) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={handleCardClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleCardClick();
          }
        }}
        className={cn(
          "group relative flex items-start gap-3.5 p-3.5 rounded-[18px]",
          "bg-[#ffffff] dark:bg-slate-900 border border-[#e2e8f0] dark:border-slate-800",
          "shadow-xs hover:border-[#cfd8e3] dark:hover:border-slate-700 hover:shadow-sm",
          "transition-all duration-200 cursor-pointer text-left w-full",
          isUnread ? "bg-white dark:bg-slate-900" : "opacity-80 hover:opacity-100",
          className
        )}
      >
        {/* Left Squircle Icon Container */}
        <div
          className={cn(
            "w-10 h-10 rounded-[14px] flex items-center justify-center shrink-0 shadow-2xs",
            theme.iconContainerClass
          )}
        >
          <ThemeIcon className="w-5 h-5 stroke-[2]" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 pt-0.5">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-[14px] font-bold text-[#101828] dark:text-white tracking-tight truncate">
              {notification.title}
            </h4>
            {isUnread && (
              <span
                className="w-2 h-2 rounded-full bg-[#3b82f6] shrink-0"
                aria-label="Unread"
              />
            )}
          </div>
          {notification.message && (
            <p className="text-[12px] text-[#667085] dark:text-slate-400 line-clamp-2 leading-relaxed">
              {notification.message}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2 text-[11px]">
            <span
              className={cn(
                "px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase",
                theme.badgeClass
              )}
            >
              {badgeLabel}
            </span>
            <span className="w-px h-3 bg-[#d9e1ec] dark:bg-slate-700 shrink-0" />
            <span className="font-medium text-[#667085] dark:text-slate-400">
              {dateDisplay}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0 self-center">
          {onMarkAsRead && isUnread && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMarkAsRead(notification.notification_id);
              }}
              title="Mark as read"
              aria-label="Mark as read"
              className="w-8 h-8 rounded-full border border-[#e6ebf2] dark:border-slate-800 bg-[#fafbfc] dark:bg-slate-800/80 text-[#667085] dark:text-slate-400 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-700 dark:hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            >
              <Check className="w-4 h-4 stroke-[2.2]" />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(notification);
              }}
              title="Delete notification"
              aria-label="Delete notification"
              className="w-8 h-8 rounded-full border border-[#f0d5d9] dark:border-rose-900/40 bg-white dark:bg-slate-900 text-[#ef4444] dark:text-rose-400 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-600 dark:hover:bg-rose-950/40 flex items-center justify-center transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4 stroke-[1.8]" />
            </button>
          )}
        </div>
      </div>
    );
  }

  // Full-size Card Layout (Faithful to Reference Image)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleCardClick();
        }
      }}
      className={cn(
        "group relative flex flex-col sm:flex-row sm:items-center justify-between gap-5 sm:gap-6 p-5 sm:px-7 sm:py-6 rounded-[22px]",
        "bg-[#ffffff] dark:bg-slate-900/90 border border-[#d7dee7] dark:border-slate-800",
        "shadow-[0_8px_24px_rgba(15,23,42,0.04)] dark:shadow-none",
        "hover:border-[#cfd8e3] dark:hover:border-slate-700 hover:shadow-[0_12px_28px_rgba(15,23,42,0.06)] hover:-translate-y-[1px]",
        "transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] cursor-pointer text-left w-full",
        className
      )}
    >
      <div className="flex items-start gap-4 sm:gap-5 flex-1 min-w-0">
        {/* Left Squircle Icon Container */}
        <div
          className={cn(
            "w-12 h-12 sm:w-14 sm:h-14 rounded-[18px] flex items-center justify-center shrink-0 shadow-2xs transition-transform duration-200 group-hover:scale-[1.02]",
            theme.iconContainerClass
          )}
        >
          <ThemeIcon className="w-6 h-6 sm:w-7 sm:h-7 stroke-[2.2]" />
        </div>

        {/* Middle Content Area */}
        <div className="flex-1 min-w-0 pt-0.5">
          {/* Title Row */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <h3 className="text-[17px] sm:text-[20px] font-bold text-[#101828] dark:text-white leading-[1.3] tracking-tight">
              {notification.title}
            </h3>
            {isUnread && (
              <span
                className="w-2.5 h-2.5 rounded-full bg-[#3b82f6] shrink-0 inline-block"
                aria-label="Unread notification"
                title="Unread"
              />
            )}
          </div>

          {/* Description Text */}
          {notification.message && (
            <p className="text-[14px] sm:text-[16px] font-normal text-[#667085] dark:text-slate-400 leading-[1.6] mt-1.5 break-words">
              {notification.message}
            </p>
          )}

          {/* Meta Row: Badge | Date */}
          <div className="flex items-center gap-3 mt-3 sm:mt-3.5 flex-wrap">
            <span
              className={cn(
                "px-3.5 py-1 sm:px-4 sm:py-1.5 rounded-full text-[12px] sm:text-[14px] font-bold tracking-[0.02em] uppercase transition-colors",
                theme.badgeClass
              )}
            >
              {badgeLabel}
            </span>
            <span
              className="w-px h-[18px] bg-[#d9e1ec] dark:bg-slate-700 shrink-0"
              aria-hidden="true"
            />
            <span className="text-[13px] sm:text-[15px] font-medium text-[#667085] dark:text-slate-400">
              {dateDisplay}
            </span>
          </div>
        </div>
      </div>

      {/* Right Action Icons: Acknowledge & Delete */}
      <div className="flex items-center gap-3 sm:gap-4 shrink-0 self-end sm:self-center pl-16 sm:pl-0">
        {onMarkAsRead && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMarkAsRead(notification.notification_id);
            }}
            title={isUnread ? "Mark as read" : "Acknowledged"}
            aria-label={isUnread ? "Mark as read" : "Acknowledged"}
            className={cn(
              "w-11 h-11 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer",
              "border border-[#e6ebf2] dark:border-slate-800 bg-[#fafbfc] dark:bg-slate-800/80",
              "text-[#667085] dark:text-slate-400 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-700 dark:hover:text-white",
              "hover:border-slate-300 dark:hover:border-slate-600 active:scale-95",
              !isUnread && "opacity-80 hover:opacity-100"
            )}
          >
            <Check className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2.2]" />
          </button>
        )}

        {onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(notification);
            }}
            title="Delete notification"
            aria-label="Delete notification"
            className={cn(
              "w-11 h-11 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer",
              "border border-[#f0d5d9] dark:border-rose-900/40 bg-white dark:bg-slate-900",
              "text-[#ef4444] dark:text-rose-400 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-600 dark:hover:bg-rose-950/40",
              "active:scale-95"
            )}
          >
            <Trash2 className="w-5 h-5 sm:w-6 sm:h-6 stroke-[1.8]" />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Skeleton placeholder matching the exact shape, paddings, and proportions of NotificationCard.
 */
export function NotificationCardSkeleton({ count = 3 }) {
  return (
    <div className="flex flex-col gap-4 sm:gap-5" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-5 sm:gap-6 p-5 sm:px-7 sm:py-6 rounded-[22px] bg-white dark:bg-slate-900/80 border border-[#d7dee7] dark:border-slate-800 shadow-[0_8px_24px_rgba(15,23,42,0.04)] animate-pulse"
        >
          <div className="flex items-start gap-4 sm:gap-5 flex-1 min-w-0">
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-[18px] bg-slate-100 dark:bg-slate-800 shrink-0" />
            <div className="flex-1 space-y-2.5 pt-1">
              <div className="h-5 w-56 rounded-md bg-slate-200 dark:bg-slate-800" />
              <div className="h-4 w-full max-w-lg rounded-md bg-slate-100 dark:bg-slate-800/60" />
              <div className="flex items-center gap-3 pt-1">
                <div className="h-7 w-32 rounded-full bg-slate-200 dark:bg-slate-800" />
                <div className="h-4 w-20 rounded-md bg-slate-100 dark:bg-slate-800/60" />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-4 shrink-0 self-end sm:self-center">
            <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-full bg-slate-100 dark:bg-slate-800" />
            <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-full bg-slate-100 dark:bg-slate-800" />
          </div>
        </div>
      ))}
    </div>
  );
}
