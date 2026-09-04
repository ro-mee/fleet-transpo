"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/tables/data-table";
import { HeroHeader } from "@/components/ui/hero-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { getFuelRecords } from "@/services/fuel.service";
import { apiFetch } from "@/lib/api/client";
import { formatDate, formatCurrency } from "@/lib/utils";
import { useRequireRole } from "@/lib/auth/role-guard";
import { DriverConsentGate } from "@/components/driver/consent-gate";
import { Fuel, TriangleAlert, Smartphone } from "lucide-react";

export default function DriverFuelPage() {
  useRequireRole();

  const { data: records = [], isLoading, isError } = useQuery({
    queryKey: ["driver-fuel"],
    queryFn: () => getFuelRecords(),
  });

  // Own refill permits (auto-scoped to this driver server-side). Records only
  // exist once a permit is approved, so this is where "waiting" lives.
  const { data: requestData = { rows: [] }, isLoading: requestsLoading } = useQuery({
    queryKey: ["driver-fuel-requests"],
    queryFn: () => apiFetch("/api/fuel/requests"),
  });
  const myRequests = requestData.rows || [];

  const totalSpend = records.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const pendingCount = records.filter((r) => (r.status || "Pending").toLowerCase() === "pending").length;

  const columns = [
    { key: "fuel_date", label: "Date", render: (val) => (val ? formatDate(val) : "—") },
    {
      key: "vehicle_info",
      label: "Vehicle",
      render: (_, row) => row.vehicles?.plate_number || "—",
    },
    { key: "fuel_type", label: "Fuel Type" },
    { key: "liters", label: "Liters", render: (val) => (val ? `${val} L` : "—") },
    { key: "amount", label: "Total", render: (val) => (val ? formatCurrency(val) : "—") },
    {
      key: "status",
      label: "Verification Status",
      render: (val) => {
        const st = (val || "Pending").toLowerCase();
        if (st === "approved" || st === "completed") {
          return <Badge variant="success" className="text-[11px]">Approved</Badge>;
        }
        if (st === "rejected") {
          return <Badge variant="danger" className="text-[11px]">Rejected</Badge>;
        }
        return <Badge variant="warning" className="text-[11px]">Pending Review</Badge>;
      },
    },
  ];

  const requestColumns = [
    {
      key: "created_at",
      label: "Filed",
      render: (val) => (val ? formatDate(val) : "—"),
    },
    {
      key: "vehicle_info",
      label: "Vehicle",
      render: (_, row) => row.plate_number || "—",
    },
    {
      key: "requested_liters",
      label: "Requested",
      render: (val, row) => (val ? `${val} L` : `${row.recommended_liters || "—"} L`),
    },
    {
      key: "approved_liters",
      label: "Approved",
      render: (val) => (val ? `${val} L` : "—"),
    },
    {
      key: "status",
      label: "Status",
      render: (val) => {
        const st = (val || "Pending").toLowerCase();
        if (st === "approved" || st === "fulfilled") {
          return <Badge variant="success" className="text-[11px]">Approved</Badge>;
        }
        if (st === "rejected") {
          return <Badge variant="danger" className="text-[11px]">Rejected</Badge>;
        }
        return <Badge variant="warning" className="text-[11px]">Pending Review</Badge>;
      },
    },
  ];

  return (
    <DriverConsentGate>
      <div className="space-y-6">
        <HeroHeader
          icon={Fuel}
          title="Fuel Logs"
          badge="My Work"
          description="Your fuel records and verification status."
        />

        <StatGrid cols={3}>
          <StatCard label="Total Records" value={records.length} icon={Fuel} color="primary" />
          <StatCard label="Pending Review" value={pendingCount} icon={TriangleAlert} color="warning" />
          <StatCard label="Total Spend" value={formatCurrency(totalSpend)} icon={Fuel} color="success" />
        </StatGrid>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-primary" /> Request fuel from the mobile app
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-foreground-secondary">
              Refills start as a <strong className="text-foreground">fuel request</strong> from the driver mobile app —
              it needs a fuel-gauge photo, and a manager approves the liters before anything is logged.
              Direct web entries are disabled so every record traces back to an approved request.
            </p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold">My Fuel Requests</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={requestColumns}
              data={myRequests}
              searchable={false}
              emptyTitle="No fuel requests yet"
              emptyDescription="Requests you file from the mobile app will appear here with their approval status."
              isLoading={requestsLoading}
            />
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold">My Fuel Records</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={columns}
              data={records}
              searchable={false}
              emptyTitle="No fuel records yet"
              emptyDescription="Fuel records you submit will appear here for verification."
              isLoading={isLoading}
            />
          </CardContent>
        </Card>
      </div>
    </DriverConsentGate>
  );
}
