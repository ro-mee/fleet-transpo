"use client";

import * as React from "react";
import { format, addMonths, subMonths, setMonth, setYear, getDaysInMonth, startOfMonth, getDay } from "date-fns";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export function DatePicker({
  value,
  onChange,
  label = "Date",
  placeholder = "Select Date...",
  id,
  disabled = false,
  disablePast = false,
  className,
}) {
  const [open, setOpen] = React.useState(false);

  // Parse value prop safely (YYYY-MM-DD or ISO string)
  const parsedDate = React.useMemo(() => {
    if (!value) return null;
    // Append T00:00:00 to force local time parsing for date-only strings
    const str = String(value).includes("T") ? value : `${value}T00:00:00`;
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }, [value]);

  const [selectedDate, setSelectedDate] = React.useState(parsedDate);
  const [viewDate, setViewDate] = React.useState(parsedDate || new Date());

  // Keep internal state in sync with external value changes
  React.useEffect(() => {
    // Deferred one tick: external-value sync without sync setState in the effect body.
    const t = setTimeout(() => {
      if (!value) {
        setSelectedDate(null);
        return;
      }
      const str = String(value).includes("T") ? value : `${value}T00:00:00`;
      const d = new Date(str);
      if (!isNaN(d.getTime())) {
        setSelectedDate(d);
        setViewDate(d);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [value]);

  const commitDate = (dateObj) => {
    if (!dateObj) {
      setSelectedDate(null);
      onChange?.("");
      return;
    }
    const yearStr = dateObj.getFullYear();
    const monthStr = String(dateObj.getMonth() + 1).padStart(2, "0");
    const dayStr = String(dateObj.getDate()).padStart(2, "0");
    const formattedYmd = `${yearStr}-${monthStr}-${dayStr}`;

    setSelectedDate(dateObj);
    onChange?.(formattedYmd);
  };

  // Navigation handlers
  const handlePrevMonth = () => setViewDate((prev) => subMonths(prev, 1));
  const handleNextMonth = () => setViewDate((prev) => addMonths(prev, 1));

  const handleMonthChange = (e) => {
    setViewDate((prev) => setMonth(prev, parseInt(e.target.value, 10)));
  };

  const handleYearChange = (e) => {
    setViewDate((prev) => setYear(prev, parseInt(e.target.value, 10)));
  };

  const handleSelectDay = (dayNum) => {
    const candidate = new Date(viewDate.getFullYear(), viewDate.getMonth(), dayNum);
    if (disablePast) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      if (candidate < todayStart) return;
    }
    commitDate(candidate);
    setOpen(false);
  };

  const handleToday = () => {
    const today = new Date();
    setViewDate(today);
    commitDate(today);
    setOpen(false);
  };

  const handleClear = (e) => {
    e.stopPropagation();
    commitDate(null);
  };

  // Calendar calculations
  const daysInCurrentMonth = getDaysInMonth(viewDate);
  const firstDayOfWeek = getDay(startOfMonth(viewDate));

  const prevMonthDate = subMonths(viewDate, 1);
  const daysInPrevMonth = getDaysInMonth(prevMonthDate);

  const prevMonthDays = Array.from(
    { length: firstDayOfWeek },
    (_, i) => daysInPrevMonth - firstDayOfWeek + i + 1
  );

  const currentMonthDays = Array.from(
    { length: daysInCurrentMonth },
    (_, i) => i + 1
  );

  const totalGridCells = prevMonthDays.length + currentMonthDays.length;
  const nextMonthDaysCount = (7 - (totalGridCells % 7)) % 7;
  const nextMonthDays = Array.from({ length: nextMonthDaysCount }, (_, i) => i + 1);

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 40 }, (_, i) => currentYear - 30 + i);

  const formattedDateString = selectedDate ? format(selectedDate, "MMM dd, yyyy") : "";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <div
          id={id}
          className={cn(
            "relative rounded-2xl p-[5px] transition-all select-none group cursor-pointer",
            "bg-gradient-to-b from-border/70 to-border/30 ring-1 ring-border/70 hover:ring-primary/50",
            selectedDate ? "ring-primary/60" : "",
            disabled && "opacity-50 cursor-not-allowed",
            className
          )}
        >
          <div className="relative flex items-center justify-between bg-surface px-4 py-2 rounded-[11px] min-h-[42px] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            {/* Floating Top Pill Label */}
            <div className="-top-2.5 left-4 absolute bg-surface border border-primary/30 px-2.5 py-0.5 rounded-full text-[11px] font-bold text-primary flex items-center gap-1.5 z-10">
              <CalendarIcon className="w-3.5 h-3.5 text-primary shrink-0" />
              <span>{label}</span>
            </div>

            {/* Value Display or Placeholder */}
            {selectedDate ? (
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground pt-0.5">
                <span>{formattedDateString}</span>
              </div>
            ) : (
              <div className="text-sm font-medium text-foreground-muted pt-0.5">
                {placeholder}
              </div>
            )}

            {/* Right Action Button (Clear or Calendar Icon) */}
            <div className="flex items-center gap-1">
              {selectedDate && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="p-1 rounded-lg hover:bg-danger/10 text-foreground-muted hover:text-danger transition-colors cursor-pointer"
                  title="Clear date"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <div className="p-1 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-white transition-colors">
                <CalendarIcon className="w-4 h-4" />
              </div>
            </div>
          </div>
        </div>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[260px] p-3.5 rounded-3xl border border-border/80 shadow-lg bg-surface">
        <div className="space-y-3">
          {/* Month / Year Header */}
          <div className="flex items-center justify-between gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handlePrevMonth}
              className="h-8 w-8 rounded-xl hover:bg-hover text-foreground-secondary"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>

            <div className="flex items-center gap-1.5">
              <select
                value={viewDate.getMonth()}
                onChange={handleMonthChange}
                className="bg-hover border border-border/80 text-foreground text-xs font-bold rounded-xl px-2 py-1 cursor-pointer focus:outline-hidden"
              >
                {MONTHS.map((m, idx) => (
                  <option key={m} value={idx} className="bg-surface text-foreground">
                    {m}
                  </option>
                ))}
              </select>

              <select
                value={viewDate.getFullYear()}
                onChange={handleYearChange}
                className="bg-hover border border-border/80 text-foreground text-xs font-bold rounded-xl px-2 py-1 cursor-pointer focus:outline-hidden"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y} className="bg-surface text-foreground">
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleNextMonth}
              className="h-8 w-8 rounded-xl hover:bg-hover text-foreground-secondary"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>

          {/* Weekday Headers */}
          <div className="grid grid-cols-7 text-center text-[11px] font-bold text-foreground-muted">
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
              <div key={day} className="py-1">
                {day}
              </div>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1 text-center text-xs">
            {prevMonthDays.map((d, i) => (
              <div key={`prev-${i}`} className="py-1.5 text-foreground-muted/30 font-medium">
                {d}
              </div>
            ))}

            {currentMonthDays.map((d) => {
              const isSelected =
                selectedDate &&
                selectedDate.getDate() === d &&
                selectedDate.getMonth() === viewDate.getMonth() &&
                selectedDate.getFullYear() === viewDate.getFullYear();

              const isToday =
                new Date().getDate() === d &&
                new Date().getMonth() === viewDate.getMonth() &&
                new Date().getFullYear() === viewDate.getFullYear();

              // Past-date check
              const dayDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), d);
              const todayMidnight = new Date();
              todayMidnight.setHours(0, 0, 0, 0);
              const isPast = disablePast && dayDate < todayMidnight;

              return (
                <button
                  key={`curr-${d}`}
                  type="button"
                  onClick={() => handleSelectDay(d)}
                  disabled={isPast}
                  className={cn(
                    "h-8 w-8 rounded-xl flex items-center justify-center font-bold transition-all mx-auto",
                    isPast
                      ? "text-foreground-muted/30 cursor-not-allowed"
                      : isSelected
                      ? "bg-primary text-white dark:text-slate-950 scale-105 cursor-pointer"
                      : isToday
                      ? "border border-primary text-primary hover:bg-primary/10 cursor-pointer"
                      : "text-foreground hover:bg-hover hover:text-primary cursor-pointer"
                  )}
                >
                  {d}
                </button>
              );
            })}

            {nextMonthDays.map((d, i) => (
              <div key={`next-${i}`} className="py-1.5 text-foreground-muted/30 font-medium">
                {d}
              </div>
            ))}
          </div>

          {/* Quick Action Footer */}
          <div className="flex items-center justify-between pt-2 border-t border-border/60">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => commitDate(null)}
              className="h-7 text-xs text-foreground-secondary hover:text-danger px-2 rounded-lg"
            >
              Clear
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleToday}
              className="h-7 text-xs font-semibold px-3 rounded-xl bg-primary/10 text-primary hover:bg-primary/20"
            >
              Today
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
