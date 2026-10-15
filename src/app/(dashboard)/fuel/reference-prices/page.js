"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRoleAccess, useRequireRole } from "@/hooks/use-role-access";
import { apiFetch } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HeroHeader, heroButtonOutlineClass } from "@/components/ui/hero-header";
import { formatDateTime, formatCurrency } from "@/lib/utils";
import { ArrowLeft, ExternalLink, Fuel, MapPin } from "lucide-react";

const manilaInstant = (value) => value ? `${value}${value.length === 16 ? ":00" : ""}+08:00` : null;
export function manualSnapshotBody(form) {
  return { fuel_product: form.get("fuel_product"), region: form.get("region"), reference_price: form.get("reference_price"), prior_price: form.get("prior_price") || null, announced_at: manilaInstant(form.get("announced_at")), effective_at: manilaInstant(form.get("effective_at")), source_url: form.get("source_url") };
}

export function pdfImportBody(form) {
  const week = form.get("week_label");
  return { pdf_url: form.get("pdf_url"), week_label: week == null || String(week).trim() === "" ? null : String(week).trim() };
}

// Preview proxies through source-pdf, which only serves PDF sources (422
// otherwise): hide the button for non-PDF rows so a manual HTML source URL
// never opens a blank iframe.
export function isPdfSource(url) {
  return String(url ?? "").split(/[?#]/)[0].toLowerCase().endsWith(".pdf");
}

export function ReferencePriceHistory({ rows = [] }) {
  const [previewId, setPreviewId] = useState(null);
  const preview = rows.find((r) => r.snapshot_id === previewId) ?? null;
  if (!rows.length) {
    return <EmptyState
      icon={Fuel}
      title="No verified reference prices yet"
      description="Add a dated price from an official source."
      variant="first-run"
      size="compact"
    />;
  }
  return (
    <div className="custom-scrollbar overflow-x-auto">
      <table className="w-full min-w-[1020px] text-left text-sm">
        <caption className="sr-only">Verified reference price history</caption>
        <thead>
          <tr className="border-y border-border/70 bg-hover/40">
            {["Fuel / region", "PHP per liter", "Effectivity", "Verification", "State", "Source"].map((label, index) => (
              <th
                key={label}
                scope="col"
                className={`px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted ${index === 1 ? "text-right" : "text-left"}`}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.snapshot_id} className="border-b border-border/60 transition-colors hover:bg-hover/40 last:border-0">
              <td className="px-4 py-4">
                <span className="font-semibold text-foreground">{row.fuel_product}</span>
                <span className="mt-1 block text-xs text-foreground-secondary">{row.region}</span>
              </td>
              <td className="whitespace-nowrap px-4 py-4 text-right font-semibold tabular-nums text-foreground">
                {formatCurrency(row.reference_price)}
              </td>
              <td className="whitespace-nowrap px-4 py-4 text-foreground-secondary">{formatDateTime(row.effective_at)}</td>
              <td className="px-4 py-4">
                <span className="font-medium text-foreground">{row.verification_method}</span>
                {row.verifier_name || row.verified_by ? (
                  <span className="mt-0.5 block text-xs text-foreground-secondary">{row.verifier_name || `Verifier ${row.verified_by}`}</span>
                ) : null}
              </td>
              <td className="whitespace-nowrap px-4 py-4">
                <Badge variant="outline" className="rounded-full border-border/70 bg-hover/50 px-2.5 py-1 text-xs font-medium text-foreground-secondary">
                  {row.lifecycle}
                </Badge>
              </td>
              <td className="px-4 py-4">
                <div className="flex flex-wrap items-center gap-1">
                  <Button asChild variant="ghost" size="sm" className="min-h-11 gap-1.5 px-3 text-xs font-medium text-foreground-secondary">
                    <a href={row.source_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      Open source
                    </a>
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="min-h-11 gap-1.5 px-3 text-xs font-medium" onClick={() => setPreviewId(row.snapshot_id)} disabled={!isPdfSource(row.source_url)} title={isPdfSource(row.source_url) ? "Preview the PDF source" : "Preview is available for PDF sources only"}>
                    Preview
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Dialog open={preview !== null} onOpenChange={(open) => { if (!open) setPreviewId(null); }}>
        <DialogContent className="max-w-5xl gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle className="text-lg">Dated source preview</DialogTitle>
          </DialogHeader>
          {preview ? <iframe title={`Source preview ${preview.snapshot_id}`} src={`/api/fuel/reference-prices/source-pdf?snapshot_id=${preview.snapshot_id}`} className="h-[70vh] min-h-[360px] w-full bg-background" /> : null}
          {preview ? (
            <div className="flex justify-end border-t border-border p-4">
              <Button asChild variant="outline" className="min-h-11">
                <a href={preview.source_url} target="_blank" rel="noopener noreferrer">Open source in new tab</a>
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
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
  const importPdf = useMutation({ mutationFn: (body) => apiFetch("/api/fuel/reference-prices/import-pdf", { method: "POST", body }), onSuccess: () => cache.invalidateQueries({ queryKey: ["fuel-reference-prices"] }) });
  if (loading) return <p role="status" className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-foreground-secondary">Loading access…</p>;
  return <div className="space-y-6">
    <HeroHeader
      icon={Fuel}
      title="Fuel reference prices"
      badge="Planning"
      description="Review dated prices for trip planning. Receipt records keep their actual pump prices. Completed trip estimates keep the price and efficiency recorded at completion."
      actions={(
        <Link href="/fuel" className={`${heroButtonOutlineClass} inline-flex min-h-11 items-center gap-2 rounded-xl px-3.5 text-sm font-semibold`}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Fuel Management
        </Link>
      )}
    />
    {prices.isLoading ? <p role="status" aria-busy="true" className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-foreground-secondary">Loading verified history…</p> : null}
    {prices.error ? (
      <div role="alert" className="flex flex-col gap-3 rounded-xl border border-danger/20 bg-danger-bg/50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">Reference prices could not be loaded</p>
          <p className="mt-1 text-sm text-foreground-secondary">{prices.error.message}</p>
        </div>
        <Button variant="outline" className="min-h-11 shrink-0" onClick={() => prices.refetch()}>Try again</Button>
      </div>
    ) : null}
    {prices.data ? <>
      <Card>
        <CardContent className="grid gap-5 p-5 sm:p-6 md:grid-cols-[minmax(12rem,0.8fr)_minmax(0,1.2fr)] md:items-end">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-foreground-secondary" aria-hidden="true" />
              <h2 className="text-base font-semibold tracking-tight text-foreground">Estimate region</h2>
            </div>
            <p className="text-sm text-foreground-secondary">
              {prices.data.region ? `Current region: ${prices.data.region}.` : "No region selected; price-based estimates are unavailable."}
            </p>
            <p className="text-xs text-foreground-muted">Trip completion uses prices from this region.</p>
          </div>
          {canEdit ? (
            <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={(event) => { event.preventDefault(); setRegion.mutate(new FormData(event.currentTarget).get("region")); }}>
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="estimate-region">Region</Label>
                <Input id="estimate-region" name="region" required maxLength={100} defaultValue={prices.data.region || ""} />
              </div>
              <Button variant="outline" className="min-h-11" disabled={setRegion.isPending}>{setRegion.isPending ? "Saving…" : "Save region"}</Button>
              {setRegion.error ? <p role="alert" className="text-sm text-danger-700 sm:col-span-2">{setRegion.error.message}</p> : null}
              {setRegion.isSuccess ? <p role="status" className="text-sm text-success-700 sm:col-span-2">Estimate region saved.</p> : null}
            </form>
          ) : (
            <div className="sm:justify-self-end">
              <Badge variant="outline" className="rounded-full border-border/70 bg-hover/50 px-3 py-1.5 text-sm font-medium text-foreground">
                {prices.data.region || "No region selected"}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {canEdit ? <Card className="overflow-hidden border-primary/15">
        <CardHeader className="pb-4">
          <CardTitle>Import from DOE PDF</CardTitle>
          <p className="max-w-3xl text-sm leading-relaxed text-foreground-secondary">Paste the weekly NCR monitoring PDF link. The server averages company Diesel and Gasoline prices and records them as pending snapshots with you as verifier. Anything it cannot parse is reported, never guessed.</p>
        </CardHeader>
        <CardContent className="pt-0">
          <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; importPdf.mutate(pdfImportBody(new FormData(form)), { onSuccess: () => form.reset() }); }}>
            <div className="space-y-1.5 md:col-span-2"><Label htmlFor="pdf-url">Weekly NCR PDF URL</Label><Input id="pdf-url" name="pdf_url" type="url" required maxLength={2000} placeholder="https://…/NCR Liquid Fuel Price Monitoring 29 Sep to 5 Oct 2026.pdf" /></div>
            <div className="space-y-1.5"><Label htmlFor="week-label">Week label override (optional)</Label><Input id="week-label" name="week_label" maxLength={200} placeholder="NCR Price Monitoring Sep 1-7 2026.pdf" /></div>
            <div className="flex items-end"><Button className="min-h-11 w-full md:w-auto" disabled={importPdf.isPending}>{importPdf.isPending ? "Importing…" : "Import weekly PDF"}</Button></div>
            {importPdf.error ? <p role="alert" className="rounded-lg bg-danger-bg/60 px-3 py-2 text-sm text-danger-700 md:col-span-2">{importPdf.error.message}</p> : null}
            {importPdf.isSuccess ? <p role="status" className="rounded-lg bg-success-bg/60 px-3 py-2 text-sm text-success-700 md:col-span-2">{importPdf.data.persisted ? "Weekly PDF imported." : `Import finished without new prices: ${importPdf.data.reason ?? importPdf.data.products.map((p) => `${p.fuel_product}: ${p.reason ?? p.outcome}`).join("; ")}`}</p> : null}
          </form>
        </CardContent>
      </Card> : null}

      {canEdit ? <Card>
        <CardHeader className="pb-4">
          <CardTitle>Record a verified price</CardTitle>
          <p className="max-w-3xl text-sm leading-relaxed text-foreground-secondary">Check the dated official publication before saving. All times below are Manila time. Future prices remain pending until their effectivity. A correction needs a later effective time; existing prices are never edited.</p>
        </CardHeader>
        <CardContent className="pt-0">
          <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; save.mutate(manualSnapshotBody(new FormData(form)), { onSuccess: () => form.reset() }); }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="fuel-product">Fuel product</Label><Input id="fuel-product" name="fuel_product" required maxLength={30} placeholder="Diesel" /></div>
              <div className="space-y-1.5"><Label htmlFor="price-region">Price region</Label><Input id="price-region" name="region" required maxLength={100} defaultValue={prices.data.region || ""} /></div>
              <div className="space-y-1.5"><Label htmlFor="reference-price">Reference price (PHP per liter)</Label><Input id="reference-price" name="reference_price" type="number" required min="1" max="200" step="0.01" /></div>
              <div className="space-y-1.5"><Label htmlFor="prior-price">Prior price (optional)</Label><Input id="prior-price" name="prior_price" type="number" min="1" max="200" step="0.01" /></div>
              <div className="space-y-1.5"><Label htmlFor="effective-at">Effective from (Manila time)</Label><Input id="effective-at" name="effective_at" type="datetime-local" required /></div>
              <div className="space-y-1.5"><Label htmlFor="announced-at">Announcement time (optional)</Label><Input id="announced-at" name="announced_at" type="datetime-local" /></div>
              <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="source-url">Dated official source URL</Label><Input id="source-url" name="source_url" type="url" required maxLength={2000} /></div>
            </div>
            <label className="flex min-h-11 items-center gap-3 rounded-lg border border-border/70 px-3 py-2 text-sm text-foreground-secondary">
              <input type="checkbox" required className="h-4 w-4 shrink-0 rounded border-border accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2" />
              <span>I checked the publication, fuel product, region, price and effectivity.</span>
            </label>
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <Button variant="outline" className="min-h-11" disabled={save.isPending}>{save.isPending ? "Recording…" : "Record verified price"}</Button>
              {save.error ? <p role="alert" className="text-sm text-danger-700">{save.error.message}</p> : null}
              {save.isSuccess ? <p role="status" className="text-sm text-success-700">{save.data.duplicate ? "This price was already recorded." : "Verified price recorded."}</p> : null}
            </div>
          </form>
        </CardContent>
      </Card> : null}

      <Card className="overflow-hidden">
        <CardHeader className="pb-4">
          <CardTitle>Verified history</CardTitle>
          <p className="text-sm text-foreground-secondary">Compare dated prices, verification details, and their source documents.</p>
        </CardHeader>
        <CardContent className="pt-0"><ReferencePriceHistory rows={prices.data.rows} /></CardContent>
      </Card>
    </> : null}
  </div>;
}
