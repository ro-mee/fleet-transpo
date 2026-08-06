"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { RoleDashboard } from "@/components/dashboard/role-dashboard";

export default function DashboardPage() {
  const router = useRouter();
  const { employee, loading } = useAuth();
  const role = employee?.roles?.role_name;

  useEffect(() => {
    if (role === "driver") {
      router.replace("/driver");
    }
  }, [role, router]);

  if (loading || role === "driver") return null;

  return <RoleDashboard role={role} employee={employee} />;
}
