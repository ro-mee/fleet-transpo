"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CARGO_HANDLING_OPTIONS, blankCargoDraftLine } from "@/lib/cargo/cargo-draft";

function DraftField({ label, id, error, ...props }) {
  return <label htmlFor={id} className="space-y-1 text-xs font-medium text-foreground-secondary">
    <span className="block">{label}</span>
    <Input id={id} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} {...props} />
    {error && <span id={`${id}-error`} className="block text-danger">{error}</span>}
  </label>;
}

export function CargoContentsEditor({ lines, onChange, errors = {}, calculatedKg }) {
  const update = (index, field, value) => onChange(lines.map((line, at) => at === index ? { ...line, [field]: value } : line));
  return <section className="space-y-4 border-t border-border pt-5 md:col-span-2" aria-label="Cargo contents draft">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-sm font-semibold text-foreground">Cargo contents</h2><p className="mt-1 text-xs text-foreground-secondary">Unsaved local draft. Count ordered units separately from the packages being transported.</p></div>
      <Button type="button" variant="outline" size="sm" disabled={lines.length >= 500} onClick={() => onChange([...lines, blankCargoDraftLine(crypto.randomUUID())])}><Plus className="mr-1 size-4" />Add item</Button>
    </div>
    {errors.lines && <p role="alert" className="text-xs text-danger">{errors.lines}</p>}
    <ol className="divide-y divide-border">
      {lines.map((line, index) => {
        const id = `cargo-line-${line.line_id}`;
        const errorFor = field => errors[`line.${index}.${field}`];
        const field = (key, label, props = {}) => <DraftField key={key} id={`${id}-${key}`} label={label} value={line[key]} onChange={event => update(index, key, event.target.value)} error={errorFor(key)} {...props} />;
        return <li key={line.line_id} className="space-y-3 py-4 first:pt-0">
          <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium">Item {index + 1}</h3><Button type="button" variant="ghost" size="sm" disabled={lines.length === 1} aria-label={`Remove item ${index + 1}`} onClick={() => onChange(lines.filter((_, at) => at !== index))}><Trash2 className="mr-1 size-4" />Remove</Button></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {field("name", "Item name", { maxLength: 500 })}
            {field("source_sku_ref", "Source SKU / reference (optional)", { maxLength: 128 })}
            {field("expected_quantity", "Expected quantity", { type: "number", min: 0.001, step: line.quantity_basis === "TRANSPORT_PACKAGE" ? 1 : 0.001 })}
            <label className="space-y-1 text-xs font-medium text-foreground-secondary"><span className="block">Quantity basis</span><Select value={line.quantity_basis} onValueChange={value => update(index, "quantity_basis", value)}><SelectTrigger aria-label={`Item ${index + 1} quantity basis`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="UNIT">Ordered units</SelectItem><SelectItem value="TRANSPORT_PACKAGE">Transport packages</SelectItem></SelectContent></Select></label>
            {field("unit", "Counting unit (e.g. bottle or box)", { maxLength: 32 })}
            {field("transport_package_count", "Transport packages", { type: "number", min: 1, max: 100000, step: 1 })}
            {field("package_description", "Package description (optional)", { maxLength: 128 })}
            {field("gross_weight_kg_per_package", "Gross kg per package", { type: "number", min: 0.001, max: 50000, step: 0.001 })}
          </div>
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer items-center text-xs font-medium text-foreground focus-visible:outline-2 focus-visible:outline-primary">Transport requirements — dimensions, handling and temperature</summary>
            <div className="space-y-3 pb-2">
              <div className="grid gap-3 sm:grid-cols-3">{["length", "width", "height"].map(axis => field(`${axis}_m`, `Package ${axis} (m)`, { type: "number", min: 0.0001, max: 100, step: 0.0001 }))}</div>
            <label className="block space-y-1 text-xs font-medium text-foreground-secondary"><span className="block">Package orientation</span><Select value={line.package_can_rotate === null ? "UNKNOWN" : String(line.package_can_rotate)} onValueChange={value => update(index, "package_can_rotate", value === "UNKNOWN" ? null : value === "true")}><SelectTrigger aria-label={`Item ${index + 1} package orientation`} aria-invalid={!!errorFor("package_can_rotate")}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="UNKNOWN">Not confirmed</SelectItem><SelectItem value="true">May rotate during loading</SelectItem><SelectItem value="false">Keep orientation</SelectItem></SelectContent></Select></label>
              {errorFor("package_can_rotate") && <p role="alert" className="text-xs text-danger">{errorFor("package_can_rotate")}</p>}
              <fieldset><legend className="text-xs font-medium text-foreground-secondary">Required handling</legend><div className="flex flex-wrap gap-x-4 gap-y-1">{CARGO_HANDLING_OPTIONS.map(code => <label key={code} className="flex min-h-11 items-center gap-2 text-xs text-foreground"><input type="checkbox" checked={line.handling.includes(code)} onChange={event => update(index, "handling", event.target.checked ? [...line.handling, code] : line.handling.filter(value => value !== code))} />{code.replaceAll("_", " ").toLowerCase()}</label>)}</div></fieldset>
              <label className="block space-y-1 text-xs font-medium text-foreground-secondary"><span className="block">Temperature requirement</span><Select value={line.temperature_mode} onValueChange={value => update(index, "temperature_mode", value)}><SelectTrigger aria-label={`Item ${index + 1} temperature requirement`} aria-invalid={!!errorFor("temperature_mode")}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="UNKNOWN">Not confirmed</SelectItem><SelectItem value="NONE">No temperature control required</SelectItem><SelectItem value="REQUIRED">Temperature control required</SelectItem></SelectContent></Select></label>
              {line.temperature_mode === "REQUIRED" && <div className="grid gap-3 sm:grid-cols-2">{field("temperature_min_c", "Minimum (°C)", { type: "number", min: -80, max: 80, step: "any" })}{field("temperature_max_c", "Maximum (°C)", { type: "number", min: -80, max: 80, step: "any" })}</div>}
              {errorFor("temperature_mode") && <p role="alert" className="text-xs text-danger">{errorFor("temperature_mode")}</p>}
            </div>
          </details>
          {(errorFor("length_m") || errorFor("width_m") || errorFor("height_m") || errorFor("package_can_rotate") || errorFor("temperature_mode")) && <p className="text-xs text-danger">Open transport requirements to review missing or invalid fields.</p>}
        </li>;
      })}
    </ol>
    <p className="font-data text-sm font-semibold text-foreground" aria-live="polite">Calculated gross load: {calculatedKg == null ? "Complete package counts and weights" : `${calculatedKg} kg`}</p>
    <p className="text-xs text-foreground-secondary">This is the cargo weight requirement. Vehicle capacity is maintained by Fleet and checked against the selected vehicle.</p>
  </section>;
}
