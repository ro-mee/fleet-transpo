"use client";

import * as React from "react";
import { Clock, ChevronUp, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Helper to format string time (HH:mm) to AM/PM object
function parseTimeString(timeStr) {
  if (!timeStr) return { hour: 9, minute: 0, period: "AM" };
  const [h, m] = timeStr.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return { hour: 9, minute: 0, period: "AM" };
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return { hour, minute: m, period };
}

// Helper to construct 24H string (HH:mm) from state
function formatTimeString(hour, minute, period) {
  let h = hour % 12;
  if (period === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function TimePicker({
  value,
  onChange,
  disabled = false,
  className,
}) {
  const [open, setOpen] = React.useState(false);

  // Derive state from value prop (which is a string like "09:00" or "14:30")
  const { hour: initialH, minute: initialM, period: initialP } = React.useMemo(() => parseTimeString(value), [value]);

  const [hour, setHour] = React.useState(initialH);
  const [minute, setMinute] = React.useState(initialM);
  const [period, setPeriod] = React.useState(initialP);

  // Sync back to internal state if value prop changes
  React.useEffect(() => {
    // Deferred one tick: external-value sync without sync setState in the effect body.
    const t = setTimeout(() => {
      const { hour: h, minute: m, period: p } = parseTimeString(value);
      setHour(h);
      setMinute(m);
      setPeriod(p);
    }, 0);
    return () => clearTimeout(t);
  }, [value]);

  const commitTime = (hVal, mVal, pVal) => {
    setHour(hVal);
    setMinute(mVal);
    setPeriod(pVal);
    onChange?.(formatTimeString(hVal, mVal, pVal));
  };

  const incrementHour = () => {
    const nextH = hour === 12 ? 1 : hour + 1;
    commitTime(nextH, minute, period);
  };
  const decrementHour = () => {
    const nextH = hour === 1 ? 12 : hour - 1;
    commitTime(nextH, minute, period);
  };

  const incrementMinute = () => {
    const nextM = (minute + 5) % 60;
    commitTime(hour, nextM, period);
  };
  const decrementMinute = () => {
    const nextM = (minute - 5 + 60) % 60;
    commitTime(hour, nextM, period);
  };

  const togglePeriod = () => {
    const nextP = period === "AM" ? "PM" : "AM";
    commitTime(hour, minute, nextP);
  };

  const handleHourChange = (e) => {
    const raw = e.target.value.replace(/\D/g, "");
    if (raw === "") return;
    let val = parseInt(raw, 10);
    if (val > 12) val = 12;
    if (val >= 1 && val <= 12) commitTime(val, minute, period);
  };

  const handleMinuteChange = (e) => {
    const raw = e.target.value.replace(/\D/g, "");
    if (raw === "") return;
    let val = parseInt(raw, 10);
    if (val > 59) val = 59;
    if (val >= 0 && val <= 59) commitTime(hour, val, period);
  };

  const displayString = value ? `${String(initialH).padStart(2, "0")}:${String(initialM).padStart(2, "0")} ${initialP}` : "--:--";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <div
          className={cn(
            "relative flex items-center justify-between border border-border/80 bg-surface hover:bg-hover px-3 py-2 rounded-xl cursor-pointer transition-all select-none group h-10 w-full",
            disabled && "opacity-50 cursor-not-allowed",
            className
          )}
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span>{displayString}</span>
          </div>
          <Clock className="w-4 h-4 text-primary/70 shrink-0 group-hover:text-primary transition-colors" />
        </div>
      </PopoverTrigger>

      <PopoverContent align="center" className="w-auto p-4 rounded-3xl border border-border/80 shadow-lg bg-surface z-[100]">
        <div className="flex flex-col space-y-4">
          <div className="grid grid-cols-3 gap-3 text-center items-center">
            {/* Hour */}
            <div className="flex flex-col items-center space-y-1">
              <span className="text-[11px] font-semibold text-foreground-muted uppercase">Hour</span>
              <Button type="button" variant="ghost" size="icon" onClick={incrementHour} className="h-8 w-8 rounded-xl hover:bg-primary/10 text-foreground-secondary hover:text-primary">
                <ChevronUp className="w-5 h-5" />
              </Button>
              <input
                type="text"
                inputMode="numeric"
                value={String(hour).padStart(2, "0")}
                onChange={handleHourChange}
                className="w-14 h-10 rounded-xl border border-border bg-background text-center text-sm font-extrabold text-foreground shadow-xs focus:outline-hidden focus:ring-2 focus:ring-primary/50"
              />
              <Button type="button" variant="ghost" size="icon" onClick={decrementHour} className="h-8 w-8 rounded-xl hover:bg-primary/10 text-foreground-secondary hover:text-primary">
                <ChevronDown className="w-5 h-5" />
              </Button>
            </div>

            {/* Minute */}
            <div className="flex flex-col items-center space-y-1">
              <span className="text-[11px] font-semibold text-foreground-muted uppercase">Min</span>
              <Button type="button" variant="ghost" size="icon" onClick={incrementMinute} className="h-8 w-8 rounded-xl hover:bg-primary/10 text-foreground-secondary hover:text-primary">
                <ChevronUp className="w-5 h-5" />
              </Button>
              <input
                type="text"
                inputMode="numeric"
                value={String(minute).padStart(2, "0")}
                onChange={handleMinuteChange}
                className="w-14 h-10 rounded-xl border border-border bg-background text-center text-sm font-extrabold text-foreground shadow-xs focus:outline-hidden focus:ring-2 focus:ring-primary/50"
              />
              <Button type="button" variant="ghost" size="icon" onClick={decrementMinute} className="h-8 w-8 rounded-xl hover:bg-primary/10 text-foreground-secondary hover:text-primary">
                <ChevronDown className="w-5 h-5" />
              </Button>
            </div>

            {/* AM/PM */}
            <div className="flex flex-col items-center space-y-1">
              <span className="text-[11px] font-semibold text-foreground-muted uppercase">AM/PM</span>
              <Button type="button" variant="ghost" size="icon" onClick={togglePeriod} className="h-8 w-8 rounded-xl hover:bg-primary/10 text-foreground-secondary hover:text-primary">
                <ChevronUp className="w-5 h-5" />
              </Button>
              <button
                type="button"
                onClick={togglePeriod}
                className="w-14 h-10 rounded-xl border border-border bg-background flex items-center justify-center text-sm font-extrabold text-primary shadow-xs cursor-pointer hover:bg-primary/10 transition-colors"
              >
                {period}
              </button>
              <Button type="button" variant="ghost" size="icon" onClick={togglePeriod} className="h-8 w-8 rounded-xl hover:bg-primary/10 text-foreground-secondary hover:text-primary">
                <ChevronDown className="w-5 h-5" />
              </Button>
            </div>
          </div>
          
          <Button
            type="button"
            onClick={() => setOpen(false)}
            className="w-full rounded-xl bg-primary text-surface hover:bg-primary/90 font-bold text-xs h-9 shadow-sm"
          >
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
