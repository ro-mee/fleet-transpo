import React from "react";
import { normalizeQuantity } from "@/lib/cargo/quantities";

const receiptLines = (receipt) => {
  const lines = receipt?.payload?.lines ?? receipt?.lines ?? [];
  return Array.isArray(lines) ? new Map(lines.map((line) => [line.line_id, line])) : new Map();
};

function difference(left, right, basis) {
  if (left == null || right == null) return null;
  try {
    const scaled = (value) => {
      const normalized = normalizeQuantity(String(value), { basis: basis === "TRANSPORT_PACKAGE" ? basis : "UNIT" });
      const [whole, fraction = ""] = normalized.split(".");
      return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
    };
    const result = scaled(left) - scaled(right);
    if (result <= 0n) return "0";
    const whole = result / 1000n;
    const fraction = String(result % 1000n).padStart(3, "0").replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : String(whole);
  } catch {
    return null;
  }
}

function Quantity({ value }) {
  return value == null ? <span className="text-foreground-muted">—</span> : <span className="font-data tabular-nums">{value}</span>;
}

export function CargoQuantityTable({ manifest, pickup, delivery }) {
  const pickupByLine = receiptLines(pickup);
  const deliveryByLine = receiptLines(delivery);
  const lines = Array.isArray(manifest?.lines) ? manifest.lines : [];

  if (!lines.length) {
    return (
      <p className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm text-foreground-secondary">
        The cargo manifest is not available, so item quantities cannot be compared.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[760px] border-collapse text-left text-sm">
        <caption className="sr-only">Expected, picked-up, and delivered cargo quantities</caption>
        <thead className="bg-muted/30 text-xs text-foreground-secondary">
          <tr>
            <th scope="col" className="px-3 py-2.5 font-semibold">Item</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Expected</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Picked up</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Delivered</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Order shortage</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Delivery shortage</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Unit</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {lines.map((line) => {
            const picked = pickupByLine.get(line.line_id)?.observed_quantity ?? null;
            const delivered = deliveryByLine.get(line.line_id)?.observed_quantity ?? null;
            const orderShortage = difference(line.expected_quantity, picked, line.quantity_basis);
            const deliveryShortage = difference(picked, delivered, line.quantity_basis);
            return (
              <tr key={line.line_id} className="align-top">
                <th scope="row" className="max-w-[300px] px-3 py-2.5 font-medium text-foreground break-words">
                  {line.name || "Unnamed item"}
                  {line.physical && <div className="mt-2 space-y-1 text-xs font-normal text-foreground-secondary">
                    <p className="font-data">{line.physical.transport_package_count ?? "Count unavailable"} packages{line.physical.package_description ? ` (${line.physical.package_description})` : ""} · {line.physical.gross_weight_kg_per_package ?? "Weight unavailable"} kg/package</p>
                    <p className="font-data">Package: {line.physical.dimensions_m ? `${line.physical.dimensions_m.length} × ${line.physical.dimensions_m.width} × ${line.physical.dimensions_m.height} m` : "dimensions unavailable"}</p>
                    <p>Rotation: {line.physical.package_can_rotate === true ? "permitted" : line.physical.package_can_rotate === false ? "not permitted" : "not recorded"}</p>
                    <p className="font-data">Temperature: {line.physical.temperature_c ? `${line.physical.temperature_c.min_c} to ${line.physical.temperature_c.max_c} °C` : line.physical.temperature_c === null ? "no requirement declared" : "not recorded"}</p>
                    {!!line.handling?.length && <p>Handling: {line.handling.map(code => code.replaceAll("_", " ").toLowerCase()).join(", ")}</p>}
                  </div>}
                </th>
                <td className="px-3 py-2.5"><Quantity value={line.expected_quantity ?? null} /></td>
                <td className="px-3 py-2.5"><Quantity value={picked} /></td>
                <td className="px-3 py-2.5"><Quantity value={delivered} /></td>
                <td className="px-3 py-2.5"><Quantity value={orderShortage} /></td>
                <td className="px-3 py-2.5"><Quantity value={deliveryShortage} /></td>
                <td className="px-3 py-2.5 text-foreground-secondary">{line.unit || "Unit unavailable"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-border bg-muted/10 px-3 py-2 text-[11px] text-foreground-muted">
        Order shortage compares the pickup count with the original request. Delivery shortage compares the delivery count with the pickup count.
      </p>
    </div>
  );
}
