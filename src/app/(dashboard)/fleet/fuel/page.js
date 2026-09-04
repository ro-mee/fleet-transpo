"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Retired 2026-09-04: the exceptions + efficiency views now live as the
// "Needs review" section of /fuel (one ops home). This stub keeps old
// bookmarks and links working instead of 404ing.
export default function FleetFuelRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/fuel");
  }, [router]);
  return null;
}
