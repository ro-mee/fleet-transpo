"use client";

import { useState } from "react";
import {
  FileText,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Contrast,
  RotateCcw,
  Truck,
  User,
  MapPin,
  Calendar,
  Fuel,
  ShieldCheck,
  Pencil,
  Loader2,
  ImageOff,
  Sparkles,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tooltip } from "@/components/ui/tooltip";
import { formatDate, formatCurrency, cn } from "@/lib/utils";
import { fuelTypeMismatch } from "@/lib/fuel/request-policy";

export function ReceiptVerificationModal({
  open,
  onOpenChange,
  record,
  onApprove,
  onReject,
  onEdit,
  onFullscreenZoom,
  isActionPending = false,
}) {
  const [zoomLevel, setZoomLevel] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [thermalFilter, setThermalFilter] = useState(false);

  const resetView = () => {
    setZoomLevel(1);
    setRotation(0);
    setThermalFilter(false);
  };

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const handleZoomIn = () => {
    setZoomLevel((prev) => Math.min(prev + 0.35, 2.5));
  };

  const handleZoomOut = () => {
    setZoomLevel((prev) => Math.max(prev - 0.35, 0.65));
  };

  if (!record) return null;

  const vehicle = record.vehicles || {};
  const driver = record.drivers || {};
  const employee = driver.employees || {};
  const driverName = employee.first_name ? `${employee.first_name} ${employee.last_name}` : "—";
  const plateNumber = vehicle.plate_number || "—";
  const vehicleName = vehicle.vehicle_name || "";
  const vehicleFuelType = vehicle.fuel_type || "Gasoline";
  const receiptFuelType = record.receipt_fuel_type || null;
  const isMismatch = fuelTypeMismatch(vehicleFuelType, receiptFuelType);

  const tankCapacity = Number(vehicle.tank_capacity_l);
  const fuelLevelPercent = Number(vehicle.fuel_level);
  const claimedLiters = Number(record.liters) || 0;
  const unitPrice = Number(record.price_per_liter) || 0;
  const totalAmount = Number(record.amount) || 0;

  const estimatedPreRefuel =
    Number.isFinite(tankCapacity) && Number.isFinite(fuelLevelPercent)
      ? (tankCapacity * fuelLevelPercent) / 100
      : null;

  const postRefuelTotal = estimatedPreRefuel != null ? estimatedPreRefuel + claimedLiters : null;
  const tankCapacityOk =
    estimatedPreRefuel == null || !Number.isFinite(claimedLiters)
      ? null
      : postRefuelTotal <= tankCapacity * 1.05;

  const calculatedTotal = claimedLiters > 0 && unitPrice > 0 ? claimedLiters * unitPrice : null;
  const mathMatches =
    calculatedTotal != null && totalAmount > 0
      ? Math.abs(calculatedTotal - totalAmount) < 2.5
      : null;

  const isPending = (record.status || "Pending").toLowerCase() === "pending";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] md:w-[860px] lg:w-[940px] p-0 overflow-hidden max-h-[92vh] flex flex-col rounded-3xl bg-surface border border-border/80 shadow-2xl">
        {/* ── MODAL HEADER ── */}
        <div className="px-6 py-4 border-b border-border/70 bg-surface/80 backdrop-blur-md flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <DialogTitle className="text-base font-bold text-foreground tracking-tight">
                  Receipt Verification
                </DialogTitle>
                <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-mono font-bold text-foreground border border-border/60">
                  Claim #{record.fuel_record_id}
                </span>
                <StatusBadge status={record.status || "Pending"} entity="fuel" className="rounded-full px-2.5 py-0.5 text-[11px] font-bold" />
              </div>
              <p className="text-xs text-foreground-muted mt-0.5">
                Refuel logged on {record.fuel_date ? formatDate(record.fuel_date) : "—"} • Vehicle {plateNumber}
              </p>
            </div>
          </div>
        </div>

        {/* ── BODY (RESPONSIVE SPLIT STUDIO) ── */}
        <div className="flex-1 overflow-y-auto p-5 md:p-6">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
            
            {/* ── LEFT: RECEIPT VIEWER STUDIO (5 cols) ── */}
            <div className="md:col-span-5 flex flex-col gap-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-primary" /> Receipt Scan
                </span>
                {record.receipt_url && (
                  <span className="text-[10px] font-mono text-foreground-muted bg-muted/60 px-2 py-0.5 rounded-md border border-border/50">
                    {Math.round(zoomLevel * 100)}% • {rotation}°
                  </span>
                )}
              </div>

              {/* Viewport Box */}
              <div className="rounded-2xl border border-border/80 bg-zinc-950 shadow-inner overflow-hidden flex flex-col">
                {/* Control toolbar */}
                {record.receipt_url && (
                  <div className="flex items-center justify-between px-2.5 py-1.5 bg-zinc-900 border-b border-zinc-800 text-zinc-300">
                    <div className="flex items-center gap-0.5">
                      <Tooltip content="Rotate 90° Clockwise">
                        <button
                          type="button"
                          onClick={handleRotate}
                          className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors cursor-pointer"
                          aria-label="Rotate 90 degrees"
                        >
                          <RotateCw className="w-3.5 h-3.5" />
                        </button>
                      </Tooltip>

                      <Tooltip content={thermalFilter ? "Disable Contrast Enhancer" : "Enhance Faded Thermal Print"}>
                        <button
                          type="button"
                          onClick={() => setThermalFilter((prev) => !prev)}
                          className={cn(
                            "p-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1 text-xs",
                            thermalFilter
                              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                              : "hover:bg-zinc-800 text-zinc-300 hover:text-white"
                          )}
                          aria-label="Toggle contrast filter"
                        >
                          <Contrast className="w-3.5 h-3.5" />
                        </button>
                      </Tooltip>

                      <div className="h-3.5 w-px bg-zinc-800 mx-1" />

                      <Tooltip content="Zoom Out">
                        <button
                          type="button"
                          onClick={handleZoomOut}
                          disabled={zoomLevel <= 0.65}
                          className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-300 hover:text-white disabled:opacity-30 transition-colors cursor-pointer"
                          aria-label="Zoom out"
                        >
                          <ZoomOut className="w-3.5 h-3.5" />
                        </button>
                      </Tooltip>

                      <Tooltip content="Zoom In">
                        <button
                          type="button"
                          onClick={handleZoomIn}
                          disabled={zoomLevel >= 2.5}
                          className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-300 hover:text-white disabled:opacity-30 transition-colors cursor-pointer"
                          aria-label="Zoom in"
                        >
                          <ZoomIn className="w-3.5 h-3.5" />
                        </button>
                      </Tooltip>

                      {(zoomLevel !== 1 || rotation !== 0 || thermalFilter) && (
                        <Tooltip content="Reset View">
                          <button
                            type="button"
                            onClick={resetView}
                            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer ml-0.5"
                            aria-label="Reset zoom and rotation"
                          >
                            <RotateCcw className="w-3 h-3" />
                          </button>
                        </Tooltip>
                      )}
                    </div>

                    <Tooltip content="Fullscreen Zoom">
                      <button
                        type="button"
                        onClick={() => onFullscreenZoom?.(record.receipt_url)}
                        className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors cursor-pointer"
                        aria-label="Open fullscreen zoom"
                      >
                        <Maximize2 className="w-3.5 h-3.5" />
                      </button>
                    </Tooltip>
                  </div>
                )}

                {/* Canvas */}
                <div className="relative min-h-[300px] max-h-[420px] aspect-[3/4] flex items-center justify-center p-3 overflow-hidden">
                  {record.receipt_url ? (
                    <div className="w-full h-full flex items-center justify-center overflow-auto">
                      <img
                        src={record.receipt_url}
                        alt="Fuel Receipt Scan"
                        className="max-h-full max-w-full object-contain transition-all duration-200 select-none shadow-xl rounded-sm"
                        style={{
                          transform: `scale(${zoomLevel}) rotate(${rotation}deg)`,
                          filter: thermalFilter
                            ? "contrast(1.85) brightness(0.92) grayscale(0.65)"
                            : "none",
                        }}
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center text-zinc-500 p-6 text-center">
                      <ImageOff className="w-8 h-8 mb-2 opacity-40" />
                      <p className="text-xs font-semibold text-zinc-400">No Receipt Photo</p>
                      <p className="text-[11px] text-zinc-600 mt-1 max-w-[180px]">
                        Logged without an attached receipt camera scan.
                      </p>
                    </div>
                  )}

                  {thermalFilter && record.receipt_url && (
                    <div className="absolute bottom-2.5 left-2.5 bg-emerald-950/85 border border-emerald-500/30 text-emerald-300 px-2 py-0.5 rounded-full text-[10px] font-semibold backdrop-blur-md flex items-center gap-1">
                      <Contrast className="w-3 h-3" /> Enhanced Thermal View
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── RIGHT: AUDIT COCKPIT (7 cols) ── */}
            <div className="md:col-span-7 space-y-3.5">
              
              {/* 1. HERO FINANCIAL METRICS */}
              <div className="rounded-2xl bg-muted/40 p-1.5 border border-border/80 shadow-2xs">
                <div className="rounded-xl bg-surface p-3 border border-border/50 space-y-2">
                  <span className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider block">
                    Claim Financials & Volume
                  </span>
                  
                  <div className="grid grid-cols-3 gap-2">
                    {/* Total Amount */}
                    <div className="p-2.5 rounded-xl bg-emerald-500/10 dark:bg-emerald-500/15 border border-emerald-500/20 text-center">
                      <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 block uppercase tracking-wider">
                        Total Claim
                      </span>
                      <span className="font-data text-base md:text-lg font-extrabold text-emerald-600 dark:text-emerald-300 block mt-0.5 whitespace-nowrap">
                        {formatCurrency(record.amount)}
                      </span>
                    </div>

                    {/* Liters */}
                    <div className="p-2.5 rounded-xl bg-muted/50 border border-border/70 text-center">
                      <span className="text-[10px] font-semibold text-foreground-muted block uppercase tracking-wider">
                        Volume
                      </span>
                      <span className="font-data text-base md:text-lg font-bold text-foreground block mt-0.5 whitespace-nowrap">
                        {claimedLiters ? `${claimedLiters.toFixed(2)} L` : "0.00 L"}
                      </span>
                    </div>

                    {/* Unit Price */}
                    <div className="p-2.5 rounded-xl bg-muted/50 border border-border/70 text-center">
                      <span className="text-[10px] font-semibold text-foreground-muted block uppercase tracking-wider">
                        Price / L
                      </span>
                      <span className="font-data text-base md:text-lg font-bold text-foreground block mt-0.5 whitespace-nowrap">
                        {unitPrice ? formatCurrency(unitPrice) : "—"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. SUBMISSION CONTEXT */}
              <div className="rounded-2xl bg-muted/40 p-1.5 border border-border/80 shadow-2xs">
                <div className="rounded-xl bg-surface p-3.5 border border-border/50 space-y-3">
                  <span className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider block">
                    Driver & Vehicle Record
                  </span>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    {/* Driver */}
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
                        <User className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-foreground-muted text-[10px] font-medium block">Driver Name</span>
                        <p className="font-bold text-foreground text-xs md:text-sm truncate">
                          {driverName}
                        </p>
                        {driver.license_number && (
                          <span className="text-[10px] font-mono text-foreground-muted block truncate">
                            Lic: {driver.license_number}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Vehicle */}
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
                        <Truck className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-foreground-muted text-[10px] font-medium block">Assigned Vehicle</span>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="inline-flex items-center rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-bold text-foreground">
                            {plateNumber}
                          </span>
                        </div>
                        {vehicleName && (
                          <p className="text-[10px] text-foreground-secondary mt-0.5 font-medium truncate">
                            {vehicleName}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs pt-2.5 border-t border-border/60">
                    {/* Station */}
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground border border-border">
                        <MapPin className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-foreground-muted text-[10px] font-medium block">Gas Station</span>
                        <p className="font-semibold text-foreground text-xs truncate">
                          {record.station_name || "Unspecified Station"}
                        </p>
                      </div>
                    </div>

                    {/* Date */}
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground border border-border">
                        <Calendar className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-foreground-muted text-[10px] font-medium block">Refuel Date</span>
                        <p className="font-semibold text-foreground text-xs truncate">
                          {record.fuel_date ? formatDate(record.fuel_date) : "—"}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. AUTOMATED SANITY CHECKS */}
              <div className="rounded-2xl bg-muted/40 p-1.5 border border-border/80 shadow-2xs">
                <div className="rounded-xl bg-surface p-3.5 border border-border/50 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-primary" /> Automated Fleet Sanity Checks
                    </span>
                    <span className="text-[10px] font-semibold text-foreground-muted">
                      System Rules
                    </span>
                  </div>

                  <div className="space-y-2">
                    {/* Check 1: Fuel Type */}
                    <div className={cn(
                      "p-2 rounded-xl border flex items-start gap-2 text-xs",
                      isMismatch
                        ? "bg-danger/10 border-danger/20 text-danger"
                        : receiptFuelType
                          ? "bg-success/10 border-success/20 text-success dark:text-emerald-400"
                          : "bg-muted/40 border-border text-foreground-secondary"
                    )}>
                      <div className="mt-0.5 shrink-0">
                        {isMismatch ? (
                          <AlertTriangle className="w-3.5 h-3.5 text-danger" />
                        ) : receiptFuelType ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-success dark:text-emerald-400" />
                        ) : (
                          <Fuel className="w-3.5 h-3.5 text-foreground-muted" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-[11px]">Fuel Type Compatibility</span>
                          <span className="text-[10px] font-semibold uppercase tracking-wider">
                            {isMismatch ? "Mismatch Alert" : receiptFuelType ? "Verified" : "Unstated"}
                          </span>
                        </div>
                        <p className="text-[11px] mt-0.5 opacity-90">
                          {receiptFuelType
                            ? isMismatch
                              ? `Receipt says ${receiptFuelType}, but vehicle requires ${vehicleFuelType}.`
                              : `Receipt says ${receiptFuelType}, matching vehicle specification (${vehicleFuelType}).`
                            : `Not stated on receipt (vehicle uses ${vehicleFuelType}).`}
                        </p>
                      </div>
                    </div>

                    {/* Check 2: Tank Capacity */}
                    <div className={cn(
                      "p-2 rounded-xl border flex items-start gap-2 text-xs",
                      tankCapacityOk === false
                        ? "bg-danger/10 border-danger/20 text-danger"
                        : tankCapacityOk === true
                          ? "bg-success/10 border-success/20 text-success dark:text-emerald-400"
                          : "bg-muted/40 border-border text-foreground-secondary"
                    )}>
                      <div className="mt-0.5 shrink-0">
                        {tankCapacityOk === false ? (
                          <AlertTriangle className="w-3.5 h-3.5 text-danger" />
                        ) : tankCapacityOk === true ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-success dark:text-emerald-400" />
                        ) : (
                          <ShieldCheck className="w-3.5 h-3.5 text-foreground-muted" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-[11px]">Tank Capacity Plausibility</span>
                          <span className="text-[10px] font-semibold uppercase tracking-wider">
                            {tankCapacityOk === false ? "Over Capacity" : tankCapacityOk === true ? "Passed" : "Unavailable"}
                          </span>
                        </div>
                        <p className="text-[11px] mt-0.5 opacity-90">
                          {tankCapacityOk == null
                            ? "Vehicle tank capacity unconfigured in registry."
                            : tankCapacityOk
                              ? `${claimedLiters.toFixed(1)} L refuel fits within ${tankCapacity} L tank (~${estimatedPreRefuel.toFixed(1)} L prior + ${claimedLiters.toFixed(1)} L = ${postRefuelTotal.toFixed(1)} L).`
                              : `Impossible fuel quantity: only about ${(tankCapacity - estimatedPreRefuel).toFixed(1)} L room remained.`}
                        </p>
                      </div>
                    </div>

                    {/* Check 3: Math */}
                    {calculatedTotal != null && (
                      <div className={cn(
                        "p-2 rounded-xl border flex items-start gap-2 text-xs",
                        mathMatches === false
                          ? "bg-warning/10 border-warning/20 text-warning-foreground dark:text-amber-400"
                          : "bg-success/10 border-success/20 text-success dark:text-emerald-400"
                      )}>
                        <div className="mt-0.5 shrink-0">
                          {mathMatches === false ? (
                            <AlertTriangle className="w-3.5 h-3.5 text-warning" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5 text-success dark:text-emerald-400" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-[11px]">Calculation Accuracy</span>
                            <span className="text-[10px] font-semibold uppercase tracking-wider">
                              {mathMatches === false ? "Variance" : "Exact Match"}
                            </span>
                          </div>
                          <p className="text-[11px] mt-0.5 opacity-90">
                            {mathMatches
                              ? `${claimedLiters.toFixed(2)} L × ${formatCurrency(unitPrice)} = ${formatCurrency(totalAmount)}.`
                              : `Calculation discrepancy: ${claimedLiters.toFixed(2)} L × ${formatCurrency(unitPrice)} = ${formatCurrency(calculatedTotal)} vs claimed ${formatCurrency(totalAmount)}.`}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 4. REJECTION NOTE */}
              {record.rejection_reason && (
                <div className="p-3 rounded-2xl bg-danger/10 border border-danger/20 text-xs text-danger space-y-1">
                  <span className="font-bold flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" /> Rejection Note:
                  </span>
                  <p className="text-foreground-secondary pl-5">{record.rejection_reason}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── DECISION ACTION BAR ── */}
        <div className="px-6 py-3.5 border-t border-border/70 bg-surface/90 backdrop-blur-md flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div>
            {onEdit && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onEdit(record)}
                className="text-xs h-9 font-medium"
              >
                <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit Record Details
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {isPending ? (
              <>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => onReject(record)}
                  disabled={isActionPending}
                  className="text-xs h-9 px-4 font-semibold shadow-xs"
                >
                  <XCircle className="w-3.5 h-3.5 mr-1.5" /> Reject Claim
                </Button>

                <Button
                  type="button"
                  onClick={() => onApprove(record)}
                  disabled={isActionPending}
                  className="text-xs h-9 px-5 font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
                >
                  {isActionPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  Approve Receipt Claim
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="text-xs h-9 px-4 font-medium"
              >
                Close Inspector
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
