import ExcelJS from "exceljs";
import { addNativeCharts } from "@/lib/reports/native-charts";

const COLORS = {
  navy: "17324D",
  blue: "2563EB",
  teal: "0F766E",
  amber: "D97706",
  green: "15803D",
  red: "B91C1C",
  ink: "1F2937",
  muted: "64748B",
  pale: "EFF6FF",
  border: "CBD5E1",
  white: "FFFFFF",
};

const number = (value) => Number(value) || 0;
const safeText = (value) => {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
};
const day = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const match = String(value).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
};
const instant = (value) => value ? new Date(value) : null;
const monthOf = (value) => {
  const date = day(value);
  return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` : "Unknown";
};

function workbook(title) {
  const book = new ExcelJS.Workbook();
  book.creator = "Fleet Management System";
  book.company = "Fleet Management System";
  book.created = new Date();
  book.modified = new Date();
  book.calcProperties.fullCalcOnLoad = true;
  book.calcProperties.forceFullCalc = true;
  book.properties.date1904 = false;
  book.title = title;
  return book;
}

function styleTitle(sheet, range, value, color = COLORS.navy) {
  sheet.mergeCells(range);
  const cell = sheet.getCell(range.split(":")[0]);
  cell.value = value;
  cell.font = { name: "Aptos Display", size: 22, bold: true, color: { argb: COLORS.white } };
  cell.alignment = { vertical: "middle", horizontal: "left" };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
  sheet.getRow(cell.row).height = 30;
  if (sheet.getRow(cell.row + 1)) sheet.getRow(cell.row + 1).height = 18;
}

function styleHeader(row, color = COLORS.navy) {
  row.height = 28;
  row.eachCell((cell) => {
    cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: COLORS.border } } };
  });
}

function styleBody(sheet, firstRow, lastRow) {
  for (let rowNumber = firstRow; rowNumber <= lastRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.height = 22;
    row.eachCell((cell) => {
      cell.font = { name: "Aptos", size: 10, color: { argb: COLORS.ink } };
      cell.alignment = { vertical: "middle", wrapText: false };
      cell.border = { bottom: { style: "hair", color: { argb: "E2E8F0" } } };
    });
  }
}

function finishTable(sheet, widths, headerRow = 1, lastRow = sheet.rowCount) {
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  const endColumn = sheet.getColumn(widths.length).letter;
  sheet.views = [{ state: "frozen", ySplit: headerRow }];
  sheet.autoFilter = { from: `A${headerRow}`, to: `${endColumn}${Math.max(headerRow, lastRow)}` };
  styleHeader(sheet.getRow(headerRow));
  styleBody(sheet, headerRow + 1, lastRow);
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

function periodLine(sheet, from, to, columns = 8) {
  sheet.mergeCells(3, 1, 3, columns);
  const cell = sheet.getCell(3, 1);
  cell.value = `Reporting period: ${from || "All available"} to ${to || "All available"} | Generated ${new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date())}`;
  cell.font = { name: "Aptos", size: 10, color: { argb: COLORS.muted } };
  cell.alignment = { vertical: "middle" };
}

function section(sheet, row, columns, value, color = COLORS.teal) {
  sheet.mergeCells(row, 1, row, columns);
  const cell = sheet.getCell(row, 1);
  cell.value = value;
  cell.font = { name: "Aptos", size: 11, bold: true, color: { argb: COLORS.white } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
  cell.alignment = { vertical: "middle" };
  sheet.getRow(row).height = 24;
}

function kpi(sheet, row, column, label, value, numFmt, formula) {
  sheet.mergeCells(row, column, row, column + 1);
  sheet.mergeCells(row + 1, column, row + 1, column + 1);
  const labelCell = sheet.getCell(row, column);
  const valueCell = sheet.getCell(row + 1, column);
  labelCell.value = label;
  labelCell.font = { name: "Aptos", size: 9, bold: true, color: { argb: COLORS.muted } };
  labelCell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.pale } };
  const missing = value == null || value === "";
  if (formula) valueCell.value = { formula, result: missing ? "" : value };
  else valueCell.value = missing ? "Insufficient data" : value;
  valueCell.numFmt = missing ? "General" : numFmt;
  valueCell.font = { name: "Aptos Display", size: missing ? 13 : 17, bold: true, color: { argb: missing ? COLORS.amber : COLORS.navy } };
  valueCell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  valueCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F8FAFC" } };
  sheet.getRow(row).height = 25;
  sheet.getRow(row + 1).height = 35;
}

function methodology(sheet, row, text, columns = 8) {
  section(sheet, row, columns, "Methodology and scope");
  sheet.mergeCells(row + 1, 1, row + 2, columns);
  const cell = sheet.getCell(row + 1, 1);
  cell.value = text;
  cell.font = { name: "Aptos", size: 10, color: { argb: COLORS.ink } };
  cell.alignment = { vertical: "middle", wrapText: true };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "ECFDF5" } };
  sheet.getRow(row + 1).height = 32;
  sheet.getRow(row + 2).height = 28;
}

function formula(cell, expression, result, numFmt) {
  cell.value = { formula: String(expression).replace(/^=/, ""), result: result == null ? "" : result };
  if (numFmt) cell.numFmt = numFmt;
}

// Excel expects literal currency text to be quoted in custom number formats.
// Sanitize every cell and column format immediately before serialization.
async function writeWorkbook(book, charts = []) {
  book.eachSheet((sheet) => {
    sheet.eachRow((row) => row.eachCell((cell) => {
      if (typeof cell.numFmt === "string") cell.numFmt = cell.numFmt.replace(/^PHP\b/, '"PHP"');
    }));
    sheet.columns.forEach((column) => {
      if (typeof column.numFmt === "string") column.numFmt = column.numFmt.replace(/^PHP\b/, '"PHP"');
    });
  });
  return addNativeCharts(await book.xlsx.writeBuffer(), book, charts);
}

const chartSeries = (nameCell, range, color) => ({ nameCell, range, color });
const nativeChart = (sheet, title, categoryRange, rowCount, series, options = {}) => ({
  sheet,
  title,
  categoryRange,
  rowCount,
  series,
  sourceSheet: options.sourceSheet || sheet,
  type: options.type || "bar",
  direction: options.direction || "col",
  numberFormat: options.numberFormat || "General",
  anchor: options.anchor,
});

function textStatus(sheet, ref, expressions) {
  sheet.addConditionalFormatting({
    ref,
    rules: expressions.map(([value, fill, font]) => ({
      type: "expression",
      formulae: [`$${ref.split(":")[0].replace(/\d+/g, "")}${ref.match(/\d+/)?.[0] || 1}="${value}"`],
      style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: fill }, fgColor: { argb: fill } }, font: { color: { argb: font }, bold: true } },
    })),
  });
}

function noData(sheet, range, message) {
  sheet.mergeCells(range);
  const cell = sheet.getCell(range.split(":")[0]);
  cell.value = message;
  cell.font = { name: "Aptos", size: 10, italic: true, color: { argb: COLORS.muted } };
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
}

// ponytail: ExcelJS 4.4 emits an invalid x14 extension for dataBar rules;
// use a two-color scale until the library writes schema-valid data bars.
function addDataBar(sheet, ref, color = COLORS.blue) {
  sheet.addConditionalFormatting({ ref, rules: [{ type: "colorScale", cfvo: [{ type: "min" }, { type: "max" }], color: [{ argb: COLORS.white }, { argb: color }] }] });
}

function addColorScale(sheet, ref) {
  sheet.addConditionalFormatting({ ref, rules: [{ type: "colorScale", cfvo: [{ type: "min" }, { type: "percentile", value: 50 }, { type: "max" }], color: [{ argb: "FECACA" }, { argb: "FEF3C7" }, { argb: "BBF7D0" }] }] });
}

function addIconSet(sheet, ref, iconSet = "3TrafficLights1") {
  sheet.addConditionalFormatting({ ref, rules: [{ type: "iconSet", iconSet, cfvo: [{ type: "num", value: 0 }, { type: "percent", value: 50 }, { type: "percent", value: 80 }], showValue: true }] });
}

function detailSheet(book, name, headers, rows, widths) {
  const sheet = book.addWorksheet(name);
  sheet.addRow(headers);
  rows.forEach((row) => sheet.addRow(row));
  finishTable(sheet, widths, 1, Math.max(1, rows.length + 1));
  return sheet;
}

function baseSummary(book, name, title, from, to, columns = 8) {
  const sheet = book.addWorksheet(name, { properties: { tabColor: { argb: COLORS.navy } } });
  sheet.columns = Array.from({ length: columns }, () => ({ width: 16 }));
  sheet.getColumn(1).width = 22;
  sheet.getColumn(columns).width = 22;
  styleTitle(sheet, `A1:${sheet.getColumn(columns).letter}2`, title);
  periodLine(sheet, from, to, columns);
  sheet.views = [{ state: "frozen", ySplit: 3 }];
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 1 };
  return sheet;
}

export async function buildMaintenanceWorkbook(report, { from, to }) {
  const book = workbook("Maintenance Audit");
  const summary = baseSummary(book, "Summary", "Maintenance Audit", from, to);
  kpi(summary, 5, 1, "Recorded maintenance cost", report.totalRecords ? report.totalCost : null, 'PHP #,##0.00');
  kpi(summary, 5, 3, "Maintenance records", report.totalRecords, "0");
  kpi(summary, 5, 5, "Average cost per record", report.totalRecords ? report.totalCost / report.totalRecords : null, 'PHP #,##0.00', `IF(C6=0,"",A6/C6)`);
  kpi(summary, 5, 7, "Most costly type", report.byType?.[0]?.type || null, "General");
  methodology(summary, 10, report.methodology);

  const analysis = book.addWorksheet("Analysis", { properties: { tabColor: { argb: COLORS.blue } } });
  styleTitle(analysis, "A1:F2", "Maintenance Spend Analysis", COLORS.blue);
  analysis.mergeCells("A3:F3");
  analysis.getCell("A3").value = "Costs are recorded values; averages and shares are editable formulas. Status values describe the stored maintenance record, not a guessed completion state.";
  analysis.getCell("A3").font = { size: 10, italic: true, color: { argb: COLORS.muted } };
  analysis.getCell("A3").alignment = { wrapText: true };
  analysis.addRow([]);
  analysis.addRow(["Maintenance type", "Records", "Recorded cost", "Share of cost", "Average cost", "Status"]);
  styleHeader(analysis.getRow(5), COLORS.blue);
  const types = report.byType || [];
  types.forEach((row, index) => {
    const rowNumber = index + 6;
    const line = analysis.addRow([safeText(row.type), row.count, row.cost, null, null, row.count ? "Recorded" : "No records"]);
    formula(line.getCell(4), `IF(SUM($C$6:$C$${Math.max(6, types.length + 5)})=0,"",C${rowNumber}/SUM($C$6:$C$${Math.max(6, types.length + 5)}))`, report.totalCost ? row.cost / report.totalCost : null, "0.0%");
    formula(line.getCell(5), `IF(B${rowNumber}=0,"",C${rowNumber}/B${rowNumber})`, row.count ? row.cost / row.count : null, 'PHP #,##0.00');
  });
  finishTable(analysis, [24, 12, 18, 16, 18, 18], 5, Math.max(5, types.length + 5));
  if (types.length) {
    addDataBar(analysis, `C6:C${types.length + 5}`, COLORS.amber);
    addColorScale(analysis, `D6:D${types.length + 5}`);
    textStatus(analysis, `F6:F${types.length + 5}`, [["Recorded", "DCFCE7", COLORS.green], ["No records", "FEF3C7", COLORS.amber]]);
  } else noData(analysis, "A6:F8", "No maintenance records in this period.");
  analysis.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  const summaryStart = 15;
  section(summary, summaryStart, 6, "Maintenance spend by type", COLORS.blue);
  const summaryHeader = summary.addRow(["Maintenance type", "Records", "Recorded cost", "Share of cost", "Average cost", "Status"]);
  styleHeader(summaryHeader, COLORS.blue);
  if (types.length) {
    types.slice(0, 10).forEach((row, index) => {
      const target = summary.addRow([null, null, null, null, null, null]);
      const sourceRow = index + 6;
      [1, 2, 3, 4, 5, 6].forEach((column) => formula(target.getCell(column), `'Analysis'!${String.fromCharCode(64 + column)}${sourceRow}`, column === 1 ? row.type : column === 2 ? row.count : column === 3 ? row.cost : column === 4 ? (report.totalCost ? row.cost / report.totalCost : null) : column === 5 ? (row.count ? row.cost / row.count : null) : "Recorded", column === 3 || column === 5 ? 'PHP #,##0.00' : column === 4 ? "0.0%" : null));
    });
    styleBody(summary, summaryStart + 2, summaryStart + types.slice(0, 10).length + 1);
    addDataBar(summary, `C${summaryStart + 2}:C${summaryStart + types.slice(0, 10).length + 1}`, COLORS.amber);
    addColorScale(summary, `D${summaryStart + 2}:D${summaryStart + types.slice(0, 10).length + 1}`);
  } else noData(summary, `A${summaryStart + 1}:F${summaryStart + 3}`, "No maintenance records in this period.");

  const trends = book.addWorksheet("Trends", { properties: { tabColor: { argb: COLORS.teal } } });
  styleTitle(trends, "A1:D2", "Maintenance Trends", COLORS.teal);
  trends.addRow([]);
  trends.addRow(["Month", "Records", "Recorded cost", "Average cost"]);
  styleHeader(trends.getRow(4), COLORS.teal);
  (report.monthlyData || []).forEach((row, index) => {
    const rowNumber = index + 5;
    const line = trends.addRow([row.month, row.count, row.cost, null]);
    formula(line.getCell(4), `IF(B${rowNumber}=0,"",C${rowNumber}/B${rowNumber})`, row.count ? row.cost / row.count : null, 'PHP #,##0.00');
  });
  finishTable(trends, [16, 12, 18, 18], 4, Math.max(4, (report.monthlyData || []).length + 4));
  if (report.monthlyData?.length) addDataBar(trends, `C5:C${report.monthlyData.length + 4}`, COLORS.teal);
  else noData(trends, "A5:D7", "No monthly maintenance activity in this period.");

  detailSheet(book, "Details", ["Maintenance ID", "Date", "Vehicle", "Plate", "Type", "Status", "Priority", "Cost", "Mileage at service", "Completed date", "Next schedule", "Provider", "Service center", "Description", "Recurring", "Remarks"], (report.records || []).map((row) => [row.maintenance_id, day(row.maintenance_date), safeText(row.vehicle_name || row.vehicle_id), safeText(row.plate_number || "Unknown"), safeText(row.maintenance_type || "Other"), safeText(row.status || "Unknown"), safeText(row.priority || "Normal"), number(row.cost), row.mileage_at_service == null ? null : number(row.mileage_at_service), day(row.completed_date), day(row.next_schedule_date), safeText(row.service_provider), safeText(row.service_center), safeText(row.description), row.is_recurring == null ? null : Boolean(row.is_recurring), safeText(row.remarks)]), [14, 14, 24, 14, 18, 14, 12, 16, 18, 16, 16, 24, 24, 36, 12, 36]);
  const details = book.getWorksheet("Details");
  [2, 10, 11].forEach((column) => { details.getColumn(column).numFmt = "yyyy-mm-dd"; });
  details.getColumn(8).numFmt = 'PHP #,##0.00';
  addDataBar(details, `H2:H${Math.max(2, details.rowCount)}`, COLORS.amber);
  return writeWorkbook(book, [
    nativeChart("Summary", "Recorded maintenance cost by type (PHP)", `A17:A${16 + Math.min(10, types.length)}`, Math.min(10, types.length), [chartSeries("C16", `C17:C${16 + Math.min(10, types.length)}`, COLORS.amber)], { direction: "bar", numberFormat: '"PHP" #,##0', anchor: { from: { col: 7, row: 14 }, to: { col: 15, row: 30 } } }),
    nativeChart("Analysis", "Average maintenance cost per record (PHP)", `A6:A${types.length + 5}`, types.length, [chartSeries("E5", `E6:E${types.length + 5}`, COLORS.blue)], { direction: "bar", numberFormat: '"PHP" #,##0', anchor: { from: { col: 7, row: 3 }, to: { col: 15, row: 19 } } }),
    nativeChart("Trends", "Monthly recorded maintenance cost (PHP)", `A5:A${(report.monthlyData || []).length + 4}`, (report.monthlyData || []).length, [chartSeries("C4", `C5:C${(report.monthlyData || []).length + 4}`, COLORS.teal)], { type: "line", numberFormat: '"PHP" #,##0', anchor: { from: { col: 5, row: 3 }, to: { col: 13, row: 19 } } }),
  ]);
}

export async function buildFleetUtilizationWorkbook(report, { from, to }) {
  const book = workbook("Fleet Activity and Vehicle Utilization");
  const summary = baseSummary(book, "Summary", "Fleet Activity & Vehicle Utilization", from, to);
  kpi(summary, 5, 1, "Current in-use rate", report.fleetSize ? report.utilization / 100 : null, "0%");
  kpi(summary, 5, 3, "Vehicles in use", report.vehiclesInUse, "0");
  kpi(summary, 5, 5, "Trip records", report.totalTrips, "0");
  kpi(summary, 5, 7, "Distance recorded", report.totalDistance, '0.00 "km"');
  methodology(summary, 10, report.methodology);

  const analysis = book.addWorksheet("Analysis", { properties: { tabColor: { argb: COLORS.blue } } });
  styleTitle(analysis, "A1:H2", "Vehicle Activity Analysis", COLORS.blue);
  analysis.mergeCells("A3:H3");
  analysis.getCell("A3").value = "Current in-use rate is a fleet-status snapshot. Activity rows include every trip status; status is visible so completed work is not confused with in-progress or cancelled records.";
  analysis.getCell("A3").font = { size: 10, italic: true, color: { argb: COLORS.muted } };
  analysis.getCell("A3").alignment = { wrapText: true };
  analysis.addRow([]);
  analysis.addRow(["Rank", "Vehicle", "Plate", "Current status", "Trip records", "Distance (km)", "Average km/trip", "Distance share"]);
  styleHeader(analysis.getRow(5), COLORS.blue);
  const vehicles = report.byVehicle || [];
  const totalDistance = report.totalDistance || 0;
  vehicles.forEach((item, index) => {
    const rowNumber = index + 6;
    const line = analysis.addRow([index + 1, safeText(item.vehicle || "Unknown"), safeText(item.plate || "Unknown"), safeText(item.vehicle_status || "Unknown"), item.trips, item.distance, null, null]);
    formula(line.getCell(7), `IF(E${rowNumber}=0,"",F${rowNumber}/E${rowNumber})`, item.trips ? item.distance / item.trips : null, "0.00");
    formula(line.getCell(8), `IF(SUM($F$6:$F$${Math.max(6, vehicles.length + 5)})=0,"",F${rowNumber}/SUM($F$6:$F$${Math.max(6, vehicles.length + 5)}))`, totalDistance ? item.distance / totalDistance : null, "0.0%");
  });
  finishTable(analysis, [9, 24, 15, 18, 14, 16, 18, 16], 5, Math.max(5, vehicles.length + 5));
  if (vehicles.length) {
    addDataBar(analysis, `F6:F${vehicles.length + 5}`, COLORS.blue);
    addColorScale(analysis, `H6:H${vehicles.length + 5}`);
    textStatus(analysis, `D6:D${vehicles.length + 5}`, [["In Use", "DCFCE7", COLORS.green], ["Under Maintenance", "FEE2E2", COLORS.red]]);
  } else noData(analysis, "A6:H8", "No trip activity in this period.");

  const summaryStart = 15;
  section(summary, summaryStart, 8, "Estimated workload by vehicle", COLORS.blue);
  const summaryHeader = summary.addRow(["Rank", "Vehicle", "Plate", "Status", "Trip records", "Distance (km)", "Average km/trip", "Distance share"]);
  styleHeader(summaryHeader, COLORS.blue);
  vehicles.slice(0, 10).forEach((item, index) => {
    const target = summary.addRow(Array.from({ length: 8 }, () => null));
    const sourceRow = index + 6;
    [1, 2, 3, 4, 5, 6, 7, 8].forEach((column) => formula(target.getCell(column), `'Analysis'!${String.fromCharCode(64 + column)}${sourceRow}`, column === 1 ? index + 1 : column === 2 ? item.vehicle : column === 3 ? item.plate : column === 4 ? item.vehicle_status : column === 5 ? item.trips : column === 6 ? item.distance : column === 7 ? (item.trips ? item.distance / item.trips : null) : (totalDistance ? item.distance / totalDistance : null), column === 6 || column === 7 ? "0.00" : column === 8 ? "0.0%" : null));
  });
  if (vehicles.length) {
    styleBody(summary, summaryStart + 2, summaryStart + vehicles.slice(0, 10).length + 1);
    addDataBar(summary, `F${summaryStart + 2}:F${summaryStart + vehicles.slice(0, 10).length + 1}`, COLORS.blue);
  } else noData(summary, `A${summaryStart + 1}:H${summaryStart + 3}`, "No trip activity in this period.");

  const trends = book.addWorksheet("Trends", { properties: { tabColor: { argb: COLORS.teal } } });
  styleTitle(trends, "A1:F2", "Fleet Activity Trends", COLORS.teal);
  trends.addRow([]);
  trends.addRow(["Month", "Trip records", "Distance (km)", "Average km/trip", "Status", "Records"]);
  styleHeader(trends.getRow(4), COLORS.teal);
  (report.monthlyData || []).forEach((row, index) => {
    const rowNumber = index + 5;
    const line = trends.addRow([row.month, row.trips, row.distance, null, "All statuses", row.trips]);
    formula(line.getCell(4), `IF(B${rowNumber}=0,"",C${rowNumber}/B${rowNumber})`, row.trips ? row.distance / row.trips : null, "0.00");
  });
  finishTable(trends, [16, 14, 16, 18, 18, 12], 4, Math.max(4, (report.monthlyData || []).length + 4));
  if (report.monthlyData?.length) addDataBar(trends, `C5:C${report.monthlyData.length + 4}`, COLORS.teal);
  else noData(trends, "A5:F7", "No monthly activity in this period.");
  const statusStart = Math.max(10, (report.monthlyData || []).length + 8);
  section(trends, statusStart, 3, "Trip status mix", COLORS.blue);
  const statusHeader = trends.addRow(["Status", "Trip records", "Distance (km)"]);
  styleHeader(statusHeader, COLORS.blue);
  (report.statusBreakdown || []).forEach((row) => trends.addRow([safeText(row.status), row.trips, row.distance]));
  if (report.statusBreakdown?.length) {
    styleBody(trends, statusStart + 2, statusStart + report.statusBreakdown.length + 1);
    addDataBar(trends, `B${statusStart + 2}:B${statusStart + report.statusBreakdown.length + 1}`, COLORS.blue);
  } else noData(trends, `A${statusStart + 1}:C${statusStart + 3}`, "No trip status data in this period.");

  detailSheet(book, "Trip Details", ["Trip ID", "Started", "Completed", "Vehicle", "Plate", "Driver", "Route", "Status", "Distance (km)", "Duration (min)", "On time", "Customer rating", "Smooth score", "Cost/km"], (report.trips || []).map((row) => [row.trip_id, instant(row.start_time), instant(row.end_time), safeText(row.vehicles?.vehicle_name || row.vehicle_id), safeText(row.vehicles?.plate_number || "Unknown"), safeText(row.driver_name || "Unknown"), safeText(row.route_name), safeText(row.trip_status || "Unknown"), number(row.distance), row.actual_duration == null ? null : number(row.actual_duration), row.on_time_completion == null ? null : Boolean(row.on_time_completion), row.customer_rating == null ? null : number(row.customer_rating), row.smooth_driving_score == null ? null : number(row.smooth_driving_score), row.cost_per_km == null ? null : number(row.cost_per_km)]), [10, 20, 20, 24, 15, 24, 24, 18, 16, 16, 12, 16, 14, 14]);
  const tripDetails = book.getWorksheet("Trip Details");
  [2, 3].forEach((column) => { tripDetails.getColumn(column).numFmt = "yyyy-mm-dd hh:mm"; });
  tripDetails.getColumn(9).numFmt = "0.00";
  addDataBar(tripDetails, `I2:I${Math.max(2, tripDetails.rowCount)}`, COLORS.blue);
  detailSheet(book, "Vehicle Roster", ["Vehicle ID", "Plate", "Vehicle", "Current status", "Trip records", "Distance (km)", "Activity flag"], (report.vehicleRoster || []).map((row) => {
    const active = vehicles.find((item) => item.vehicle_id === row.vehicle_id);
    return [row.vehicle_id, safeText(row.plate_number), safeText(row.vehicle_name), safeText(row.vehicle_status), active?.trips || 0, active?.distance || 0, active ? "Activity recorded" : "No activity in period"];
  }), [12, 15, 28, 20, 14, 16, 24]);
  const roster = book.getWorksheet("Vehicle Roster");
  addDataBar(roster, `F2:F${Math.max(2, roster.rowCount)}`, COLORS.teal);
  textStatus(roster, `G2:G${Math.max(2, roster.rowCount)}`, [["Activity recorded", "DCFCE7", COLORS.green], ["No activity in period", "FEF3C7", COLORS.amber]]);
  return writeWorkbook(book, [
    nativeChart("Summary", "Recorded distance by vehicle (km)", `B17:B${16 + Math.min(10, vehicles.length)}`, Math.min(10, vehicles.length), [chartSeries("F16", `F17:F${16 + Math.min(10, vehicles.length)}`, COLORS.blue)], { direction: "bar", numberFormat: "#,##0", anchor: { from: { col: 9, row: 14 }, to: { col: 17, row: 30 } } }),
    nativeChart("Analysis", "Trip records by vehicle", `B6:B${vehicles.length + 5}`, vehicles.length, [chartSeries("E5", `E6:E${vehicles.length + 5}`, COLORS.blue)], { direction: "bar", numberFormat: "#,##0", anchor: { from: { col: 9, row: 3 }, to: { col: 17, row: 19 } } }),
    nativeChart("Trends", "Monthly fleet distance (km)", `A5:A${(report.monthlyData || []).length + 4}`, (report.monthlyData || []).length, [chartSeries("C4", `C5:C${(report.monthlyData || []).length + 4}`, COLORS.teal)], { type: "line", numberFormat: "#,##0", anchor: { from: { col: 7, row: 3 }, to: { col: 15, row: 19 } } }),
  ]);
}

export async function buildDriverPerformanceWorkbook(report, { from, to }) {
  const book = workbook("Driver Performance");
  const summary = baseSummary(book, "Summary", "Driver Performance Scorecard", from, to);
  const details = report.details || [];
  const scored = details.filter((row) => row.total_trips > 0 && row.performance_score > 0);
  const totalDistance = report.totalDistance || details.reduce((sum, row) => sum + (row.total_distance || 0), 0);
  kpi(summary, 5, 1, "Driver roster", report.totalDrivers, "0");
  kpi(summary, 5, 3, "Scored drivers", scored.length, "0");
  kpi(summary, 5, 5, "Average performance score", report.avgScore || null, "0");
  kpi(summary, 5, 7, "Completed trips", report.totalTrips, "0");
  kpi(summary, 9, 1, "Distance recorded", totalDistance, '0.00 "km"');
  kpi(summary, 9, 3, "Drivers with incidents", details.filter((row) => row.incidents > 0).length, "0");
  methodology(summary, 14, report.methodology);

  const analysis = book.addWorksheet("Analysis", { properties: { tabColor: { argb: COLORS.blue } } });
  styleTitle(analysis, "A1:K2", "Driver Rankings & Scorecard", COLORS.blue);
  analysis.mergeCells("A3:K3");
  analysis.getCell("A3").value = "Score, rating, on-time rate, distance and cost/km are blank when a driver has no completed-trip measurements. The assessment and rank columns are editable formulas.";
  analysis.getCell("A3").font = { size: 10, italic: true, color: { argb: COLORS.muted } };
  analysis.getCell("A3").alignment = { wrapText: true };
  analysis.addRow([]);
  analysis.addRow(["Rank", "Driver", "Status", "Completed trips", "Distance (km)", "Performance score", "Customer rating", "On-time rate", "Incidents", "Cost/km", "Assessment"]);
  styleHeader(analysis.getRow(5), COLORS.blue);
  details.forEach((item, index) => {
    const rowNumber = index + 6;
    const measured = item.total_trips > 0;
    const line = analysis.addRow([null, safeText(item.name), safeText(item.driver_status || "Unknown"), item.total_trips, measured ? item.total_distance : null, measured ? item.performance_score : null, measured ? item.rating : null, measured ? item.on_time_rate : null, item.incidents, measured ? item.cost_per_km : null, null]);
    formula(line.getCell(1), `IF(F${rowNumber}="","",RANK.EQ(F${rowNumber},$F$6:$F$${Math.max(6, details.length + 5)}))`, measured && item.performance_score > 0 ? index + 1 : null, "0");
    formula(line.getCell(11), `IF(OR(D${rowNumber}=0,F${rowNumber}=""),"Insufficient data",IF(F${rowNumber}>=70,"Strong",IF(F${rowNumber}>=40,"Monitor","Needs review")))`, measured && item.performance_score != null ? (item.performance_score >= 70 ? "Strong" : item.performance_score >= 40 ? "Monitor" : "Needs review") : "Insufficient data");
    line.getCell(6).numFmt = "0.0";
    line.getCell(7).numFmt = "0.0";
    line.getCell(8).numFmt = "0.0%";
    line.getCell(10).numFmt = 'PHP #,##0.00';
  });
  finishTable(analysis, [9, 26, 18, 16, 16, 18, 18, 14, 12, 14, 18], 5, Math.max(5, details.length + 5));
  if (details.length) {
    addDataBar(analysis, `F6:F${details.length + 5}`, COLORS.blue);
    addColorScale(analysis, `H6:H${details.length + 5}`);
    addIconSet(analysis, `I6:I${details.length + 5}`);
    textStatus(analysis, `K6:K${details.length + 5}`, [["Strong", "DCFCE7", COLORS.green], ["Monitor", "FEF3C7", COLORS.amber], ["Needs review", "FEE2E2", COLORS.red], ["Insufficient data", "F8FAFC", COLORS.muted]]);
  } else noData(analysis, "A6:K8", "No drivers in this period.");

  const summaryStart = 19;
  section(summary, summaryStart, 8, "Top driver performance", COLORS.blue);
  const summaryHeader = summary.addRow(["Rank", "Driver", "Status", "Completed trips", "Distance (km)", "Score", "On-time rate", "Assessment"]);
  styleHeader(summaryHeader, COLORS.blue);
  details.slice(0, 10).forEach((item, index) => {
    const target = summary.addRow(Array.from({ length: 8 }, () => null));
    const sourceRow = index + 6;
    const measured = item.total_trips > 0;
    const values = [index + 1, item.name, item.driver_status, item.total_trips, measured ? item.total_distance : null, measured ? item.performance_score : null, measured ? item.on_time_rate : null, measured && item.performance_score != null ? (item.performance_score >= 70 ? "Strong" : item.performance_score >= 40 ? "Monitor" : "Needs review") : "Insufficient data"];
    values.forEach((value, column) => formula(target.getCell(column + 1), `'Analysis'!${String.fromCharCode(65 + column)}${sourceRow}`, value, column === 6 ? "0.0%" : null));
  });
  if (details.length) {
    styleBody(summary, summaryStart + 2, summaryStart + details.slice(0, 10).length + 1);
    addDataBar(summary, `F${summaryStart + 2}:F${summaryStart + details.slice(0, 10).length + 1}`, COLORS.blue);
  } else noData(summary, `A${summaryStart + 1}:H${summaryStart + 3}`, "No drivers in this period.");

  const trends = book.addWorksheet("Trends", { properties: { tabColor: { argb: COLORS.teal } } });
  styleTitle(trends, "A1:D2", "Driver Performance Trends", COLORS.teal);
  trends.addRow([]);
  trends.addRow(["Month", "Completed trips", "Distance (km)", "Average km/trip"]);
  styleHeader(trends.getRow(4), COLORS.teal);
  (report.monthlyData || []).forEach((row, index) => {
    const rowNumber = index + 5;
    const line = trends.addRow([row.month, row.trips, row.distance, null]);
    formula(line.getCell(4), `IF(B${rowNumber}=0,"",C${rowNumber}/B${rowNumber})`, row.trips ? row.distance / row.trips : null, "0.00");
  });
  finishTable(trends, [16, 18, 16, 18], 4, Math.max(4, (report.monthlyData || []).length + 4));
  if (report.monthlyData?.length) addDataBar(trends, `C5:C${report.monthlyData.length + 4}`, COLORS.teal);
  else noData(trends, "A5:D7", "No completed-trip trend in this period.");

  detailSheet(book, "Driver Details", ["Driver ID", "Driver", "Status", "Completed trips", "Distance (km)", "Performance score", "Customer rating", "On-time rate", "Incidents", "Cost/km"], details.map((item) => [item.driver_id, safeText(item.name), safeText(item.driver_status || "Unknown"), item.total_trips, item.total_trips ? item.total_distance : null, item.total_trips ? item.performance_score : null, item.total_trips ? item.rating : null, item.total_trips ? item.on_time_rate : null, item.incidents, item.total_trips ? item.cost_per_km : null]), [12, 26, 18, 16, 16, 18, 18, 14, 12, 14]);
  const driverDetails = book.getWorksheet("Driver Details");
  driverDetails.getColumn(8).numFmt = "0.0%";
  driverDetails.getColumn(10).numFmt = 'PHP #,##0.00';
  addDataBar(driverDetails, `F2:F${Math.max(2, driverDetails.rowCount)}`, COLORS.blue);
  detailSheet(book, "Incidents", ["Incident ID", "Date", "Driver", "Plate", "Type", "Severity", "Status", "Expense", "Description"], (report.incidents || []).map((row) => [row.incident_id, instant(row.incident_date), safeText(row.driver_name), safeText(row.plate_number), safeText(row.incident_type), safeText(row.severity), safeText(row.status), row.expense_amount == null ? null : number(row.expense_amount), safeText(row.description)]), [12, 20, 24, 15, 24, 14, 14, 16, 42]);
  const incidents = book.getWorksheet("Incidents");
  incidents.getColumn(2).numFmt = "yyyy-mm-dd hh:mm";
  incidents.getColumn(8).numFmt = 'PHP #,##0.00';
  addDataBar(incidents, `H2:H${Math.max(2, incidents.rowCount)}`, COLORS.red);
  return writeWorkbook(book, [
    nativeChart("Summary", "Driver performance score", `B21:B${20 + Math.min(10, details.length)}`, Math.min(10, details.length), [chartSeries("F20", `F21:F${20 + Math.min(10, details.length)}`, COLORS.blue)], { direction: "bar", numberFormat: "0.0", anchor: { from: { col: 9, row: 18 }, to: { col: 17, row: 34 } } }),
    nativeChart("Analysis", "On-time completion rate by driver", `B6:B${details.length + 5}`, details.length, [chartSeries("H5", `H6:H${details.length + 5}`, COLORS.teal)], { direction: "bar", numberFormat: "0%", anchor: { from: { col: 12, row: 3 }, to: { col: 20, row: 19 } } }),
    nativeChart("Trends", "Monthly completed trips", `A5:A${(report.monthlyData || []).length + 4}`, (report.monthlyData || []).length, [chartSeries("B4", `B5:B${(report.monthlyData || []).length + 4}`, COLORS.teal)], { type: "line", numberFormat: "#,##0", anchor: { from: { col: 5, row: 3 }, to: { col: 13, row: 19 } } }),
  ]);
}

function costMonthly(report) {
  const map = new Map();
  const add = (date, key, amount) => {
    const month = monthOf(date);
    if (month === "Unknown") return;
    const row = map.get(month) || { month, fuel: 0, maintenance: 0, distance: 0 };
    row[key] += amount;
    map.set(month, row);
  };
  (report.fuelRecords || []).forEach((row) => add(row.fuel_date, "fuel", number(row.amount)));
  (report.maintenanceRecords || []).forEach((row) => add(row.maintenance_date, "maintenance", number(row.cost)));
  (report.trips || []).forEach((row) => add(row.start_time, "distance", number(row.distance)));
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export async function buildFleetCostWorkbook(report, { from, to }) {
  const book = workbook("Fleet Cost");
  const summary = baseSummary(book, "Summary", "Fleet Cost by Vehicle", from, to);
  const totals = report.totals || {};
  const costRows = (report.fuelRecords?.length || 0) + (report.maintenanceRecords?.length || 0) + (report.trips?.length || 0);
  kpi(summary, 5, 1, "Total recorded cost", costRows ? totals.total_cost : null, 'PHP #,##0.00');
  kpi(summary, 5, 3, "Recorded fuel cost", report.fuelRecords?.length ? totals.fuel_cost : null, 'PHP #,##0.00');
  kpi(summary, 5, 5, "Recorded maintenance cost", report.maintenanceRecords?.length ? totals.maintenance_cost : null, 'PHP #,##0.00');
  kpi(summary, 5, 7, "Cost per km", totals.distance ? totals.cost_per_km : null, 'PHP #,##0.00', `IF(A10=0,"",A6/A10)`);
  kpi(summary, 9, 1, "Distance recorded", report.trips?.length ? totals.distance : null, '0.00 "km"');
  kpi(summary, 9, 3, "Vehicles with recorded spend", (report.details || []).filter((row) => row.total_cost > 0).length, "0");
  methodology(summary, 14, report.methodology);

  const analysis = book.addWorksheet("Analysis", { properties: { tabColor: { argb: COLORS.blue } } });
  styleTitle(analysis, "A1:I2", "Vehicle Cost Analysis", COLORS.blue);
  analysis.mergeCells("A3:I3");
  analysis.getCell("A3").value = "Total cost and cost/km are workbook formulas. Cost/km is blank when no distance is recorded, rather than presenting a misleading zero.";
  analysis.getCell("A3").font = { size: 10, italic: true, color: { argb: COLORS.muted } };
  analysis.getCell("A3").alignment = { wrapText: true };
  analysis.addRow([]);
  analysis.addRow(["Rank", "Vehicle", "Plate", "Fuel cost", "Maintenance cost", "Total cost", "Distance (km)", "Cost/km", "Spend share"]);
  styleHeader(analysis.getRow(5), COLORS.blue);
  const rows = report.details || [];
  const totalCost = totals.total_cost || 0;
  rows.forEach((item, index) => {
    const rowNumber = index + 6;
    const line = analysis.addRow([index + 1, safeText(item.vehicle), safeText(item.plate_number), item.fuel_cost, item.maintenance_cost, null, item.distance, null, null]);
    formula(line.getCell(6), `D${rowNumber}+E${rowNumber}`, item.fuel_cost + item.maintenance_cost, 'PHP #,##0.00');
    formula(line.getCell(8), `IF(G${rowNumber}=0,"",F${rowNumber}/G${rowNumber})`, item.distance ? item.total_cost / item.distance : null, 'PHP #,##0.00');
    formula(line.getCell(9), `IF(SUM($F$6:$F$${Math.max(6, rows.length + 5)})=0,"",F${rowNumber}/SUM($F$6:$F$${Math.max(6, rows.length + 5)}))`, totalCost ? item.total_cost / totalCost : null, "0.0%");
    [4, 5, 6, 8].forEach((column) => { line.getCell(column).numFmt = 'PHP #,##0.00'; });
    line.getCell(9).numFmt = "0.0%";
  });
  finishTable(analysis, [9, 28, 15, 16, 20, 16, 16, 14, 14], 5, Math.max(5, rows.length + 5));
  if (rows.length) {
    addDataBar(analysis, `F6:F${rows.length + 5}`, COLORS.blue);
    addDataBar(analysis, `G6:G${rows.length + 5}`, COLORS.teal);
    addColorScale(analysis, `H6:H${rows.length + 5}`);
  } else noData(analysis, "A6:I8", "No vehicle cost records in this period.");

  const summaryStart = 19;
  section(summary, summaryStart, 8, "Cost by vehicle", COLORS.blue);
  const summaryHeader = summary.addRow(["Rank", "Vehicle", "Plate", "Fuel cost", "Maintenance cost", "Total cost", "Distance (km)", "Cost/km"]);
  styleHeader(summaryHeader, COLORS.blue);
  rows.slice(0, 10).forEach((item, index) => {
    const target = summary.addRow(Array.from({ length: 8 }, () => null));
    const sourceRow = index + 6;
    const values = [index + 1, item.vehicle, item.plate_number, item.fuel_cost, item.maintenance_cost, item.total_cost, item.distance, item.distance ? item.total_cost / item.distance : null];
    values.forEach((value, column) => formula(target.getCell(column + 1), `'Analysis'!${String.fromCharCode(65 + column)}${sourceRow}`, value, [3, 4, 5, 7].includes(column) ? 'PHP #,##0.00' : null));
  });
  if (rows.length) {
    styleBody(summary, summaryStart + 2, summaryStart + rows.slice(0, 10).length + 1);
    addDataBar(summary, `F${summaryStart + 2}:F${summaryStart + rows.slice(0, 10).length + 1}`, COLORS.blue);
  } else noData(summary, `A${summaryStart + 1}:H${summaryStart + 3}`, "No vehicle cost records in this period.");

  const trends = book.addWorksheet("Trends", { properties: { tabColor: { argb: COLORS.teal } } });
  styleTitle(trends, "A1:F2", "Fleet Cost Trends", COLORS.teal);
  trends.addRow([]);
  trends.addRow(["Month", "Fuel cost", "Maintenance cost", "Total cost", "Distance (km)", "Cost/km"]);
  styleHeader(trends.getRow(4), COLORS.teal);
  const monthly = costMonthly(report);
  monthly.forEach((row, index) => {
    const rowNumber = index + 5;
    const line = trends.addRow([row.month, row.fuel, row.maintenance, null, row.distance, null]);
    formula(line.getCell(4), `B${rowNumber}+C${rowNumber}`, row.fuel + row.maintenance, 'PHP #,##0.00');
    formula(line.getCell(6), `IF(E${rowNumber}=0,"",D${rowNumber}/E${rowNumber})`, row.distance ? (row.fuel + row.maintenance) / row.distance : null, 'PHP #,##0.00');
    [2, 3, 4, 6].forEach((column) => { line.getCell(column).numFmt = 'PHP #,##0.00'; });
  });
  finishTable(trends, [16, 16, 20, 16, 16, 14], 4, Math.max(4, monthly.length + 4));
  if (monthly.length) addDataBar(trends, `D5:D${monthly.length + 4}`, COLORS.teal);
  else noData(trends, "A5:F7", "No cost activity in this period.");

  detailSheet(book, "Vehicle Costs", ["Vehicle ID", "Plate", "Vehicle", "Fuel cost", "Maintenance cost", "Total cost", "Distance (km)", "Cost/km"], rows.map((item) => [item.vehicle_id, safeText(item.plate_number), safeText(item.vehicle), item.fuel_cost, item.maintenance_cost, item.total_cost, item.distance, item.distance ? item.cost_per_km : null]), [12, 15, 30, 16, 20, 16, 16, 14]);
  const vehicleCosts = book.getWorksheet("Vehicle Costs");
  [4, 5, 6, 8].forEach((column) => { vehicleCosts.getColumn(column).numFmt = 'PHP #,##0.00'; });
  addDataBar(vehicleCosts, `F2:F${Math.max(2, vehicleCosts.rowCount)}`, COLORS.blue);
  detailSheet(book, "Fuel Costs", ["Fuel record ID", "Date", "Vehicle", "Plate", "Fuel type", "Status", "Liters", "Amount", "Station"], (report.fuelRecords || []).map((row) => [row.fuel_record_id, day(row.fuel_date), row.vehicle_id, safeText(row.plate_number), safeText(row.fuel_type), safeText(row.status), number(row.liters), number(row.amount), safeText(row.station_name)]), [14, 14, 12, 15, 16, 14, 12, 16, 24]);
  const fuel = book.getWorksheet("Fuel Costs");
  fuel.getColumn(2).numFmt = "yyyy-mm-dd";
  fuel.getColumn(8).numFmt = 'PHP #,##0.00';
  addDataBar(fuel, `H2:H${Math.max(2, fuel.rowCount)}`, COLORS.amber);
  detailSheet(book, "Maintenance Costs", ["Maintenance ID", "Date", "Vehicle", "Plate", "Type", "Status", "Cost"], (report.maintenanceRecords || []).map((row) => [row.maintenance_id, day(row.maintenance_date), row.vehicle_id, safeText(row.plate_number), safeText(row.maintenance_type), safeText(row.status), number(row.cost)]), [16, 14, 12, 15, 20, 14, 16]);
  const maintenance = book.getWorksheet("Maintenance Costs");
  maintenance.getColumn(2).numFmt = "yyyy-mm-dd";
  maintenance.getColumn(7).numFmt = 'PHP #,##0.00';
  addDataBar(maintenance, `G2:G${Math.max(2, maintenance.rowCount)}`, COLORS.red);
  detailSheet(book, "Trip Distance", ["Trip ID", "Started", "Vehicle", "Plate", "Status", "Distance (km)"], (report.trips || []).map((row) => [row.trip_id, instant(row.start_time), row.vehicle_id, safeText(row.plate_number), safeText(row.trip_status), number(row.distance)]), [12, 20, 12, 15, 18, 16]);
  const trips = book.getWorksheet("Trip Distance");
  trips.getColumn(2).numFmt = "yyyy-mm-dd hh:mm";
  addDataBar(trips, `F2:F${Math.max(2, trips.rowCount)}`, COLORS.teal);
  return writeWorkbook(book, [
    nativeChart("Summary", "Total recorded cost by vehicle (PHP)", `B21:B${20 + Math.min(10, rows.length)}`, Math.min(10, rows.length), [chartSeries("F20", `F21:F${20 + Math.min(10, rows.length)}`, COLORS.blue)], { direction: "bar", numberFormat: '"PHP" #,##0', anchor: { from: { col: 9, row: 18 }, to: { col: 17, row: 34 } } }),
    nativeChart("Analysis", "Recorded cost per km by vehicle (PHP)", `B6:B${rows.length + 5}`, rows.length, [chartSeries("H5", `H6:H${rows.length + 5}`, COLORS.amber)], { direction: "bar", numberFormat: '"PHP" #,##0.00', anchor: { from: { col: 10, row: 3 }, to: { col: 18, row: 19 } } }),
    nativeChart("Trends", "Monthly operating cost components (PHP)", `A5:A${monthly.length + 4}`, monthly.length, [chartSeries("B4", `B5:B${monthly.length + 4}`, COLORS.amber), chartSeries("C4", `C5:C${monthly.length + 4}`, COLORS.red), chartSeries("D4", `D5:D${monthly.length + 4}`, COLORS.teal)], { type: "line", numberFormat: '"PHP" #,##0', anchor: { from: { col: 7, row: 3 }, to: { col: 15, row: 19 } } }),
  ]);
}

export async function buildFinancialWorkbook(report, { from, to }) {
  const book = workbook("Financial Summary");
  const summary = baseSummary(book, "Summary", "Financial Summary", from, to);
  const financialRows = (report.fuelRecords?.length || 0) + (report.maintenanceRecords?.length || 0) + (report.tripRecords?.length || 0);
  kpi(summary, 5, 1, "Total operating cost", financialRows ? report.totalCost : null, 'PHP #,##0.00');
  kpi(summary, 5, 3, "Fuel cost", report.fuelRecords?.length ? report.fuelCost : null, 'PHP #,##0.00');
  kpi(summary, 5, 5, "Maintenance cost", report.maintenanceRecords?.length ? report.maintCost : null, 'PHP #,##0.00');
  kpi(summary, 5, 7, "Cost per km", report.totalDistance ? report.costPerKm : null, 'PHP #,##0.00', `IF(A10=0,"",A6/A10)`);
  kpi(summary, 9, 1, "Distance recorded", report.tripRecords?.length ? report.totalDistance : null, '0.00 "km"');
  kpi(summary, 9, 3, "Fuel share", financialRows && report.totalCost ? report.fuelCost / report.totalCost : null, "0.0%", `IF(A6=0,"",C6/A6)`);
  methodology(summary, 14, report.methodology);

  const analysis = book.addWorksheet("Analysis", { properties: { tabColor: { argb: COLORS.blue } } });
  styleTitle(analysis, "A1:E2", "Operating Cost Allocation", COLORS.blue);
  analysis.mergeCells("A3:E3");
  analysis.getCell("A3").value = "Allocation percentages and totals are workbook formulas tied to the recorded fuel and maintenance costs shown below.";
  analysis.getCell("A3").font = { size: 10, italic: true, color: { argb: COLORS.muted } };
  analysis.addRow([]);
  analysis.addRow(["Component", "Recorded cost", "Share of total", "Source rows", "Label"]);
  styleHeader(analysis.getRow(5), COLORS.blue);
  const components = [["Fuel", report.fuelCost, (report.fuelRecords || []).length, "Fuel amounts"], ["Maintenance", report.maintCost, (report.maintenanceRecords || []).length, "Maintenance costs"]];
  components.forEach((component, index) => {
    const rowNumber = index + 6;
    const line = analysis.addRow([component[0], component[1], null, component[2], component[3]]);
    formula(line.getCell(3), `IF(SUM($B$6:$B$7)=0,"",B${rowNumber}/SUM($B$6:$B$7))`, report.totalCost ? component[1] / report.totalCost : null, "0.0%");
    line.getCell(2).numFmt = 'PHP #,##0.00';
  });
  finishTable(analysis, [20, 18, 16, 14, 24], 5, 7);
  addDataBar(analysis, "B6:B7", COLORS.blue);
  addColorScale(analysis, "C6:C7");

  const summaryStart = 19;
  section(summary, summaryStart, 5, "Operating cost allocation", COLORS.blue);
  const summaryHeader = summary.addRow(["Component", "Recorded cost", "Share of total", "Source rows", "Label"]);
  styleHeader(summaryHeader, COLORS.blue);
  components.forEach((component, index) => {
    const target = summary.addRow(Array.from({ length: 5 }, () => null));
    const sourceRow = index + 6;
    [1, 2, 3, 4, 5].forEach((column) => formula(target.getCell(column), `'Analysis'!${String.fromCharCode(64 + column)}${sourceRow}`, column === 1 ? component[0] : column === 2 ? component[1] : column === 3 ? (report.totalCost ? component[1] / report.totalCost : null) : column === 4 ? component[2] : component[3], column === 2 ? 'PHP #,##0.00' : column === 3 ? "0.0%" : null));
  });
  styleBody(summary, summaryStart + 2, summaryStart + components.length + 1);
  addDataBar(summary, `B${summaryStart + 2}:B${summaryStart + components.length + 1}`, COLORS.blue);

  const trends = book.addWorksheet("Trends", { properties: { tabColor: { argb: COLORS.teal } } });
  styleTitle(trends, "A1:F2", "Operating Cost Trends", COLORS.teal);
  trends.addRow([]);
  trends.addRow(["Month", "Fuel cost", "Maintenance cost", "Total cost", "Distance (km)", "Cost/km"]);
  styleHeader(trends.getRow(4), COLORS.teal);
  (report.monthlyData || []).forEach((row, index) => {
    const rowNumber = index + 5;
    const line = trends.addRow([row.month, row.fuelCost, row.maintenanceCost, null, row.distance, null]);
    formula(line.getCell(4), `B${rowNumber}+C${rowNumber}`, row.fuelCost + row.maintenanceCost, 'PHP #,##0.00');
    formula(line.getCell(6), `IF(E${rowNumber}=0,"",D${rowNumber}/E${rowNumber})`, row.distance ? (row.fuelCost + row.maintenanceCost) / row.distance : null, 'PHP #,##0.00');
    [2, 3, 4, 6].forEach((column) => { line.getCell(column).numFmt = 'PHP #,##0.00'; });
  });
  finishTable(trends, [16, 16, 22, 16, 16, 14], 4, Math.max(4, (report.monthlyData || []).length + 4));
  if (report.monthlyData?.length) addDataBar(trends, `D5:D${report.monthlyData.length + 4}`, COLORS.teal);
  else noData(trends, "A5:F7", "No financial activity in this period.");

  detailSheet(book, "Fuel Details", ["Fuel record ID", "Date", "Vehicle ID", "Status", "Liters", "Amount"], (report.fuelRecords || []).map((row) => [row.fuel_record_id, day(row.fuel_date), row.vehicle_id, safeText(row.status), number(row.liters), number(row.amount)]), [16, 14, 12, 14, 12, 16]);
  const fuel = book.getWorksheet("Fuel Details");
  fuel.getColumn(2).numFmt = "yyyy-mm-dd";
  fuel.getColumn(6).numFmt = 'PHP #,##0.00';
  addDataBar(fuel, `F2:F${Math.max(2, fuel.rowCount)}`, COLORS.amber);
  detailSheet(book, "Maintenance Details", ["Maintenance ID", "Date", "Vehicle ID", "Type", "Status", "Cost"], (report.maintenanceRecords || []).map((row) => [row.maintenance_id, day(row.maintenance_date), row.vehicle_id, safeText(row.maintenance_type), safeText(row.status), number(row.cost)]), [18, 14, 12, 20, 14, 16]);
  const maintenance = book.getWorksheet("Maintenance Details");
  maintenance.getColumn(2).numFmt = "yyyy-mm-dd";
  maintenance.getColumn(6).numFmt = 'PHP #,##0.00';
  addDataBar(maintenance, `F2:F${Math.max(2, maintenance.rowCount)}`, COLORS.red);
  detailSheet(book, "Trip Details", ["Trip ID", "Started", "Status", "Distance (km)", "Stored total cost"], (report.tripRecords || []).map((row) => [row.trip_id, instant(row.start_time), safeText(row.trip_status), number(row.distance), row.total_cost == null ? null : number(row.total_cost)]), [12, 20, 18, 16, 18]);
  const trips = book.getWorksheet("Trip Details");
  trips.getColumn(2).numFmt = "yyyy-mm-dd hh:mm";
  trips.getColumn(5).numFmt = 'PHP #,##0.00';
  addDataBar(trips, `D2:D${Math.max(2, trips.rowCount)}`, COLORS.teal);
  return writeWorkbook(book, [
    nativeChart("Summary", "Operating cost allocation (PHP)", "A21:A22", 2, [chartSeries("B20", "B21:B22", COLORS.blue)], { direction: "col", numberFormat: '"PHP" #,##0', anchor: { from: { col: 6, row: 18 }, to: { col: 14, row: 33 } } }),
    nativeChart("Analysis", "Share of total operating cost", "A6:A7", 2, [chartSeries("C5", "C6:C7", COLORS.teal)], { direction: "col", numberFormat: "0%", anchor: { from: { col: 6, row: 3 }, to: { col: 14, row: 18 } } }),
    nativeChart("Trends", "Monthly operating cost trend (PHP)", `A5:A${(report.monthlyData || []).length + 4}`, (report.monthlyData || []).length, [chartSeries("B4", `B5:B${(report.monthlyData || []).length + 4}`, COLORS.amber), chartSeries("C4", `C5:C${(report.monthlyData || []).length + 4}`, COLORS.red), chartSeries("D4", `D5:D${(report.monthlyData || []).length + 4}`, COLORS.teal)], { type: "line", numberFormat: '"PHP" #,##0', anchor: { from: { col: 7, row: 3 }, to: { col: 15, row: 19 } } }),
  ]);
}

export async function buildTripPerformanceWorkbook(report, { from, to }) {
  const book = workbook("Trip Performance");
  const summary = baseSummary(book, "Summary", "Trip Performance & Register", from, to);
  kpi(summary, 5, 1, "Trip records", report.totalTrips, "0");
  kpi(summary, 5, 3, "Completed trips", report.completedTrips, "0");
  kpi(summary, 5, 5, "Active trips", report.activeTrips, "0");
  kpi(summary, 5, 7, "Completion rate", report.completionRate, "0.0%", `IF(A6=0,"",C6/A6)`);
  kpi(summary, 9, 1, "Cancelled trips", report.cancelledTrips, "0");
  kpi(summary, 9, 3, "Distance recorded", report.totalDistance, '0.00 "km"');
  kpi(summary, 9, 5, "Average distance", report.averageDistance, '0.00 "km"', `IF(A6=0,"",C10/A6)`);
  methodology(summary, 14, report.methodology);

  const analysis = book.addWorksheet("Analysis", { properties: { tabColor: { argb: COLORS.blue } } });
  styleTitle(analysis, "A1:E2", "Trip Status Analysis", COLORS.blue);
  analysis.mergeCells("A3:E3");
  analysis.getCell("A3").value = "Completion and distance summaries are formula-driven from the status groups and trip rows in this workbook.";
  analysis.getCell("A3").font = { size: 10, italic: true, color: { argb: COLORS.muted } };
  analysis.addRow([]);
  analysis.addRow(["Status", "Trip records", "Distance (km)", "Share of trips", "Average distance"]);
  styleHeader(analysis.getRow(5), COLORS.blue);
  const statuses = report.statusBreakdown || [];
  statuses.forEach((row, index) => {
    const rowNumber = index + 6;
    const line = analysis.addRow([safeText(row.status), row.trips, row.distance, null, null]);
    formula(line.getCell(4), `IF(SUM($B$6:$B$${Math.max(6, statuses.length + 5)})=0,"",B${rowNumber}/SUM($B$6:$B$${Math.max(6, statuses.length + 5)}))`, report.totalTrips ? row.trips / report.totalTrips : null, "0.0%");
    formula(line.getCell(5), `IF(B${rowNumber}=0,"",C${rowNumber}/B${rowNumber})`, row.trips ? row.distance / row.trips : null, "0.00");
  });
  finishTable(analysis, [22, 16, 16, 16, 18], 5, Math.max(5, statuses.length + 5));
  if (statuses.length) { addDataBar(analysis, "B6:B1000", COLORS.blue); addColorScale(analysis, "D6:D1000"); }
  else noData(analysis, "A6:E8", "No trip records in this period.");

  const summaryStart = 19;
  section(summary, summaryStart, 5, "Trip status breakdown", COLORS.blue);
  const summaryHeader = summary.addRow(["Status", "Trip records", "Distance (km)", "Share of trips", "Average distance"]);
  styleHeader(summaryHeader, COLORS.blue);
  statuses.forEach((row, index) => {
    const target = summary.addRow(Array.from({ length: 5 }, () => null));
    const sourceRow = index + 6;
    [1, 2, 3, 4, 5].forEach((column) => formula(target.getCell(column), `'Analysis'!${String.fromCharCode(64 + column)}${sourceRow}`, column === 1 ? row.status : column === 2 ? row.trips : column === 3 ? row.distance : column === 4 ? (report.totalTrips ? row.trips / report.totalTrips : null) : (row.trips ? row.distance / row.trips : null), column === 4 ? "0.0%" : column === 5 ? "0.00" : null));
  });
  if (statuses.length) { styleBody(summary, summaryStart + 2, summaryStart + statuses.length + 1); addDataBar(summary, `B${summaryStart + 2}:B${summaryStart + statuses.length + 1}`, COLORS.blue); }
  else noData(summary, `A${summaryStart + 1}:E${summaryStart + 3}`, "No trip records in this period.");

  const trends = book.addWorksheet("Trends", { properties: { tabColor: { argb: COLORS.teal } } });
  styleTitle(trends, "A1:D2", "Trip Performance Trends", COLORS.teal);
  trends.addRow([]);
  trends.addRow(["Month", "Trip records", "Distance (km)", "Average km/trip"]);
  styleHeader(trends.getRow(4), COLORS.teal);
  (report.monthlyData || []).forEach((row, index) => {
    const rowNumber = index + 5;
    const line = trends.addRow([row.month, row.trips, row.distance, null]);
    formula(line.getCell(4), `IF(B${rowNumber}=0,"",C${rowNumber}/B${rowNumber})`, row.trips ? row.distance / row.trips : null, "0.00");
  });
  finishTable(trends, [16, 16, 16, 18], 4, Math.max(4, (report.monthlyData || []).length + 4));
  if (report.monthlyData?.length) addDataBar(trends, `C5:C${report.monthlyData.length + 4}`, COLORS.teal);
  else noData(trends, "A5:D7", "No monthly trip activity in this period.");

  detailSheet(book, "Details", ["Trip ID", "Started", "Completed", "Vehicle", "Plate", "Driver", "Route", "Status", "Distance (km)", "Duration (min)", "On-time", "Customer rating", "Smooth score", "Cost/km", "Total cost", "Notes"], (report.trips || []).map((row) => [row.trip_id, instant(row.start_time), instant(row.end_time), safeText(row.vehicles?.vehicle_name || row.vehicle_id), safeText(row.vehicles?.plate_number || "Unknown"), safeText(row.drivers ? `${row.drivers.first_name || ""} ${row.drivers.last_name || ""}`.trim() : "Unknown"), safeText(row.routes?.route_name), safeText(row.trip_status), number(row.distance), row.actual_duration == null ? null : number(row.actual_duration), row.on_time_completion == null ? null : Boolean(row.on_time_completion), row.customer_rating == null ? null : number(row.customer_rating), row.smooth_driving_score == null ? null : number(row.smooth_driving_score), row.cost_per_km == null ? null : number(row.cost_per_km), row.total_cost == null ? null : number(row.total_cost), safeText(row.notes)]), [10, 20, 20, 24, 15, 24, 24, 18, 16, 16, 12, 16, 14, 14, 16, 36]);
  const details = book.getWorksheet("Details");
  [2, 3].forEach((column) => { details.getColumn(column).numFmt = "yyyy-mm-dd hh:mm"; });
  details.getColumn(9).numFmt = "0.00";
  details.getColumn(14).numFmt = 'PHP #,##0.00';
  details.getColumn(15).numFmt = 'PHP #,##0.00';
  addDataBar(details, `I2:I${Math.max(2, details.rowCount)}`, COLORS.blue);
  return writeWorkbook(book, [
    nativeChart("Summary", "Trip records by status", `A21:A${20 + statuses.length}`, statuses.length, [chartSeries("B20", `B21:B${20 + statuses.length}`, COLORS.blue)], { direction: "bar", numberFormat: "#,##0", anchor: { from: { col: 6, row: 18 }, to: { col: 14, row: 33 } } }),
    nativeChart("Analysis", "Recorded distance by trip status (km)", `A6:A${statuses.length + 5}`, statuses.length, [chartSeries("C5", `C6:C${statuses.length + 5}`, COLORS.teal)], { direction: "bar", numberFormat: "#,##0", anchor: { from: { col: 6, row: 3 }, to: { col: 14, row: 18 } } }),
    nativeChart("Trends", "Monthly trip distance (km)", `A5:A${(report.monthlyData || []).length + 4}`, (report.monthlyData || []).length, [chartSeries("C4", `C5:C${(report.monthlyData || []).length + 4}`, COLORS.teal)], { type: "line", numberFormat: "#,##0", anchor: { from: { col: 5, row: 3 }, to: { col: 13, row: 19 } } }),
  ]);
}

export async function buildIncidentWorkbook(report, { from, to }) {
  const book = workbook("Incident Registry");
  const summary = baseSummary(book, "Summary", "Fleet Incident Registry", from, to);
  const expenseTotal = (report.incidents || []).reduce((sum, row) => sum + number(row.expense_amount), 0);
  kpi(summary, 5, 1, "Total incidents", report.totalIncidents, "0");
  kpi(summary, 5, 3, "Open incidents", report.openIncidents, "0");
  kpi(summary, 5, 5, "Critical / major", report.criticalMajor, "0");
  kpi(summary, 5, 7, "Breakdown-type incidents", report.breakdowns, "0");
  kpi(summary, 9, 1, "Recorded expense", expenseTotal || null, 'PHP #,##0.00');
  methodology(summary, 14, report.methodology);
  const severities = report.bySeverity || [];
  const incidentStatuses = report.byStatus || [];

  section(summary, 19, 3, "Incidents by severity", COLORS.blue);
  const summaryHeader = summary.addRow(["Severity", "Incidents", "Share"]);
  styleHeader(summaryHeader, COLORS.blue);
  severities.forEach((row, index) => {
    const target = summary.addRow([safeText(row.severity), row.count, null]);
    formula(target.getCell(3), `IF(SUM($B$21:$B$${Math.max(21, severities.length + 20)})=0,"",B${index + 21}/SUM($B$21:$B$${Math.max(21, severities.length + 20)}))`, report.totalIncidents ? row.count / report.totalIncidents : null, "0.0%");
  });
  if (severities.length) { styleBody(summary, 21, severities.length + 20); addDataBar(summary, `B21:B${severities.length + 20}`, COLORS.red); }
  else noData(summary, "A21:C23", "No incident records in this period.");

  const analysis = book.addWorksheet("Analysis", { properties: { tabColor: { argb: COLORS.blue } } });
  styleTitle(analysis, "A1:H2", "Incident Analysis", COLORS.blue);
  analysis.mergeCells("A3:H3");
  analysis.getCell("A3").value = "Severity, status and type groups are direct classifications of stored incident fields. Counts do not infer severity from descriptions.";
  analysis.getCell("A3").font = { size: 10, italic: true, color: { argb: COLORS.muted } };
  analysis.addRow([]);
  section(analysis, 5, 3, "By severity", COLORS.blue);
  const severityHeader = analysis.addRow(["Severity", "Incidents", "Share"]);
  styleHeader(severityHeader, COLORS.blue);
  severities.forEach((row, index) => {
    const line = analysis.addRow([safeText(row.severity), row.count, null]);
    formula(line.getCell(3), `IF(SUM($B$7:$B$${Math.max(7, severities.length + 6)})=0,"",B${index + 7}/SUM($B$7:$B$${Math.max(7, severities.length + 6)}))`, report.totalIncidents ? row.count / report.totalIncidents : null, "0.0%");
  });
  finishTable(analysis, [22, 14, 14], 6, Math.max(6, severities.length + 6));
  const statusStart = Math.max(13, severities.length + 9);
  section(analysis, statusStart, 3, "By status", COLORS.teal);
  const statusHeader = analysis.addRow(["Status", "Incidents", "Share"]);
  styleHeader(statusHeader, COLORS.teal);
  incidentStatuses.forEach((row) => {
    const line = analysis.addRow([safeText(row.status), row.count, null]);
    const rowNumber = line.number;
    formula(line.getCell(3), `IF(SUM($B$${statusStart + 2}:$B$${statusStart + 1 + incidentStatuses.length})=0,"",B${rowNumber}/SUM($B$${statusStart + 2}:$B$${statusStart + 1 + incidentStatuses.length}))`, report.totalIncidents ? row.count / report.totalIncidents : null, "0.0%");
  });
  finishTable(analysis, [22, 14, 14], statusStart + 1, Math.max(statusStart + 1, statusStart + 1 + incidentStatuses.length));
  if (severities.length) addDataBar(analysis, `B7:B${severities.length + 6}`, COLORS.red);
  if (incidentStatuses.length) addColorScale(analysis, `C${statusStart + 2}:C${statusStart + 1 + incidentStatuses.length}`);

  const types = book.addWorksheet("Trends", { properties: { tabColor: { argb: COLORS.teal } } });
  styleTitle(types, "A1:D2", "Incident Trends & Types", COLORS.teal);
  types.addRow([]);
  types.addRow(["Month", "Incidents", "Incident type", "Count"]);
  styleHeader(types.getRow(4), COLORS.teal);
  const monthly = report.monthlyData || [];
  const byType = report.byType || [];
  const maxRows = Math.max(monthly.length, byType.length);
  for (let index = 0; index < maxRows; index += 1) types.addRow([monthly[index]?.month || "", monthly[index]?.count ?? "", byType[index]?.incident_type || "", byType[index]?.count ?? ""]);
  finishTable(types, [16, 14, 28, 14], 4, Math.max(4, maxRows + 4));
  if (maxRows) { addDataBar(types, `B5:B${maxRows + 4}`, COLORS.red); addDataBar(types, `D5:D${maxRows + 4}`, COLORS.teal); }
  else noData(types, "A5:D7", "No incident records in this period.");

  detailSheet(book, "Details", ["Incident ID", "Date", "Driver", "Plate", "Type", "Severity", "Status", "Trip ID", "Expense", "Location", "Latitude", "Longitude", "Description", "Actions taken", "Assistance", "Photo count"], (report.incidents || []).map((row) => [row.incident_id, instant(row.incident_date), safeText(row.driver_name), safeText(row.plate_number), safeText(row.incident_type), safeText(row.severity), safeText(row.status), row.trip_id, row.expense_amount == null ? null : number(row.expense_amount), safeText(row.location), row.latitude == null ? null : number(row.latitude), row.longitude == null ? null : number(row.longitude), safeText(row.description), safeText(row.actions_taken), Array.isArray(row.assistance_needed) ? safeText(row.assistance_needed.join(", ")) : "", Array.isArray(row.photo_urls) ? row.photo_urls.length : 0]), [14, 20, 24, 15, 26, 14, 14, 12, 16, 30, 14, 14, 44, 44, 32, 12]);
  const incidents = book.getWorksheet("Details");
  incidents.getColumn(2).numFmt = "yyyy-mm-dd hh:mm";
  incidents.getColumn(9).numFmt = 'PHP #,##0.00';
  addDataBar(incidents, `I2:I${Math.max(2, incidents.rowCount)}`, COLORS.red);
  textStatus(incidents, `F2:F${Math.max(2, incidents.rowCount)}`, [["Critical", "FEE2E2", COLORS.red], ["Major", "FED7AA", COLORS.red], ["Moderate", "FEF3C7", COLORS.amber], ["Minor", "DBEAFE", COLORS.blue]]);
  return writeWorkbook(book, [
    nativeChart("Summary", "Incidents by severity", `A21:A${severities.length + 20}`, severities.length, [chartSeries("B20", `B21:B${severities.length + 20}`, COLORS.red)], { direction: "bar", numberFormat: "#,##0", anchor: { from: { col: 5, row: 18 }, to: { col: 13, row: 33 } } }),
    nativeChart("Analysis", "Incident status mix", `A${statusStart + 2}:A${statusStart + 1 + incidentStatuses.length}`, incidentStatuses.length, [chartSeries(`C${statusStart + 1}`, `C${statusStart + 2}:C${statusStart + 1 + incidentStatuses.length}`, COLORS.blue)], { numberFormat: "0%", anchor: { from: { col: 4, row: 3 }, to: { col: 12, row: 18 } } }),
    nativeChart("Trends", "Monthly incident count", `A5:A${monthly.length + 4}`, monthly.length, [chartSeries("B4", `B5:B${monthly.length + 4}`, COLORS.red)], { type: "line", numberFormat: "#,##0", anchor: { from: { col: 5, row: 3 }, to: { col: 13, row: 19 } } }),
  ]);
}

export async function buildExecutiveWorkbook({ fleet, fuel, financial, drivers }, { from, to }) {
  const book = workbook("Executive Analytics");
  const summary = baseSummary(book, "Summary", "Fleet Telemetry & Executive Analytics", from, to);
  const executiveFinancialRows = (financial?.fuelRecords?.length || 0) + (financial?.maintenanceRecords?.length || 0) + (financial?.tripRecords?.length || 0);
  kpi(summary, 5, 1, "Current in-use rate", fleet?.fleetSize ? (fleet.utilization / 100) : null, "0%");
  kpi(summary, 5, 3, "Trip records", fleet?.totalTrips ?? null, "0");
  kpi(summary, 5, 5, "Distance recorded", fleet?.trips?.length ? fleet.totalDistance : null, '0.00 "km"');
  kpi(summary, 5, 7, "Estimated fuel efficiency", fuel?.estimatedEfficiency ?? null, '0.00 "km/L"');
  kpi(summary, 9, 1, "Fuel cost", financial?.fuelRecords?.length ? financial.fuelCost : null, 'PHP #,##0.00');
  kpi(summary, 9, 3, "Maintenance cost", financial?.maintenanceRecords?.length ? financial.maintCost : null, 'PHP #,##0.00');
  kpi(summary, 9, 5, "Total operating cost", executiveFinancialRows ? financial.totalCost : null, 'PHP #,##0.00');
  kpi(summary, 9, 7, "Average driver score", drivers?.avgScore || null, "0");
  methodology(summary, 14, "This workbook combines the same Fleet Activity, Fuel Consumption, Financial Summary and Driver Performance payloads used by the Analytics page. Fuel efficiency is estimated only when the fuel report's minimum-distance rule is met; missing measurements remain blank.");
  section(summary, 19, 3, "Operating cost mix", COLORS.blue);
  const costMixHeader = summary.addRow(["Component", "Recorded cost", "Share"]);
  styleHeader(costMixHeader, COLORS.blue);
  const costMix = [
    ["Fuel", financial?.fuelRecords?.length ? financial.fuelCost : null, "A10"],
    ["Maintenance", financial?.maintenanceRecords?.length ? financial.maintCost : null, "C10"],
  ];
  costMix.forEach(([label, value, source], index) => {
    const rowNumber = index + 21;
    const line = summary.addRow([safeText(label), null, null]);
    formula(line.getCell(2), `'Summary'!${source}`, value, 'PHP #,##0.00');
    formula(line.getCell(3), `IF(SUM($B$21:$B$22)=0,"",B${rowNumber}/SUM($B$21:$B$22))`, financial?.totalCost ? number(value) / financial.totalCost : null, "0.0%");
  });
  styleBody(summary, 21, 22);
  addDataBar(summary, "B21:B22", COLORS.blue);

  const analysis = book.addWorksheet("Analysis", { properties: { tabColor: { argb: COLORS.blue } } });
  styleTitle(analysis, "A1:D2", "Executive KPI Signals", COLORS.blue);
  analysis.addRow([]);
  analysis.addRow(["Signal", "Value", "Unit / rule", "Status"]);
  styleHeader(analysis.getRow(4), COLORS.blue);
  const signals = [
    ["Current in-use rate", fleet?.fleetSize ? fleet.utilization / 100 : null, "Current fleet status", fleet?.fleetSize ? "Available" : "Insufficient data"],
    ["Trip records", fleet?.totalTrips ?? null, "Selected start-time window", fleet?.totalTrips != null ? "Available" : "Insufficient data"],
    ["Estimated fuel efficiency", fuel?.estimatedEfficiency ?? null, "Completed distance / eligible fuel; 50 km minimum", fuel?.estimatedEfficiency == null ? "Insufficient data" : "Estimated"],
    ["Cost per km", financial?.costPerKm && financial.totalDistance ? financial.costPerKm : null, "Recorded fuel + maintenance / distance", financial?.totalDistance ? "Derived" : "Insufficient data"],
    ["Average driver score", drivers?.avgScore || null, "Scored completed trips", drivers?.avgScore ? "Derived" : "Insufficient data"],
  ];
  signals.forEach((row) => analysis.addRow([safeText(row[0]), row[1] == null ? "" : row[1], safeText(row[2]), safeText(row[3])]));
  finishTable(analysis, [28, 18, 48, 20], 4, 4 + signals.length);
  analysis.getColumn(2).numFmt = "0.00";
  analysis.getCell("B5").numFmt = "0.0%";
  if (signals.length) addColorScale(analysis, `B5:B${4 + signals.length}`);
  textStatus(analysis, `D5:D${4 + signals.length}`, [["Available", "DCFCE7", COLORS.green], ["Derived", "DBEAFE", COLORS.blue], ["Estimated", "FEF3C7", COLORS.amber], ["Insufficient data", "F8FAFC", COLORS.muted]]);

  const trends = book.addWorksheet("Trends", { properties: { tabColor: { argb: COLORS.teal } } });
  styleTitle(trends, "A1:G2", "Executive Trends", COLORS.teal);
  trends.addRow([]);
  trends.addRow(["Month", "Fuel liters", "Fuel cost", "Maintenance cost", "Total cost", "Distance (km)", "Cost/km"]);
  styleHeader(trends.getRow(4), COLORS.teal);
  const months = new Map();
  (fuel?.monthlyData || []).forEach((row) => months.set(row.month, { month: row.month, liters: number(row.liters), fuelCost: number(row.cost), maintenanceCost: 0, distance: number(row.distance) }));
  (financial?.monthlyData || []).forEach((row) => { const current = months.get(row.month) || { month: row.month, liters: 0, fuelCost: 0, maintenanceCost: 0, distance: 0 }; current.fuelCost = number(row.fuelCost); current.maintenanceCost = number(row.maintenanceCost); current.distance = number(row.distance); months.set(row.month, current); });
  const executiveMonths = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
  executiveMonths.forEach((row, index) => {
    const rowNumber = index + 5;
    const line = trends.addRow([row.month, row.liters, row.fuelCost, row.maintenanceCost, null, row.distance, null]);
    formula(line.getCell(5), `C${rowNumber}+D${rowNumber}`, row.fuelCost + row.maintenanceCost, 'PHP #,##0.00');
    formula(line.getCell(7), `IF(F${rowNumber}=0,"",E${rowNumber}/F${rowNumber})`, row.distance ? (row.fuelCost + row.maintenanceCost) / row.distance : null, 'PHP #,##0.00');
    line.getCell(2).numFmt = "0.00";
    [3, 4, 5, 7].forEach((column) => { line.getCell(column).numFmt = 'PHP #,##0.00'; });
  });
  finishTable(trends, [16, 14, 16, 20, 16, 16, 14], 4, Math.max(4, executiveMonths.length + 4));
  if (executiveMonths.length) { addDataBar(trends, `E5:E${executiveMonths.length + 4}`, COLORS.teal); addDataBar(trends, `F5:F${executiveMonths.length + 4}`, COLORS.blue); }
  else noData(trends, "A5:G7", "No monthly analytics activity in this period.");

  detailSheet(book, "Vehicle Activity", ["Rank", "Vehicle", "Plate", "Trip records", "Distance (km)", "Current status"], (fleet?.byVehicle || []).map((row, index) => [index + 1, safeText(row.vehicle), safeText(row.plate), row.trips, row.distance, safeText(row.vehicle_status)]), [9, 28, 15, 14, 16, 20]);
  const vehicles = book.getWorksheet("Vehicle Activity");
  addDataBar(vehicles, `E2:E${Math.max(2, vehicles.rowCount)}`, COLORS.blue);
  detailSheet(book, "Driver Leaderboard", ["Rank", "Driver", "Score", "Completed trips", "Rating"], (drivers?.topDrivers || []).map((row, index) => [index + 1, safeText(row.name), number(row.score), row.trips, row.rating == null ? null : number(row.rating)]), [9, 28, 14, 16, 14]);
  const leaderboard = book.getWorksheet("Driver Leaderboard");
  addDataBar(leaderboard, `C2:C${Math.max(2, leaderboard.rowCount)}`, COLORS.blue);
  return writeWorkbook(book, [
    nativeChart("Summary", "Recorded operating cost mix (PHP)", "A21:A22", 2, [chartSeries("B20", "B21:B22", COLORS.blue)], { numberFormat: '"PHP" #,##0', anchor: { from: { col: 5, row: 18 }, to: { col: 13, row: 33 } } }),
    nativeChart("Analysis", "Top vehicle activity by distance (km)", `B2:B${Math.min(10, (fleet?.byVehicle || []).length) + 1}`, Math.min(10, (fleet?.byVehicle || []).length), [chartSeries("E1", `E2:E${Math.min(10, (fleet?.byVehicle || []).length) + 1}`, COLORS.blue)], { sourceSheet: "Vehicle Activity", direction: "bar", numberFormat: "#,##0", anchor: { from: { col: 5, row: 3 }, to: { col: 13, row: 19 } } }),
    nativeChart("Trends", "Monthly total operating cost (PHP)", `A5:A${executiveMonths.length + 4}`, executiveMonths.length, [chartSeries("E4", `E5:E${executiveMonths.length + 4}`, COLORS.teal)], { type: "line", numberFormat: '"PHP" #,##0', anchor: { from: { col: 8, row: 3 }, to: { col: 16, row: 19 } } }),
  ]);
}
