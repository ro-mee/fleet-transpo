"use client";

import { useState } from "react";
import {
  RotateCw,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Contrast,
  X,
  FileText,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function FullscreenReceiptDialog({ open, onOpenChange, receiptUrl, title = "Scanned Receipt Full View" }) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [thermalFilter, setThermalFilter] = useState(false);

  const reset = () => {
    setZoom(1);
    setRotation(0);
    setThermalFilter(false);
  };

  const handleOpenChange = (isOpen) => {
    if (!isOpen) reset();
    onOpenChange(isOpen);
  };

  if (!receiptUrl) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl p-0 overflow-hidden max-h-[90vh] flex flex-col rounded-3xl bg-surface border border-border/80 shadow-2xl">
        <DialogHeader className="px-5 py-3.5 border-b border-border/70 bg-surface/80 backdrop-blur-md flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
              <FileText className="w-4 h-4" />
            </div>
            <DialogTitle className="text-sm font-bold text-foreground">
              {title}
            </DialogTitle>
          </div>

          <div className="flex items-center gap-1">
            <Tooltip content="Rotate 90°">
              <button
                type="button"
                onClick={() => setRotation((r) => (r + 90) % 360)}
                className="p-1.5 rounded-lg hover:bg-hover text-foreground-secondary hover:text-foreground transition-colors cursor-pointer"
                aria-label="Rotate 90 degrees"
              >
                <RotateCw className="w-4 h-4" />
              </button>
            </Tooltip>

            <Tooltip content="Thermal Ink Contrast Enhancer">
              <button
                type="button"
                onClick={() => setThermalFilter((f) => !f)}
                className={cn(
                  "p-1.5 rounded-lg transition-colors cursor-pointer",
                  thermalFilter
                    ? "bg-emerald-500/20 text-emerald-500 border border-emerald-500/30"
                    : "hover:bg-hover text-foreground-secondary hover:text-foreground"
                )}
                aria-label="Toggle thermal filter"
              >
                <Contrast className="w-4 h-4" />
              </button>
            </Tooltip>

            <div className="h-4 w-px bg-border mx-1" />

            <Tooltip content="Zoom Out">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(z - 0.25, 0.5))}
                disabled={zoom <= 0.5}
                className="p-1.5 rounded-lg hover:bg-hover text-foreground-secondary hover:text-foreground disabled:opacity-30 transition-colors cursor-pointer"
                aria-label="Zoom out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
            </Tooltip>

            <span className="text-xs font-mono text-foreground-muted px-1 min-w-[42px] text-center">
              {Math.round(zoom * 100)}%
            </span>

            <Tooltip content="Zoom In">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(z + 0.25, 3))}
                disabled={zoom >= 3}
                className="p-1.5 rounded-lg hover:bg-hover text-foreground-secondary hover:text-foreground disabled:opacity-30 transition-colors cursor-pointer"
                aria-label="Zoom in"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </Tooltip>

            {(zoom !== 1 || rotation !== 0 || thermalFilter) && (
              <Tooltip content="Reset View">
                <button
                  type="button"
                  onClick={reset}
                  className="p-1.5 rounded-lg hover:bg-hover text-foreground-muted hover:text-foreground transition-colors cursor-pointer ml-1"
                  aria-label="Reset zoom and rotation"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 p-4 bg-zinc-950/95 overflow-auto flex items-center justify-center min-h-[55vh] max-h-[75vh]">
          <img
            src={receiptUrl}
            alt="Full Scanned Receipt"
            className="max-h-[70vh] w-auto object-contain rounded-md shadow-2xl transition-all duration-150 select-none"
            style={{
              transform: `scale(${zoom}) rotate(${rotation}deg)`,
              filter: thermalFilter
                ? "contrast(1.85) brightness(0.92) grayscale(0.65)"
                : "none",
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
