"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate, cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Fingerprint, Calendar, List, CheckCircle2, Clock, AlertTriangle, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { StatGrid, StatCard } from "@/components/ui/stat-card";
import { 
  isSameWeek, 
  isSameMonth, 
  isSameYear, 
  getDaysInMonth, 
  startOfMonth, 
  getDay, 
  subMonths, 
  addMonths, 
  setMonth, 
  setYear,
  format,
  isSameDay,
  differenceInMinutes
} from "date-fns";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function calculateDuration(timeIn, timeOut) {
  if (!timeIn || !timeOut) return "—";
  const start = new Date(timeIn);
  const end = new Date(timeOut);
  const diffMinutes = differenceInMinutes(end, start);
  if (diffMinutes <= 0) return "—";
  const hours = Math.floor(diffMinutes / 60);
  const mins = diffMinutes % 60;
  return `${hours}h ${mins.toString().padStart(2, "0")}m`;
}

function calculateTotalMinutes(timeIn, timeOut) {
  if (!timeIn || !timeOut) return 0;
  const start = new Date(timeIn);
  const end = new Date(timeOut);
  const diff = differenceInMinutes(end, start);
  return diff > 0 ? diff : 0;
}

export function AttendanceCard({ attendance = [] }) {
  const [view, setView] = useState("list"); // "list" | "calendar"
  const [timeFilter, setTimeFilter] = useState("month"); // default to month for better UX
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewDate, setViewDate] = useState(new Date());

  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 5;

  // Sorting
  const sortedAttendance = [...attendance].sort((a, b) => new Date(b.date) - new Date(a.date));

  // 1. Time Filter
  const timeFilteredAttendance = sortedAttendance.filter((a) => {
    if (timeFilter === "all") return true;
    const d = new Date(a.date);
    const now = new Date();
    if (timeFilter === "week") return isSameWeek(d, now, { weekStartsOn: 0 });
    if (timeFilter === "month") return isSameMonth(d, now);
    if (timeFilter === "year") return isSameYear(d, now);
    return true;
  });

  // 2. Summary Calcs (based on time filter only)
  let countPresent = 0;
  let countLate = 0;
  let countAbsent = 0;
  let totalMins = 0;

  timeFilteredAttendance.forEach(a => {
    if (a.status === "Present") countPresent++;
    else if (a.status === "Late") countLate++;
    else if (a.status === "Absent") countAbsent++;
    totalMins += calculateTotalMinutes(a.time_in, a.time_out);
  });

  const totalHrsDisplay = `${Math.floor(totalMins / 60)}h ${totalMins % 60}m`;

  // 3. Status Filter (for list/calendar views)
  const displayAttendance = timeFilteredAttendance.filter(a => statusFilter === "all" || a.status === statusFilter);

  // Pagination
  const totalPages = Math.ceil(displayAttendance.length / rowsPerPage);
  const paginatedAttendance = displayAttendance.slice(
    (currentPage - 1) * rowsPerPage,
    currentPage * rowsPerPage
  );

  const handleFilterChange = (val) => {
    setTimeFilter(val);
    setCurrentPage(1);
  };

  const toggleStatusFilter = (status) => {
    setStatusFilter(prev => prev === status ? "all" : status);
    setCurrentPage(1);
  };

  // Calendar Helpers
  const handlePrevMonth = () => setViewDate((prev) => subMonths(prev, 1));
  const handleNextMonth = () => setViewDate((prev) => addMonths(prev, 1));
  const handleMonthChange = (e) => setViewDate((prev) => setMonth(prev, parseInt(e.target.value, 10)));
  const handleYearChange = (e) => setViewDate((prev) => setYear(prev, parseInt(e.target.value, 10)));

  const daysInCurrentMonth = getDaysInMonth(viewDate);
  const firstDayOfWeek = getDay(startOfMonth(viewDate));
  const prevMonthDate = subMonths(viewDate, 1);
  const daysInPrevMonth = getDaysInMonth(prevMonthDate);
  const prevMonthDays = Array.from({ length: firstDayOfWeek }, (_, i) => daysInPrevMonth - firstDayOfWeek + i + 1);
  const currentMonthDays = Array.from({ length: daysInCurrentMonth }, (_, i) => i + 1);
  const totalGridCells = prevMonthDays.length + currentMonthDays.length;
  const nextMonthDaysCount = (7 - (totalGridCells % 7)) % 7;
  const nextMonthDays = Array.from({ length: nextMonthDaysCount }, (_, i) => i + 1);
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 40 }, (_, i) => currentYear - 30 + i);

  // Status mapping
  const getStatusInfo = (status) => {
    if (status === "Present") return { color: "text-success", bg: "bg-success", bgTint: "bg-success/10", label: "● Present", textLabel: "Present" };
    if (status === "Late") return { color: "text-warning", bg: "bg-warning", bgTint: "bg-warning/10", label: "● Late", textLabel: "Late" };
    if (status === "Absent") return { color: "text-danger", bg: "bg-danger", bgTint: "bg-danger/10", label: "● Absent", textLabel: "Absent" };
    return { color: "text-foreground-muted", bg: "bg-muted", bgTint: "bg-muted/10", label: "● Incomplete", textLabel: "Incomplete" };
  };

  return (
    <Card className="border-0 shadow-xs rounded-3xl overflow-hidden min-h-[300px]">
      <CardHeader className="flex flex-col sm:flex-row justify-between items-center gap-4 pb-5 border-b border-border/60 bg-muted/20 px-8 pt-7">
        <CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
          <Fingerprint className="w-5 h-5 text-primary" /> Attendance Records
        </CardTitle>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {view === "list" && (
            <Select value={timeFilter} onValueChange={handleFilterChange}>
              <SelectTrigger className="w-[120px] h-8 text-xs bg-muted/30">
                <SelectValue placeholder="Filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="week">This Week</SelectItem>
                <SelectItem value="month">This Month</SelectItem>
                <SelectItem value="year">This Year</SelectItem>
              </SelectContent>
            </Select>
          )}
          <div className="flex bg-muted/50 p-0.5 rounded-lg border border-border/50">
            <button
              onClick={() => { setView("list"); setCurrentPage(1); }}
              className={cn("p-1.5 rounded-md text-foreground-muted hover:text-foreground transition-all", view === "list" && "bg-surface shadow-sm text-primary")}
              title="List View"
            ><List className="w-4 h-4" /></button>
            <button
              onClick={() => setView("calendar")}
              className={cn("p-1.5 rounded-md text-foreground-muted hover:text-foreground transition-all", view === "calendar" && "bg-surface shadow-sm text-primary")}
              title="Calendar View"
            ><Calendar className="w-4 h-4" /></button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 flex flex-col pt-6 px-8 pb-8">
        {/* Summary Cards */}
        <StatGrid cols={4} className="mb-8">
          <StatCard
            icon={CheckCircle2}
            label="Present"
            value={countPresent.toString()}
            tone="success"
            interactive
            active={statusFilter === "Present"}
            onClick={() => toggleStatusFilter("Present")}
          />
          <StatCard
            icon={Clock}
            label="Late"
            value={countLate.toString()}
            tone="warning"
            interactive
            active={statusFilter === "Late"}
            onClick={() => toggleStatusFilter("Late")}
          />
          <StatCard
            icon={AlertTriangle}
            label="Absent"
            value={countAbsent.toString()}
            tone="danger"
            interactive
            active={statusFilter === "Absent"}
            onClick={() => toggleStatusFilter("Absent")}
          />
          <StatCard
            icon={Timer}
            label="Total Hours"
            value={totalHrsDisplay}
            tone="primary"
          />
        </StatGrid>

        {attendance.length === 0 ? (
          <div className="flex-1 flex flex-col justify-center">
            <EmptyState icon={Fingerprint} title="No attendance records" description="Your check-in / check-out records will appear here." className="py-8" />
          </div>
        ) : view === "list" ? (
          <div className="flex flex-col flex-1">
            <div className="w-full overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
              <div className="min-w-[500px]">
                {/* Table Header */}
                <div className="grid grid-cols-[2fr_1.5fr_1.5fr_1fr_1fr] gap-4 py-2 px-2 text-[11px] font-semibold text-foreground-muted uppercase tracking-wider border-b border-border mb-1">
                  <div>Date</div>
                  <div>Time In</div>
                  <div>Time Out</div>
                  <div>Hours</div>
                  <div>Status</div>
                </div>
                
                {/* Table Body */}
                <div className="divide-y divide-border/50">
                  {paginatedAttendance.length === 0 ? (
                    <div className="w-full flex flex-col items-center justify-center py-10 text-center animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <div className="w-12 h-12 rounded-full bg-muted/30 flex items-center justify-center mb-3 text-foreground-muted">
                        <Fingerprint className="w-5 h-5" />
                      </div>
                      <h3 className="font-semibold text-foreground mb-1">No Records Found</h3>
                      <p className="text-sm text-foreground-muted">No attendance records match the selected filters.</p>
                    </div>
                  ) : (
                    paginatedAttendance.map((a) => {
                      const statusInfo = getStatusInfo(a.status);
                      return (
                        <div key={a.attendance_id} className="grid grid-cols-[2fr_1.5fr_1.5fr_1fr_1fr] gap-4 py-3 px-2 text-xs items-center hover:bg-muted/20 transition-colors rounded-lg -mx-2">
                          <div className="font-medium text-foreground">{formatDate(a.date)}</div>
                          <div className="text-foreground-secondary">{a.time_in ? format(new Date(a.time_in), 'hh:mm a') : "—"}</div>
                          <div className="text-foreground-secondary">{a.time_out ? format(new Date(a.time_out), 'hh:mm a') : "—"}</div>
                          <div className="text-foreground-secondary">{calculateDuration(a.time_in, a.time_out)}</div>
                          <div className={cn("font-medium", statusInfo.color)}>{statusInfo.label}</div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
            
            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-center text-xs font-medium">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-3 text-xs text-foreground-secondary hover:text-foreground hover:bg-muted/50 rounded-lg"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                >
                  ‹ Prev
                </Button>
                
                <span className="text-foreground mx-4">
                  {currentPage} <span className="text-foreground-muted mx-1">/</span> {totalPages}
                </span>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-3 text-xs text-foreground-secondary hover:text-foreground hover:bg-muted/50 rounded-lg"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                >
                  Next ›
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Calendar Header */}
            <div className="flex items-center justify-between mb-4 bg-muted/20 p-2 rounded-xl border border-border/50">
              <Button type="button" variant="ghost" size="icon" onClick={handlePrevMonth} className="h-8 w-8 hover:bg-hover"><ChevronLeft className="w-4 h-4" /></Button>
              <div className="flex items-center gap-1.5">
                <Select value={viewDate.getMonth().toString()} onValueChange={(val) => setViewDate(prev => setMonth(prev, parseInt(val, 10)))}>
                  <SelectTrigger className="h-8 border-0 bg-transparent shadow-none font-semibold text-sm w-auto px-2 focus:ring-0 hover:bg-hover hover:text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, idx) => (
                      <SelectItem key={m} value={idx.toString()}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={viewDate.getFullYear().toString()} onValueChange={(val) => setViewDate(prev => setYear(prev, parseInt(val, 10)))}>
                  <SelectTrigger className="h-8 border-0 bg-transparent shadow-none font-semibold text-sm w-auto px-2 focus:ring-0 hover:bg-hover hover:text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {yearOptions.map(y => (
                      <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={handleNextMonth} className="h-8 w-8 hover:bg-hover"><ChevronRight className="w-4 h-4" /></Button>
            </div>

            {/* Grid Header */}
            <div className="grid grid-cols-7 text-center text-[11px] font-bold text-foreground-muted mb-2 bg-muted/20 py-2 rounded-lg">
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(day => <div key={day}>{day}</div>)}
            </div>

            {/* Grid Body */}
            <TooltipProvider>
              <div className="grid grid-cols-7 gap-1.5 text-xs">
                {prevMonthDays.map((d, i) => (
                  <div key={`prev-${i}`} className="p-1 min-h-[44px] flex flex-col items-center justify-center rounded-lg opacity-30 bg-muted/10"><span className="font-medium">{d}</span></div>
                ))}
                {currentMonthDays.map((d) => {
                  const currentDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), d);
                  const record = displayAttendance.find(a => isSameDay(new Date(a.date), currentDate));
                  const isToday = isSameDay(currentDate, new Date());
                  
                  let dotColor = "bg-transparent";
                  let cellBg = "bg-transparent hover:bg-muted/30";
                  
                  if (record) {
                    const info = getStatusInfo(record.status);
                    dotColor = info.bg;
                    cellBg = `${info.bgTint} hover:opacity-80 hover:scale-[1.02] hover:shadow-sm`;
                  } else if (isToday) {
                    cellBg = "bg-primary/5 hover:bg-primary/10";
                  }

                  const cell = (
                    <div 
                      className={cn(
                        "p-1 min-h-[44px] flex flex-col items-center justify-center rounded-lg transition-all duration-200 border border-transparent",
                        isToday && "border-primary/30",
                        cellBg
                      )}
                    >
                      {isToday ? (
                        <div className="w-6 h-6 flex items-center justify-center border border-primary text-primary bg-primary/5 rounded-full font-bold text-[11px]">
                          {d}
                        </div>
                      ) : (
                        <span className={cn("font-medium", isToday && "text-primary")}>{d}</span>
                      )}
                      <div className={cn("w-1.5 h-1.5 rounded-full mt-1", dotColor)} />
                    </div>
                  );

                  if (record) {
                    return (
                      <Tooltip 
                        key={`curr-${d}`}
                        content={
                          <div className="text-center space-y-1">
                            <div className="font-bold text-xs">{getStatusInfo(record.status).textLabel}</div>
                            <div className="text-[11px] text-foreground-muted">
                              In: {record.time_in ? format(new Date(record.time_in), 'h:mm a') : '—'} <br/>
                              Out: {record.time_out ? format(new Date(record.time_out), 'h:mm a') : '—'}
                            </div>
                            <div className="text-[11px] font-semibold text-primary pt-1 border-t border-border/50">
                              {calculateDuration(record.time_in, record.time_out)} total
                            </div>
                          </div>
                        }
                      >
                        {cell}
                      </Tooltip>
                    );
                  }

                  return <div key={`curr-${d}`}>{cell}</div>;
                })}
                {nextMonthDays.map((d, i) => (
                  <div key={`next-${i}`} className="p-1 min-h-[44px] flex flex-col items-center justify-center rounded-lg opacity-30 bg-muted/10"><span className="font-medium">{d}</span></div>
                ))}
              </div>
            </TooltipProvider>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
