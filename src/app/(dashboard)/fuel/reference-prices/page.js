"use client";

import React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRoleAccess, useRequireRole } from "@/hooks/use-role-access";
import { apiFetch } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatCurrency } from "@/lib/utils";

const manilaInstant = (value) => value ? `${value}${value.length === 16 ? ":00" : ""}+08:00` : null;
export function manualSnapshotBody(form) {
  return { fuel_product: form.get("fuel_product"), region: form.get("region"), reference_price: form.get("reference_price"), prior_price: form.get("prior_price") || null, announced_at: manilaInstant(form.get("announced_at")), effective_at: manilaInstant(form.get("effective_at")), source_url: form.get("source_url") };
}

export function ReferencePriceHistory({ rows = [] }) {
  if (!rows.length) return <p className="py-6 text-muted-foreground" role="status">No verified reference prices yet. Add a dated price from an official source.</p>;
  return <div className="overflow-x-auto"><table className="w-full text-left text-sm">
    <caption className="sr-only">Verified reference price history</caption>
    <thead><tr className="border-b">{["Fuel / region", "PHP per liter", "Effectivity", "Verification", "State", "Source"].map((label) => <th key={label} scope="col" className="p-3 font-medium">{label}</th>)}</tr></thead>
    <tbody>{rows.map((row) => <tr key={row.snapshot_id} className="border-b last:border-0">
      <td className="p-3">{row.fuel_product}<span className="block text-muted-foreground">{row.region}</span></td>
      <td className="p-3 tabular-nums">{formatCurrency(row.reference_price)}</td>
      <td className="p-3 whitespace-nowrap">{formatDateTime(row.effective_at)}</td>
      <td className="p-3">{row.verification_method}{row.verified_by ? <span className="block text-muted-foreground">Verifier {row.verified_by}</span> : null}</td>
      <td className="p-3">{row.lifecycle}</td>
      <td className="p-3"><a href={row.source_url} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4">View dated source</a></td>
    </tr>)}</tbody>
  </table></div>;
}

export default function ReferencePricesPage() {
  const { authorized } = useRequireRole();
  const { can, loading } = useRoleAccess();
  const canRead = authorized && can("fuelallocations", "read");
  const canEdit = can("fuelallocations", "update");
  const cache = useQueryClient();
  const prices = useQuery({ queryKey: ["fuel-reference-prices"], queryFn: () => apiFetch("/api/fuel/reference-prices"), enabled: canRead });
  const save = useMutation({ mutationFn: (body) => apiFetch("/api/fuel/reference-prices", { method: "POST", body }), onSuccess: () => cache.invalidateQueries({ queryKey: ["fuel-reference-prices"] }) });
  const setRegion = useMutation({ mutationFn: (region) => apiFetch("/api/fuel/reference-prices", { method: "PATCH", body: { region } }), onSuccess: () => cache.invalidateQueries({ queryKey: ["fuel-reference-prices"] }) });
  if (loading) return <p role="status">Loading access…</p>;
  if (!canRead) return <p role="alert">You do not have permission to view reference prices.</p>;
  return <div className="space-y-6">
    <header className="space-y-2"><Link href="/fuel" className="text-sm text-primary underline underline-offset-4">Back to Fuel Management</Link><h1 className="text-2xl font-semibold">Fuel reference prices</h1><p className="max-w-3xl text-muted-foreground">Review dated prices for trip planning. Receipt records keep their actual pump prices. Completed trip estimates keep the price and efficiency recorded at completion.</p></header>
    {prices.isLoading ? <p role="status">Loading verified history…</p> : null}
    {prices.error ? <div role="alert" className="rounded-lg border p-4"><p>{prices.error.message}</p><Button variant="outline" className="mt-3" onClick={() => prices.refetch()}>Try again</Button></div> : null}
    {prices.data ? <>
      <Card><CardHeader><CardTitle>Estimate region</CardTitle></CardHeader><CardContent>
        <p className="mb-3 text-sm text-muted-foreground">Trip completion uses prices from this region. {prices.data.region ? `Current region: ${prices.data.region}.` : "No region selected; price-based estimates are unavailable."}</p>
        {canEdit ? <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); setRegion.mutate(new FormData(event.currentTarget).get("region")); }}><div className="space-y-2"><Label htmlFor="estimate-region">Region</Label><Input id="estimate-region" name="region" required maxLength={100} defaultValue={prices.data.region || ""} /></div><Button disabled={setRegion.isPending}>Save region</Button></form> : null}
        {setRegion.error ? <p role="alert" className="mt-3 text-destructive">{setRegion.error.message}</p> : null}
        {setRegion.isSuccess ? <p role="status" className="mt-3">Estimate region saved.</p> : null}
      </CardContent></Card>
      {canEdit ? <Card><CardHeader><CardTitle>Record a verified price</CardTitle></CardHeader><CardContent>
        <p className="mb-4 text-sm text-muted-foreground">Check the dated official publication before saving. All times below are Manila time. Future prices remain pending until their effectivity. A correction needs a later effective time; existing prices are never edited.</p>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; save.mutate(manualSnapshotBody(new FormData(form)), { onSuccess: () => form.reset() }); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="fuel-product">Fuel product</Label><Input id="fuel-product" name="fuel_product" required maxLength={30} placeholder="Diesel" /></div>
            <div className="space-y-2"><Label htmlFor="price-region">Price region</Label><Input id="price-region" name="region" required maxLength={100} defaultValue={prices.data.region || ""} /></div>
            <div className="space-y-2"><Label htmlFor="reference-price">Reference price (PHP per liter)</Label><Input id="reference-price" name="reference_price" type="number" required min="1" max="200" step="0.01" /></div>
            <div className="space-y-2"><Label htmlFor="prior-price">Prior price (optional)</Label><Input id="prior-price" name="prior_price" type="number" min="1" max="200" step="0.01" /></div>
            <div className="space-y-2"><Label htmlFor="effective-at">Effective from (Manila time)</Label><Input id="effective-at" name="effective_at" type="datetime-local" required /></div>
            <div className="space-y-2"><Label htmlFor="announced-at">Announcement time (optional)</Label><Input id="announced-at" name="announced_at" type="datetime-local" /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="source-url">Dated official source URL</Label><Input id="source-url" name="source_url" type="url" required maxLength={2000} /></div>
          </div>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" required className="mt-1" />I checked the publication, fuel product, region, price and effectivity.</label>
          <Button disabled={save.isPending}>{save.isPending ? "Recording…" : "Record verified price"}</Button>
          {save.error ? <p role="alert" className="text-destructive">{save.error.message}</p> : null}
          {save.isSuccess ? <p role="status">{save.data.duplicate ? "This price was already recorded." : "Verified price recorded."}</p> : null}
        </form>
      </CardContent></Card> : null}
      <Card><CardHeader><CardTitle>Verified history</CardTitle></CardHeader><CardContent><ReferencePriceHistory rows={prices.data.rows} /></CardContent></Card>
    </> : null}
  </div>;
}
