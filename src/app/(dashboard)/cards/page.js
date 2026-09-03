"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { HeroHeader } from "@/components/ui/hero-header";
import { DataTable } from "@/components/tables/data-table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { CreditCard, Plus } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { toast } from "@/components/ui/toast";
import { createColumnHelper } from "@tanstack/react-table";
import { formatDate } from "@/lib/utils";

function getCards() {
  return fetch("/api/cards").then((r) => r.json());
}

export default function CardsPage() {
  useRequireRole();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["company-cards"],
    queryFn: getCards,
  });

  const records = data?.rows || [];

  const columnHelper = createColumnHelper();
  
  const columns = [
    columnHelper.accessor("card_label", {
      header: "Card Label",
      cell: (info) => <span className="font-semibold">{info.getValue() || "—"}</span>,
    }),
    columnHelper.accessor("card_last_four", {
      header: "Last 4",
      cell: (info) => <span className="font-data">•••• {info.getValue()}</span>,
    }),
    columnHelper.accessor("provider", {
      header: "Provider",
      cell: (info) => info.getValue() || "—",
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: (info) => <StatusBadge status={info.getValue()} entity="fuel" />,
    }),
    columnHelper.display({
      id: "assignment",
      header: "Current Assignment",
      cell: (info) => {
        const row = info.row.original;
        if (!row.assignment_id) return <span className="text-foreground-muted">Unassigned</span>;
        if (row.employee) return `${row.employee.first_name} ${row.employee.last_name}`;
        if (row.vehicle) return `Vehicle: ${row.vehicle.plate_number}`;
        return row.assignment_type || "Assigned";
      }
    }),
    columnHelper.accessor("created_at", {
      header: "Created",
      cell: (info) => <span className="text-xs text-foreground-muted">{formatDate(info.getValue())}</span>,
    })
  ];

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={CreditCard}
        title="Company Cards"
        badge="Fleet & Finance"
        description="Manage company cards and track assignment history across drivers and vehicles."
        actions={
          <Button onClick={() => toast("Card creation modal would open here (Phase 9 placeholder)")}>
            <Plus className="w-4 h-4 mr-2" />
            Add Card
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={records}
        isLoading={isLoading}
        title="Active Cards"
        icon={CreditCard}
        emptyTitle="No company cards found"
        searchable={false}
      />
    </div>
  );
}
