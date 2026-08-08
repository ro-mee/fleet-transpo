"use client";

import { useState, useMemo } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ChevronDown,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  TableProperties,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TableSkeleton } from "@/components/ui/skeleton";

export function DataTable({
  columns: rawColumns,
  data,
  searchable = true,
  searchPlaceholder = "Search by plate or name...",
  pageSize = 10,
  onRowClick,
  isLoading = false,
  searchValue,
  onSearchChange,
  toolbar,
  title = "Records",
  description = "Select a row to view its complete record.",
  icon: HeaderIcon = TableProperties,
  context,
  emptyTitle = "No results found",
  emptyDescription = "Try adjusting your search or filters.",
}) {
  const [sorting, setSorting] = useState([]);
  const [internalFilter, setInternalFilter] = useState("");

  const isControlled = searchValue !== undefined;
  const globalFilter = isControlled ? searchValue : internalFilter;
  const setGlobalFilter = isControlled ? onSearchChange : setInternalFilter;

  const columns = useMemo(() => {
    if (!rawColumns?.length) return [];
    if (rawColumns[0].accessorKey || rawColumns[0].id) return rawColumns;
    return rawColumns.map((col) => ({
      id: col.key,
      accessorKey: col.key,
      header: col.label || "",
      enableSorting: col.sortable || false,
      cell: col.render
        ? (info) => col.render(info.getValue(), info.row.original)
        : undefined,
    }));
  }, [rawColumns]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const totalRows = table.getFilteredRowModel().rows.length;
  const { pageIndex, pageSize: currentPageSize } = table.getState().pagination;
  const pageCount = table.getPageCount();
  const visibleStart = totalRows ? pageIndex * currentPageSize + 1 : 0;
  const visibleEnd = Math.min((pageIndex + 1) * currentPageSize, totalRows);
  const pageNumbers = useMemo(() => {
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index);

    const pages = new Set([0, pageCount - 1, pageIndex - 1, pageIndex, pageIndex + 1]);
    const orderedPages = [...pages].filter((page) => page >= 0 && page < pageCount).sort((first, second) => first - second);

    return orderedPages.flatMap((page, index) => {
      const previousPage = orderedPages[index - 1];
      return index && page - previousPage > 1 ? ["ellipsis-" + page, page] : [page];
    });
  }, [pageCount, pageIndex]);

  return (
    <div className="space-y-0 overflow-hidden rounded-3xl border border-border/80 bg-surface shadow-xs">
      {/* ── Header Title Bar ── */}
      <div className="flex flex-col gap-3 border-b border-border/60 bg-surface px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-foreground text-background shadow-xs">
            <HeaderIcon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-extrabold tracking-tight text-foreground">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-foreground-secondary">{description}</p>}
          </div>
        </div>
        {context && (
          <span className="self-start rounded-full bg-muted/60 px-3 py-1 text-xs font-semibold text-foreground-secondary border border-border/60 sm:self-auto">
            {context}
          </span>
        )}
      </div>

      {/* ── Search Bar & Count Toolbar ── */}
      {searchable && (
        <div className="flex flex-col gap-3 px-6 py-3.5 border-b border-border/60 bg-surface sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground-muted" />
            <input
              placeholder={searchPlaceholder}
              value={globalFilter ?? ""}
              onChange={(e) => setGlobalFilter(e.target.value)}
              className="w-full h-9 pl-9 pr-3 rounded-full bg-surface border border-border/80 text-xs font-medium text-foreground placeholder:text-foreground-muted shadow-2xs focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10 transition-all"
            />
          </div>
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <span className="text-xs text-foreground-muted font-medium hidden sm:inline">Click headers to sort</span>
            {toolbar && <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin">{toolbar}</div>}
            <span className="rounded-full bg-surface px-3 py-1 text-xs font-bold text-foreground-secondary tabular-nums border border-border/80 shadow-2xs shrink-0">
              {totalRows.toLocaleString()} {totalRows === 1 ? "result" : "results"}
            </span>
          </div>
        </div>
      )}

      {/* ── Table Area ── */}
      {isLoading ? (
        <div className="p-6">
          <TableSkeleton />
        </div>
      ) : (
        <div className="relative overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <table className="w-full min-w-[1000px] border-collapse">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="border-b border-border/60 bg-surface">
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className={cn(
                        "px-5 py-3.5 text-left text-[10px] font-black text-foreground-muted uppercase tracking-widest whitespace-nowrap select-none",
                        header.column.getCanSort() && "cursor-pointer hover:text-foreground transition-colors"
                      )}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <div className="flex items-center gap-1.5">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getCanSort() && (
                          <span className="text-foreground-muted/60">
                            {{
                              asc: <ChevronUp className="w-3 h-3 text-foreground" />,
                              desc: <ChevronDown className="w-3 h-3 text-foreground" />,
                            }[header.column.getIsSorted()] ?? (
                              <ChevronsUpDown className="w-3 h-3 opacity-30" />
                            )}
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-border/40">
              {table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(
                      "group transition-colors hover:bg-hover/30",
                      onRowClick && "cursor-pointer"
                    )}
                    onClick={() => onRowClick?.(row.original)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className={cn("px-5 py-4 text-xs font-medium text-foreground whitespace-nowrap", cell.column.columnDef.meta?.className)}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={columns.length} className="px-5 py-16">
                    <div className="text-center space-y-1">
                      <p className="text-sm font-bold text-foreground">{emptyTitle}</p>
                      <p className="text-xs text-foreground-secondary">{emptyDescription}</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination Footer ── */}
      {pageCount > 1 && (
        <div className="flex flex-col gap-3 px-6 py-4 border-t border-border/60 bg-surface sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs font-semibold text-foreground-secondary">
            Showing <span className="font-bold text-foreground">{visibleStart}–{visibleEnd}</span> of <span className="font-bold text-foreground">{totalRows}</span> entries
          </span>
          <div className="flex items-center gap-1.5">
            <span className="mr-2 hidden text-xs font-semibold text-foreground-muted sm:inline">Page {pageIndex + 1} of {pageCount}</span>
            <button
              aria-label="First page"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
              className="hidden h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface text-foreground-muted hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30 transition-colors sm:flex"
            >
              <ChevronsLeft className="w-3.5 h-3.5" />
            </button>
            <button
              aria-label="Previous page"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface text-foreground-muted hover:border-primary/40 hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            {pageNumbers.map((page) => {
              if (typeof page === "string") {
                return <span key={page} className="px-1 text-xs text-foreground-muted">…</span>;
              }
              const isActive = pageIndex === page;
              return (
                <button
                  key={page}
                  onClick={() => table.setPageIndex(page)}
                  className={cn(
                    "flex h-8 min-w-[32px] px-2.5 items-center justify-center rounded-full text-xs font-bold border transition-colors",
                    isActive
                      ? "bg-primary border-primary text-white dark:text-slate-950 shadow-2xs"
                      : "border-border/80 bg-surface text-foreground-secondary hover:border-primary/40 hover:text-primary"
                  )}
                >
                  {page + 1}
                </button>
              );
            })}
            <button
              aria-label="Next page"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface text-foreground-muted hover:border-primary/40 hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button
              aria-label="Last page"
              onClick={() => table.setPageIndex(pageCount - 1)}
              disabled={!table.getCanNextPage()}
              className="hidden h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface text-foreground-muted hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30 transition-colors sm:flex"
            >
              <ChevronsRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
