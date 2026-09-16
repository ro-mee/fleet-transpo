"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

// Canonical driver-photo resolution for every staff-facing surface:
// self-uploaded face photo first, then the staff-set employee avatar,
// else initials. Same chain as the driver detail header
// (src/app/(dashboard)/drivers/[id]/page.js) and the roster list.
export function resolveDriverPhotoUrl(source) {
  if (!source || typeof source !== "object") return null;
  return (
    source.face_image_url ||
    source.avatar_url ||
    source.employees?.avatar_url ||
    source.driver?.face_image_url ||
    source.driver?.avatar_url ||
    null
  );
}

export function driverInitials(name, fallback = "DR") {
  if (!name || typeof name !== "string") return fallback;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  return (
    parts
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || fallback
  );
}

// Staff-facing driver avatar: photo when the record has one, initials
// otherwise. Broken/expired signed URLs fall back to initials instead of a
// broken-image icon.
export function DriverAvatar({ source, name, className, imgClassName, eager = false }) {
  const photoUrl = resolveDriverPhotoUrl(source);
  const [broken, setBroken] = useState(false);
  const showPhoto = Boolean(photoUrl && !broken);

  if (showPhoto) {
    return (
      <img
        src={photoUrl}
        alt={name || "Driver"}
        loading={eager ? "eager" : "lazy"}
        onError={() => setBroken(true)}
        className={cn(
          "flex h-10 w-10 shrink-0 rounded-2xl border border-border/40 object-cover shadow-2xs",
          imgClassName,
          className
        )}
      />
    );
  }

  return (
    <div
      aria-label={name || "Driver"}
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted/60 font-black text-xs text-foreground border border-border/40 shadow-2xs",
        className
      )}
    >
      {driverInitials(name)}
    </div>
  );
}
