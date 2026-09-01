"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/tables/data-table";
import { HeroHeader } from "@/components/ui/hero-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { toast } from "@/components/ui/toast";
import { getFuelRecords, createFuelRecord } from "@/services/fuel.service";
import { getMyVehicleInspection } from "@/services/driver.service";
import { FUEL_TYPE } from "@/lib/constants";
import { formatDate, formatCurrency } from "@/lib/utils";
import { useRequireRole } from "@/lib/auth/role-guard";
import { DriverConsentGate } from "@/components/driver/consent-gate";
import { Fuel, Plus, TriangleAlert } from "lucide-react";

export default function DriverFuelPage() {
  useRequireRole();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    fuel_date: new Date().toISOString().slice(0, 10),
    fuel_type: "Diesel",
    liters: "",
    amount: "",
    price_per_liter: "",
    odometer: "",
    station_name: "",
  });

  const { data: records = [], isLoading, isError } = useQuery({
    queryKey: ["driver-fuel"],
    queryFn: () => getFuelRecords(),
  });

  const { data: inspection } = useQuery({
    queryKey: ["driver-inspection"],
    queryFn: getMyVehicleInspection,
  });
  const assignedVehicleId = inspection?.vehicle_id || null;

  // Refuel dates can't be in the future — enforce natively via max and back it
  // up with an inline error on submit.
  const todayStr = new Date().toISOString().slice(0, 10);
  const [dateError, setDateError] = useState("");

  const totalSpend = records.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const pendingCount = records.filter((r) => (r.status || "Pending").toLowerCase() === "pending").length;

  const createMutation = useMutation({
    mutationFn: () => createFuelRecord({
      ...form,
      vehicle_id: assignedVehicleId,
      liters: Number(form.liters),
      amount: Number(form.amount),
      price_per_liter: form.price_per_liter ? Number(form.price_per_liter) : undefined,
      odometer: form.odometer ? Number(form.odometer) : undefined,
    }),
    onSuccess: () => {
      toast.success("Fuel record submitted for verification.");
      setDateError("");
      setForm({
        fuel_date: new Date().toISOString().slice(0, 10),
        fuel_type: "Diesel",
        liters: "",
        amount: "",
        price_per_liter: "",
        odometer: "",
        station_name: "",
      });
      queryClient.invalidateQueries({ queryKey: ["driver-fuel"] });
    },
    onError: (err) => toast.error(err.message || "Could not submit the fuel record."),
  });

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
          <StatCard label="Total Spend" value={formatCurrency(totalSpend)} icon={Plus} color="success" />
        </StatGrid>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Plus className="w-4 h-4 text-primary" /> Log Fuel
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!assignedVehicleId ? (
              <p className="text-sm text-foreground-secondary">
                You have no assigned vehicle, so you cannot log a fuel record yet. Your dispatcher or fleet manager will assign one.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <p className="md:col-span-3 text-[11px] text-foreground-muted">* required</p>
                <div>
                  <DatePicker
                    id="fuel_date"
                    label="Refuel Date *"
                    value={form.fuel_date}
                    onChange={(val) => {
                      setDateError("");
                      setForm({ ...form, fuel_date: val });
                    }}
                  />
                  {dateError && (
                    <p className="mt-1 text-[11px] text-danger">{dateError}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="fuel_type">Fuel Type *</Label>
                  <Select value={form.fuel_type} onValueChange={(val) => setForm({ ...form, fuel_type: val })}>
                    <SelectTrigger className="mt-1 h-9 w-full rounded-xl border border-border bg-surface text-sm font-medium"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.values(FUEL_TYPE).map((type) => (
                        <SelectItem key={type} value={type}>{type}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="station_name">Gas Station</Label>
                  <Input id="station_name" value={form.station_name}
                    onChange={(e) => setForm({ ...form, station_name: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="liters">Liters *</Label>
                  <Input id="liters" type="number" min="0" value={form.liters}
                    onChange={(e) => setForm({ ...form, liters: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="amount">Total Amount *</Label>
                  <Input id="amount" type="number" min="0" value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="price_per_liter">Price per Liter</Label>
                  <Input id="price_per_liter" type="number" min="0" value={form.price_per_liter}
                    onChange={(e) => setForm({ ...form, price_per_liter: e.target.value })} />
                </div>
                <div className="md:col-span-3">
                  <Label htmlFor="odometer">Odometer Reading</Label>
                  <Input id="odometer" type="number" min="0" value={form.odometer}
                    onChange={(e) => setForm({ ...form, odometer: e.target.value })} />
                </div>
                <div className="md:col-span-3 space-y-1.5">
                  <Button
                    disabled={createMutation.isPending || !form.liters || !form.amount}
                    onClick={() => {
                      if (form.fuel_date > todayStr) {
                        setDateError("Refuel date cannot be in the future.");
                        return;
                      }
                      setDateError("");
                      createMutation.mutate();
                    }}
                  >
                    {createMutation.isPending ? "Submitting…" : "Log Fuel"}
                  </Button>
                  {createMutation.isPending === false && (!form.liters || !form.amount) && (
                    <p className="text-[11px] text-foreground-muted">Enter liters and amount to submit.</p>
                  )}
                </div>
              </div>
            )}
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
