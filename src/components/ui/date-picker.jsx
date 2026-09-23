"use client";

import * as React from "react";
import { format, addMonths, subMonths, setMonth, setYear, getDaysInMonth, startOfMonth, getDay } from "date-fns";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X, ChevronDown, Check, AlertCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { legalAgeCutoff } from "@/lib/validation/age";
import { cn } from "@/lib/utils";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export function CalendarHeaderSelect({
  value,
  onChange,
  options,
  className,
  menuClassName,
  disabledValues,
}) {
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef(null);
  const selectedRef = React.useRef(null);

  // Close on outside click or Escape
  React.useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  // Auto-scroll to selected option when opened
  React.useEffect(() => {
    if (isOpen && selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [isOpen]);

  const currentOption = options.find((opt) => opt.value === value) || options[0];

  return (
    <div ref={containerRef} className={cn("relative inline-block", className)}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={cn(
          "flex items-center justify-between gap-1 rounded-xl px-2 py-1 text-xs font-bold transition-all cursor-pointer select-none",
          "border border-border/80 bg-hover text-foreground hover:border-primary/40 hover:bg-hover/80",
          "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary",
          isOpen && "ring-2 ring-primary/20 border-primary bg-surface shadow-xs"
        )}
      >
        <span className="truncate">{currentOption?.label}</span>
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 text-foreground-muted shrink-0 transition-transform duration-200",
            isOpen && "rotate-180 text-primary"
          )}
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          className={cn(
            "absolute left-0 top-full mt-1.5 z-50 min-w-[110px] max-h-56 overflow-y-auto p-1 rounded-2xl",
            "border border-border/80 bg-surface/95 backdrop-blur-md text-foreground shadow-2xl custom-scrollbar",
            "animate-in fade-in-0 zoom-in-95",
            menuClassName
          )}
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            const isDisabled = disabledValues?.includes(opt.value) ?? false;
            return (
              <button
                key={opt.value}
                ref={isSelected ? selectedRef : null}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={isDisabled}
                aria-disabled={isDisabled}
                onClick={() => {
                  if (isDisabled) return;
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between px-2.5 py-1.5 rounded-xl text-xs font-semibold text-left transition-colors select-none",
                  isDisabled
                    ? "text-foreground-muted/40 cursor-not-allowed"
                    : isSelected
                    ? "bg-primary/10 text-primary font-bold cursor-pointer"
                    : "text-foreground hover:bg-hover hover:text-primary focus:bg-hover focus:text-primary outline-hidden cursor-pointer"
                )}
              >
                <span>{opt.label}</span>
                {isSelected && (
                  <Check className="w-3.5 h-3.5 text-primary stroke-[2.5] shrink-0 ml-1.5" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function DatePicker({
  value,
  onChange,
  label = "Date",
  placeholder = "Select Date...",
  id,
  disabled = false,
  disablePast = false,
  minDate = null,
  maxDate = null,
  minAge = null,
  maxAge = null,
  error,
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

  // Legal-age floor. When `minAge` is set, the newest selectable date is the day
  // the person would turn `minAge` — so an underage year can never be picked, and
  // the calendar opens on that boundary year rather than on today (which, for a
  // birthdate, is always out of range). Resolved once per mount: a form is never
  // left open across a birthday boundary in any meaningful sense.
  const legalAgeBoundary = React.useMemo(
    () => (minAge == null ? null : legalAgeCutoff(minAge)),
    [minAge]
  );

  const [selectedDate, setSelectedDate] = React.useState(parsedDate);
  const [viewDate, setViewDate] = React.useState(
    parsedDate || legalAgeBoundary || new Date()
  );

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

  // Optional range bounds (YYYY-MM-DD): days outside [minDate, maxDate] are
  // unselectable — lets callers couple From/To so an inverted range can
  // never reach the API.
  const minDay = React.useMemo(() => {
    if (!minDate) return null;
    const d = new Date(`${minDate}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }, [minDate]);
  const maxDay = React.useMemo(() => {
    if (!maxDate) return null;
    const d = new Date(`${maxDate}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }, [maxDate]);
  const isOutsideRange = (dateObj) =>
    (minDay && dateObj < minDay) ||
    (maxDay && dateObj > maxDay) ||
    (legalAgeBoundary && dateObj > legalAgeBoundary);

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

  // Navigation handlers. Forward navigation stops at the legal-age boundary so the
  // calendar can't be walked into a month where every single day is unselectable.
  const handlePrevMonth = () => setViewDate((prev) => subMonths(prev, 1));
  const handleNextMonth = () =>
    setViewDate((prev) => {
      const next = addMonths(prev, 1);
      if (legalAgeBoundary && startOfMonth(next) > legalAgeBoundary) return prev;
      return next;
    });

  const handleMonthChange = (monthIdx) => {
    setViewDate((prev) => setMonth(prev, monthIdx));
  };

  const handleYearChange = (yearNum) => {
    setViewDate((prev) => setYear(prev, yearNum));
  };

  const handleSelectDay = (dayNum) => {
    const candidate = new Date(viewDate.getFullYear(), viewDate.getMonth(), dayNum);
    if (disablePast) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      if (candidate < todayStart) return;
    }
    if (isOutsideRange(candidate)) return;
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
  // Broad year range (e.g. 1946 to 2041) for driver birthdates and future renewals.
  // With `minAge` the top end is pulled back to the legal-age boundary year, so the
  // list itself never offers a year the person could not legally have been born in.
  const oldestYear = currentYear - (maxAge ?? 80);
  const newestYear = legalAgeBoundary ? legalAgeBoundary.getFullYear() : currentYear + 15;
  const yearOptions = React.useMemo(
    () => Array.from({ length: newestYear - oldestYear + 1 }, (_, i) => oldestYear + i),
    [oldestYear, newestYear]
  );
  const monthOptions = React.useMemo(
    () => MONTHS.map((m, idx) => ({ value: idx, label: m })),
    []
  );

  // Months that fall entirely past the legal-age boundary, so they can't be
  // navigated into from the boundary year.
  const disabledMonths = React.useMemo(() => {
    if (!legalAgeBoundary || viewDate.getFullYear() !== legalAgeBoundary.getFullYear()) {
      return [];
    }
    return monthOptions
      .filter((m) => m.value > legalAgeBoundary.getMonth())
      .map((m) => m.value);
  }, [legalAgeBoundary, viewDate, monthOptions]);

  const formattedDateString = selectedDate ? format(selectedDate, "MMM dd, yyyy") : "";

  return (
    <Popover open={open} onOpenChange={setOpen}>
    <div className="relative select-none group">
      {/* Real <button> trigger: keyboard-focusable, Enter/Space activatable.
          Radix supplies aria-haspopup/aria-expanded via asChild prop merging.
          Consumer `className` lands on the button (the visual box) so layout
          tweaks like min-h/py keep behaving as they did on the old div. */}
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          id={id}
          disabled={disabled}
          className={cn(
            "flex w-full items-center justify-between rounded-2xl p-[5px] text-left transition-all cursor-pointer",
            "bg-gradient-to-b from-border/70 to-border/30 ring-1 hover:ring-primary/50",
            error ? "ring-danger/60" : selectedDate ? "ring-primary/60" : "ring-border/70",
            open && !error && "ring-primary",
            "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            disabled && "opacity-50 cursor-not-allowed",
            className
          )}
        >
          <div className="relative flex w-full items-center justify-between bg-surface px-4 py-2 rounded-[11px] min-h-[42px] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
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

            {/* Calendar Icon Badge (clear lives as an overlay sibling below,
                so we never nest a button inside this one) */}
            <div className="p-1 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-white dark:group-hover:text-slate-950 transition-colors">
              <CalendarIcon className="w-4 h-4" />
            </div>
          </div>
        </button>
      </PopoverTrigger>

      {/* Clear action as a sibling overlay — keyboard-reachable after the
          trigger in tab order, positioned where the inline icon used to sit. */}
      {selectedDate && !disabled && (
        <button
          type="button"
          onClick={handleClear}
          title="Clear date"
          aria-label="Clear date"
          className="absolute right-[49px] top-1/2 -translate-y-1/2 z-20 rounded-lg p-1 text-foreground-muted hover:bg-danger/10 hover:text-danger transition-colors cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-danger"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>

    {error && (
      <p className="text-xs text-danger font-medium mt-1 px-1 flex items-center gap-1">
        <AlertCircle className="w-3 h-3 shrink-0" /> {error}
      </p>
    )}

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
              <CalendarHeaderSelect
                value={viewDate.getMonth()}
                onChange={handleMonthChange}
                options={monthOptions}
                disabledValues={disabledMonths}
                className="w-auto"
                menuClassName="min-w-[125px]"
              />

              <CalendarHeaderSelect
                value={viewDate.getFullYear()}
                onChange={handleYearChange}
                options={yearOptions.map((y) => ({ value: y, label: y.toString() }))}
                className="w-auto"
                menuClassName="min-w-[85px]"
              />
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

              // Past-date / out-of-range check
              const dayDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), d);
              const todayMidnight = new Date();
              todayMidnight.setHours(0, 0, 0, 0);
              const isPast = (disablePast && dayDate < todayMidnight) || isOutsideRange(dayDate);

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
            {/* "Today" is meaningless once a legal-age floor is set — today is
                always an invalid birthdate — so the shortcut is withheld. */}
            {!legalAgeBoundary && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleToday}
                className="h-7 text-xs font-semibold px-3 rounded-xl bg-primary/10 text-primary hover:bg-primary/20"
              >
                Today
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
