"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function FleetPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/fleet/vehicles");
  }, [router]);

  return null;
}
