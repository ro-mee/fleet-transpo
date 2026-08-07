"use client";

import * as React from "react";
import { format, addMonths, subMonths, setMonth, setYear, getDaysInMonth, startOfMonth, getDay } from "date-fns";
import { Calendar as CalendarIcon, Clock, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, CalendarClock } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export function DateTimePicker({
  value,
  onChange,
  label = "Date & Time",
  placeholder = "Select Date & Time...",
  id,
  disabled = false,
  className,
}) {
  const [open, setOpen] = React.useState(false);

  // Parse value prop safely (null if unselected)
  const parsedValue = React.useMemo(() => {
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }, [value]);

  const [selectedDate, setSelectedDate] = React.useState(parsedValue);
  const [viewDate, setViewDate] = React.useState(parsedValue || new Date());

  // Time state (12-hour format)
  const [hour, setHour] = React.useState(() => {
    if (!parsedValue) return 9;
    const h = parsedValue.getHours() % 12;
    return h === 0 ? 12 : h;
  });
  const [minute, setMinute] = React.useState(() => (parsedValue ? parsedValue.getMinutes() : 0));
  const [period, setPeriod] = React.useState(() => (parsedValue ? (parsedValue.getHours() >= 12 ? "PM" : "AM") : "AM"));

  // Keep internal state synced when value prop changes externally
  React.useEffect(() => {
    if (!value) {
      setSelectedDate(null);
      return;
    }
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      setSelectedDate(d);
      setViewDate(d);
      const h = d.getHours() % 12;
      setHour(h === 0 ? 12 : h);
      setMinute(d.getMinutes());
      setPeriod(d.getHours() >= 12 ? "PM" : "AM");
    }
  }, [value]);

  // Helper to commit datetime state & fire onChange
  const commitDateTime = (dateObj, hVal, mVal, pVal) => {
    const baseDate = dateObj || selectedDate || viewDate || new Date();
    let hours = hVal % 12;
    if (pVal === "PM") hours += 12;
    
    const next = new Date(
      baseDate.getFullYear(),
      baseDate.getMonth(),
      baseDate.getDate(),
      hours,
      mVal
    );

    // Format as YYYY-MM-DDTHH:mm
    const yearStr = next.getFullYear();
    const monthStr = String(next.getMonth() + 1).padStart(2, "0");
    const dayStr = String(next.getDate()).padStart(2, "0");
    const hourStr = String(next.getHours()).padStart(2, "0");
    const minStr = String(next.getMinutes()).padStart(2, "0");
    const formattedIso = `${yearStr}-${monthStr}-${dayStr}T${hourStr}:${minStr}`;

    setSelectedDate(next);
    onChange?.(formattedIso);
  };

  // Calendar Controls
  const handlePrevMonth = () => setViewDate((prev) => subMonths(prev, 1));
  const handleNextMonth = () => setViewDate((prev) => addMonths(prev, 1));

  const handleMonthChange = (e) => {
    setViewDate((prev) => setMonth(prev, parseInt(e.target.value, 10)));
  };

  const handleYearChange = (e) => {
    setViewDate((prev) => setYear(prev, parseInt(e.target.value, 10)));
  };

  const handleSelectDay = (dayNum) => {
    const newSelected = new Date(viewDate.getFullYear(), viewDate.getMonth(), dayNum);
    commitDateTime(newSelected, hour, minute, period);
  };

  // Time Steppers
  const incrementHour = () => {
    const nextH = hour === 12 ? 1 : hour + 1;
    setHour(nextH);
    commitDateTime(selectedDate, nextH, minute, period);
  };
  const decrementHour = () => {
    const nextH = hour === 1 ? 12 : hour - 1;
    setHour(nextH);
    commitDateTime(selectedDate, nextH, minute, period);
  };

  const incrementMinute = () => {
    const nextM = (minute + 5) % 60;
    setMinute(nextM);
    commitDateTime(selectedDate, hour, nextM, period);
  };
  const decrementMinute = () => {
    const nextM = (minute - 5 + 60) % 60;
    setMinute(nextM);
    commitDateTime(selectedDate, hour, nextM, period);
  };

  const togglePeriod = () => {
    const nextP = period === "AM" ? "PM" : "AM";
    setPeriod(nextP);
    commitDateTime(selectedDate, hour, minute, nextP);
  };

  // Quick Action Buttons
  const handleToday = () => {
    const today = new Date();
    setViewDate(today);
    commitDateTime(today, hour, minute, period);
  };

  const handleNow = () => {
    const now = new Date();
    setViewDate(now);
    const h = now.getHours() % 12;
    const currentH = h === 0 ? 12 : h;
    const currentM = now.getMinutes();
    const currentP = now.getHours() >= 12 ? "PM" : "AM";
    setHour(currentH);
    setMinute(currentM);
    setPeriod(currentP);
    commitDateTime(now, currentH, currentM, currentP);
  };

  // Days Grid Generation
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

  // Year options list
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 15 }, (_, i) => currentYear - 2 + i);

  const formattedDateString = selectedDate ? format(selectedDate, "MMM dd, yyyy") : "";
  const formattedTimeString = `${String(hour).padStart(2, "0")} : ${String(minute).padStart(2, "0")} ${period}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <div
          id={id}
          className={cn(
            "relative flex items-center justify-between border border-border/80 bg-surface hover:bg-hover px-4 py-2 rounded-2xl cursor-pointer transition-all select-none group min-h-[46px]",
            selectedDate ? "border-primary/40 hover:border-primary" : "border-border hover:border-primary/50",
            disabled && "opacity-50 cursor-not-allowed",
            className
          )}
        >
          {/* Floating Pill Label */}
          <div className="-top-2.5 left-3.5 absolute bg-surface border border-primary/30 px-2.5 py-0.5 rounded-full text-[11px] font-bold text-primary flex items-center gap-1">
            {label}
          </div>

          {/* Value Display or Placeholder */}
          {selectedDate ? (
            <div className="flex items-center gap-2.5 text-sm font-semibold text-foreground pt-0.5">
              <div className="flex items-center gap-1.5 text-foreground">
                <CalendarIcon className="w-4 h-4 text-primary shrink-0" />
                <span>{formattedDateString}</span>
              </div>

              <span className="text-border-strong font-normal">|</span>

              <div className="flex items-center gap-1.5 text-foreground">
                <Clock className="w-4 h-4 text-primary shrink-0" />
                <span>{formattedTimeString}</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm font-medium text-foreground-muted pt-0.5">
              <CalendarClock className="w-4 h-4 text-primary/70 shrink-0" />
              <span>{placeholder}</span>
            </div>
          )}

          {/* Right Icon Button */}
          <div className="p-1 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-white transition-colors">
            <CalendarClock className="w-4 h-4" />
          </div>
        </div>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-auto p-4 rounded-3xl border border-border/80 shadow-lg bg-surface">
        <div className="flex flex-col sm:flex-row gap-5">
          {/* ── LEFT PANE: CALENDAR PICKER ── */}
          <div className="w-[250px] space-y-3.5 shrink-0">
            {/* Header Month / Year Selectors */}
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
                    <option key={m} value={idx}>
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
                    <option key={y} value={y}>
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

                return (
                  <button
                    key={`curr-${d}`}
                    type="button"
                    onClick={() => handleSelectDay(d)}
                    className={cn(
                      "h-8 w-8 rounded-xl flex items-center justify-center font-bold transition-all mx-auto cursor-pointer",
                      isSelected
                        ? "bg-primary text-white dark:text-slate-950 shadow-md scale-105"
                        : isToday
                        ? "border border-primary text-primary hover:bg-primary/10"
                        : "text-foreground hover:bg-hover hover:text-primary"
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
          </div>

          {/* ── VERTICAL DIVIDER ── */}
          <div className="hidden sm:block w-px bg-border/60" />

          {/* ── RIGHT PANE: TIME STEPPER PICKER ── */}
          <div className="w-full sm:w-[180px] flex flex-col justify-between space-y-4">
            <div>
              <h4 className="text-xs font-bold text-foreground mb-3">Time</h4>

              {/* Time Steppers Grid */}
              <div className="grid grid-cols-3 gap-2 text-center items-center">
                {/* Hour */}
                <div className="flex flex-col items-center space-y-1">
                  <span className="text-[10px] font-semibold text-foreground-muted uppercase">Hour</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={incrementHour}
                    className="h-7 w-7 rounded-lg hover:bg-primary/10 text-foreground-secondary hover:text-primary"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </Button>
                  <div className="w-11 h-9 rounded-xl border border-border bg-background flex items-center justify-center text-xs font-extrabold text-foreground shadow-2xs font-data">
                    {String(hour).padStart(2, "0")}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={decrementHour}
                    className="h-7 w-7 rounded-lg hover:bg-primary/10 text-foreground-secondary hover:text-primary"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                </div>

                {/* Minute */}
                <div className="flex flex-col items-center space-y-1">
                  <span className="text-[10px] font-semibold text-foreground-muted uppercase">Minute</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={incrementMinute}
                    className="h-7 w-7 rounded-lg hover:bg-primary/10 text-foreground-secondary hover:text-primary"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </Button>
                  <div className="w-11 h-9 rounded-xl border border-border bg-background flex items-center justify-center text-xs font-extrabold text-foreground shadow-2xs font-data">
                    {String(minute).padStart(2, "0")}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={decrementMinute}
                    className="h-7 w-7 rounded-lg hover:bg-primary/10 text-foreground-secondary hover:text-primary"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                </div>

                {/* AM / PM */}
                <div className="flex flex-col items-center space-y-1">
                  <span className="text-[10px] font-semibold text-foreground-muted uppercase">AM / PM</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={togglePeriod}
                    className="h-7 w-7 rounded-lg hover:bg-primary/10 text-foreground-secondary hover:text-primary"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </Button>
                  <button
                    type="button"
                    onClick={togglePeriod}
                    className="w-11 h-9 rounded-xl border border-border bg-background flex items-center justify-center text-xs font-extrabold text-primary shadow-2xs cursor-pointer hover:bg-primary/10 transition-colors"
                  >
                    {period}
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={togglePeriod}
                    className="h-7 w-7 rounded-lg hover:bg-primary/10 text-foreground-secondary hover:text-primary"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Bottom Quick Action Buttons & Done CTA */}
            <div className="space-y-2 pt-2 border-t border-border/60">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleToday}
                  className="rounded-xl text-xs font-semibold h-8"
                >
                  Today
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleNow}
                  className="rounded-xl text-xs font-semibold h-8"
                >
                  Now
                </Button>
              </div>

              <Button
                type="button"
                onClick={() => {
                  if (!selectedDate) {
                    commitDateTime(new Date(), hour, minute, period);
                  }
                  setOpen(false);
                }}
                className="w-full rounded-xl bg-primary text-white dark:text-slate-950 hover:bg-primary/90 font-bold text-xs h-9 shadow-sm"
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
