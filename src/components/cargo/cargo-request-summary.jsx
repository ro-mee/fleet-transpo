"use client";

import { useQuery } from "@tanstack/react-query";
import { getRequestCargoManifest } from "@/services/transport.service";
import { Button } from "@/components/ui/button";

export function CargoManifestSummary({ manifest }) {
  if (!manifest?.lines?.length) return <p className="text-sm text-foreground-secondary">Contents have not been received. Physical load checks cannot be completed.</p>;
  return <div className="space-y-3">
    <p className="text-xs text-foreground-secondary">Source manifest revision {manifest.manifest_ref?.revision ?? "unavailable"} · {manifest.physical_contract_version === 1 ? "Package measurements recorded" : "Historical manifest; physical evidence unknown"}</p>
    <div className="max-h-[28rem] overflow-auto rounded-lg border border-border" tabIndex={0} aria-label="Cargo contents table">
      <table className="w-full min-w-[640px] text-left text-sm"><caption className="sr-only">Source-owned cargo contents and transport requirements</caption><thead className="bg-muted/30 text-xs"><tr>{["Contents", "Expected", "Packages", "Gross kg/package", "Requirements"].map(label => <th key={label} scope="col" className="px-3 py-2 font-medium">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-border">{manifest.lines.map(line => {
          const physical = line.physical;
          return <tr key={line.line_id} className="align-top"><th scope="row" className="max-w-64 break-words px-3 py-3 font-medium">{line.name}{line.source_sku_ref && <span className="mt-1 block text-xs font-normal text-foreground-secondary">{line.source_sku_ref}</span>}</th><td className="px-3 py-3">{line.expected_quantity} {line.unit}<span className="block text-xs text-foreground-secondary">{line.quantity_basis === "TRANSPORT_PACKAGE" ? "Transport packages" : "Ordered units"}</span></td><td className="px-3 py-3 font-data">{physical?.transport_package_count ?? "Unknown"}</td><td className="px-3 py-3 font-data">{physical?.gross_weight_kg_per_package ?? "Unknown"}</td><td className="max-w-72 space-y-1 px-3 py-3 text-xs text-foreground-secondary">{physical?.dimensions_m && <p>{physical.dimensions_m.length} × {physical.dimensions_m.width} × {physical.dimensions_m.height} m · {physical.package_can_rotate ? "Rotation allowed" : "Keep orientation"}</p>}<p>{line.handling?.length ? line.handling.map(code => code.replaceAll("_", " ").toLowerCase()).join(", ") : manifest.physical_contract_version === 1 ? "No special handling declared" : "Handling unknown"}</p><p>{physical?.temperature_c ? `${physical.temperature_c.min_c} to ${physical.temperature_c.max_c} °C` : physical && physical.temperature_c === null ? "No temperature control required" : "Temperature requirement unknown"}</p></td></tr>;
        })}</tbody>
      </table>
    </div>
  </div>;
}

export function CargoRequestSummary({ requestId }) {
  const query = useQuery({ queryKey: ["request-cargo-manifest", requestId], queryFn: () => getRequestCargoManifest(requestId), enabled: !!requestId, staleTime: 30000 });
  const view = query.data?.data ?? query.data;
  if (query.isLoading) return <p role="status" className="text-sm text-foreground-secondary">Loading source cargo contents…</p>;
  if (query.isError) return <div className="space-y-2"><p role="alert" className="text-sm text-foreground-secondary">Cargo contents are unavailable. Physical load checks cannot be completed.</p><Button type="button" variant="outline" size="sm" onClick={() => query.refetch()}>Retry contents</Button></div>;
  return <CargoManifestSummary manifest={view?.manifest} />;
}
