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

const safeText = (value) => {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
};
const excelDay = (value) => {
  const [year, month, day] = String(value || "").slice(0, 10).split("-").map(Number);
  return year && month && day ? new Date(year, month - 1, day) : null;
};
const excelDateTime = (value) => value ? new Date(value) : null;

async function writeWorkbook(workbook, charts = []) {
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => row.eachCell((cell) => {
      if (typeof cell.numFmt === "string") cell.numFmt = cell.numFmt.replace(/^₱/, '"₱"');
    }));
    sheet.columns.forEach((column) => {
      if (typeof column.numFmt === "string") column.numFmt = column.numFmt.replace(/^₱/, '"₱"');
    });
  });
  return addNativeCharts(await workbook.xlsx.writeBuffer(), workbook, charts);
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

function styleTitle(sheet, range, title) {
  sheet.mergeCells(range);
  const cell = sheet.getCell(range.split(":")[0]);
  cell.value = title;
  cell.font = { name: "Aptos Display", size: 22, bold: true, color: { argb: COLORS.white } };
  cell.alignment = { vertical: "middle", horizontal: "left" };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.navy } };
}

function styleHeader(row) {
  row.height = 28;
  row.eachCell((cell) => {
    cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.navy } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: COLORS.border } } };
  });
}

function finishDetailSheet(sheet, widths, rowCount) {
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: `${sheet.getColumn(widths.length).letter}${Math.max(1, rowCount + 1)}` };
  sheet.getRow(1).height = 32;
  styleHeader(sheet.getRow(1));
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.height = 22;
    row.eachCell((cell) => {
      cell.font = { name: "Aptos", size: 10, color: { argb: COLORS.ink } };
      cell.alignment = { vertical: "middle" };
      cell.border = { bottom: { style: "hair", color: { argb: "E2E8F0" } } };
    });
  });
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

export async function buildFuelWorkbook(report, { from, to }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Fleet Management System";
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const summary = workbook.addWorksheet("Summary", { properties: { tabColor: { argb: COLORS.navy } } });
  summary.columns = Array.from({ length: 8 }, () => ({ width: 16 }));
  summary.getColumn(1).width = 20;
  summary.getColumn(8).width = 20;
  styleTitle(summary, "A1:H2", "Fuel Consumption & Estimated Efficiency");
  summary.mergeCells("A3:H3");
  summary.getCell("A3").value = `Reporting period: ${from} to ${to} · Generated ${new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date())}`;
  summary.getCell("A3").font = { name: "Aptos", size: 10, color: { argb: COLORS.muted } };
  summary.getCell("A3").alignment = { vertical: "middle" };

  const kpis = [
    ["Eligible fuel volume", report.totalLiters, "0.00 \"L\""],
    ["Approved fuel cost", report.totalCost, '₱#,##0.00'],
    ["Completed-trip distance", report.totalDistance, "0.00 \"km\""],
    ["Estimated period efficiency", report.estimatedEfficiency, '0.00 "km/L"'],
    ["Average price per liter", report.avgCost, '₱0.00 "per L"'],
    ["Eligible transactions", report.fuelTransactionCount, "0"],
    ["Completed trips", report.completedTrips, "0"],
    ["Vehicles lacking enough data", report.insufficientVehicleCount, "0"],
  ];
  kpis.forEach(([label, value, format], index) => {
    const group = index % 4;
    const row = index < 4 ? 6 : 9;
    const column = group * 2 + 1;
    const labelCell = summary.getCell(row, column);
    const valueCell = summary.getCell(row + 1, column);
    summary.mergeCells(row, column, row, column + 1);
    summary.mergeCells(row + 1, column, row + 1, column + 1);
    labelCell.value = label;
    labelCell.font = { name: "Aptos", size: 9, bold: true, color: { argb: COLORS.muted } };
    labelCell.alignment = { horizontal: "center", vertical: "middle" };
    labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.pale } };
    valueCell.value = value == null ? "Insufficient data" : value;
    valueCell.numFmt = value == null ? "General" : format;
    valueCell.font = { name: "Aptos Display", size: value == null ? 14 : 18, bold: true, color: { argb: value == null ? COLORS.amber : COLORS.navy } };
    valueCell.alignment = { horizontal: "center", vertical: "middle" };
    valueCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F8FAFC" } };
    summary.getRow(row).height = 24;
    summary.getRow(row + 1).height = 36;
  });

  summary.mergeCells("A12:H12");
  summary.getCell("A12").value = "Methodology and scope";
  summary.getCell("A12").font = { name: "Aptos", size: 11, bold: true, color: { argb: COLORS.white } };
  summary.getCell("A12").fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.teal } };
  summary.mergeCells("A13:H14");
  summary.getCell("A13").value = report.methodology;
  summary.getCell("A13").font = { name: "Aptos", size: 10, color: { argb: COLORS.ink } };
  summary.getCell("A13").alignment = { vertical: "middle", wrapText: true };
  summary.getCell("A13").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "ECFDF5" } };
  summary.getRow(13).height = 32;
  summary.getRow(14).height = 28;
  summary.mergeCells("A16:H16");
  summary.getCell("A16").value = "Estimated Efficiency vs Vehicle Baseline";
  summary.getCell("A16").font = { name: "Aptos", size: 11, bold: true, color: { argb: COLORS.white } };
  summary.getCell("A16").fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.blue } };
  if (report.byVehicle.length) {
    const comparisonHeader = summary.addRow(["Vehicle", "Plate", "Estimated km/L", "Vehicle baseline", "Variance vs baseline", "Status"]);
    styleHeader(comparisonHeader);
    report.byVehicle.slice(0, 8).forEach((item, index) => {
      const summaryRow = summary.addRow([null, null, null, null, null, null]);
      const analysisRow = index + 6;
      summaryRow.getCell(1).value = { formula: `'Analysis'!A${analysisRow}`, result: item.vehicle };
      summaryRow.getCell(2).value = { formula: `'Analysis'!B${analysisRow}`, result: item.plate_number };
      summaryRow.getCell(3).value = { formula: `'Analysis'!H${analysisRow}`, result: item.estimated_kmpl ?? "" };
      summaryRow.getCell(4).value = { formula: `'Analysis'!I${analysisRow}`, result: item.baseline_efficiency ?? "" };
      summaryRow.getCell(5).value = { formula: `'Analysis'!J${analysisRow}`, result: item.variance_percent == null ? "" : item.variance_percent / 100 };
      summaryRow.getCell(6).value = { formula: `'Analysis'!K${analysisRow}`, result: item.status };
      summaryRow.eachCell((cell) => {
        cell.font = { name: "Aptos", size: 10, color: { argb: COLORS.ink } };
        cell.alignment = { vertical: "middle" };
        cell.border = { bottom: { style: "hair", color: { argb: "E2E8F0" } } };
      });
      [3, 4].forEach((column) => { summaryRow.getCell(column).numFmt = "0.00"; });
      summaryRow.getCell(5).numFmt = "0.0%";
    });
    [28, 16, 18, 18, 22, 28, 12, 12].forEach((width, index) => { summary.getColumn(index + 1).width = width; });
    const comparisonEnd = 17 + Math.min(8, report.byVehicle.length);
    summary.addConditionalFormatting({
      ref: `C18:C${comparisonEnd}`,
      rules: [{ type: "colorScale", cfvo: [{ type: "min" }, { type: "max" }], color: [{ argb: COLORS.white }, { argb: COLORS.blue }] }],
    });
    summary.addConditionalFormatting({
      ref: `D18:D${comparisonEnd}`,
      rules: [{ type: "colorScale", cfvo: [{ type: "min" }, { type: "max" }], color: [{ argb: COLORS.white }, { argb: COLORS.amber }] }],
    });
    summary.addConditionalFormatting({
      ref: `E18:E${comparisonEnd}`,
      rules: [{ type: "colorScale", cfvo: [{ type: "min" }, { type: "percentile", value: 50 }, { type: "max" }], color: [{ argb: "FECACA" }, { argb: "FEF3C7" }, { argb: "BBF7D0" }] }],
    });
    summary.addConditionalFormatting({
      ref: `F18:F${comparisonEnd}`,
      rules: [
        { type: "expression", formulae: ['$F18="Below baseline"'], style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FEE2E2" }, fgColor: { argb: "FEE2E2" } }, font: { color: { argb: COLORS.red }, bold: true } } },
        { type: "expression", formulae: ['$F18="Meets or exceeds baseline"'], style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "DCFCE7" }, fgColor: { argb: "DCFCE7" } }, font: { color: { argb: COLORS.green }, bold: true } } },
      ],
    });
  } else {
    summary.mergeCells("A17:H20");
    summary.getCell("A17").value = "No vehicle reached the 50 km minimum with eligible fuel in this period; no comparison is shown.";
    summary.getCell("A17").alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    summary.getCell("A17").font = { italic: true, color: { argb: COLORS.muted } };
  }
  summary.views = [{ state: "frozen", ySplit: 3 }];
  summary.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 1 };

  const analysis = workbook.addWorksheet("Analysis", { properties: { tabColor: { argb: COLORS.blue } } });
  styleTitle(analysis, "A1:K2", "Vehicle Efficiency Analysis");
  analysis.mergeCells("A3:K3");
  analysis.getCell("A3").value = "Estimated efficiency is formula-driven from completed-trip distance and eligible actual fuel volume. Blank values mean the 50 km minimum was not met.";
  analysis.getCell("A3").font = { size: 10, italic: true, color: { argb: COLORS.muted } };
  analysis.getCell("A3").alignment = { wrapText: true };
  analysis.addRow([]);
  analysis.addRow(["Vehicle", "Plate", "Category", "Completed trips", "Distance (km)", "Eligible fuel (L)", "Fuel cost", "Estimated km/L", "Baseline km/L", "Variance", "Status"]);
  styleHeader(analysis.getRow(5));
  report.byVehicle.forEach((item, index) => {
    const rowNumber = index + 6;
    const row = analysis.addRow([
      safeText(item.vehicle), safeText(item.plate_number), safeText(item.category), item.trips,
      item.distance, item.liters, item.cost, null, item.baseline_efficiency, null, item.status,
    ]);
    row.getCell(8).value = { formula: `IF(OR(E${rowNumber}<50,F${rowNumber}<=0),"",E${rowNumber}/F${rowNumber})`, result: item.estimated_kmpl ?? "" };
    row.getCell(10).value = { formula: `IF(OR(H${rowNumber}="",I${rowNumber}<=0),"",(H${rowNumber}-I${rowNumber})/I${rowNumber})`, result: item.variance_percent == null ? "" : item.variance_percent / 100 };
    row.eachCell((cell) => {
      cell.font = { name: "Aptos", size: 10, color: { argb: COLORS.ink } };
      cell.border = { bottom: { style: "hair", color: { argb: "E2E8F0" } } };
      cell.alignment = { vertical: "middle" };
    });
    row.getCell(7).numFmt = '₱#,##0.00';
    [5, 6, 8, 9].forEach((column) => { row.getCell(column).numFmt = "0.00"; });
    row.getCell(10).numFmt = "0.0%";
  });
  [28, 16, 20, 16, 16, 18, 16, 18, 16, 14, 26].forEach((width, index) => { analysis.getColumn(index + 1).width = width; });
  const lastAnalysisRow = Math.max(6, report.byVehicle.length + 5);
  analysis.views = [{ state: "frozen", ySplit: 5 }];
  analysis.autoFilter = { from: "A5", to: `K${lastAnalysisRow}` };
  if (report.byVehicle.length) {
    analysis.addConditionalFormatting({
      ref: `H6:H${lastAnalysisRow}`,
      rules: [{ type: "colorScale", cfvo: [{ type: "min" }, { type: "max" }], color: [{ argb: COLORS.white }, { argb: COLORS.blue }] }],
    });
    analysis.addConditionalFormatting({
      ref: `I6:I${lastAnalysisRow}`,
      rules: [{ type: "colorScale", cfvo: [{ type: "min" }, { type: "max" }], color: [{ argb: COLORS.white }, { argb: COLORS.amber }] }],
    });
    analysis.addConditionalFormatting({
      ref: `J6:J${lastAnalysisRow}`,
      rules: [{ type: "colorScale", cfvo: [{ type: "min" }, { type: "percentile", value: 50 }, { type: "max" }], color: [{ argb: "FECACA" }, { argb: "FEF3C7" }, { argb: "BBF7D0" }] }],
    });
    analysis.addConditionalFormatting({
      ref: `K6:K${lastAnalysisRow}`,
      rules: [
        { type: "expression", formulae: ['$K6="Below baseline"'], style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FEE2E2" }, fgColor: { argb: "FEE2E2" } }, font: { color: { argb: COLORS.red }, bold: true } } },
        { type: "expression", formulae: ['$K6="Meets or exceeds baseline"'], style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "DCFCE7" }, fgColor: { argb: "DCFCE7" } }, font: { color: { argb: COLORS.green }, bold: true } } },
      ],
    });
  }
  analysis.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  const trends = workbook.addWorksheet("Trends", { properties: { tabColor: { argb: COLORS.teal } } });
  styleTitle(trends, "A1:F2", "Fuel Consumption & Estimated Efficiency Trends");
  trends.addRow([]);
  trends.addRow(["Month", "Eligible fuel (L)", "Approved fuel cost", "Completed distance (km)", "Completed trips", "Estimated km/L"]);
  styleHeader(trends.getRow(4));
  report.monthlyData.forEach((item, index) => {
    const rowNumber = index + 5;
    const row = trends.addRow([item.month, item.liters, item.cost, item.distance, item.trips, null]);
    row.getCell(6).value = { formula: `IF(OR(D${rowNumber}<50,B${rowNumber}<=0),"",D${rowNumber}/B${rowNumber})`, result: item.estimated_kmpl ?? "" };
    row.getCell(2).numFmt = '0.00 "L"';
    row.getCell(3).numFmt = '₱#,##0.00';
    row.getCell(4).numFmt = '0.00 "km"';
    row.getCell(6).numFmt = '0.00 "km/L"';
    row.eachCell((cell) => {
      cell.font = { name: "Aptos", size: 10, color: { argb: COLORS.ink } };
      cell.alignment = { vertical: "middle" };
      cell.border = { bottom: { style: "hair", color: { argb: "E2E8F0" } } };
    });
  });
  [16, 18, 20, 24, 18, 20].forEach((width, index) => { trends.getColumn(index + 1).width = width; });
  const lastTrendRow = Math.max(4, report.monthlyData.length + 4);
  trends.views = [{ state: "frozen", ySplit: 4 }];
  trends.autoFilter = { from: "A4", to: `F${lastTrendRow}` };
  trends.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  if (report.monthlyData.length) trends.addConditionalFormatting({
    ref: `F5:F${lastTrendRow}`,
    rules: [{ type: "colorScale", cfvo: [{ type: "min" }, { type: "max" }], color: [{ argb: COLORS.white }, { argb: COLORS.teal }] }],
  });
  else {
    trends.mergeCells("A5:F7");
    trends.getCell("A5").value = "No eligible fuel or completed-trip activity in this period.";
    trends.getCell("A5").font = { italic: true, color: { argb: COLORS.muted } };
    trends.getCell("A5").alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  }

  const fuel = workbook.addWorksheet("Fuel Details", { properties: { tabColor: { argb: COLORS.amber } } });
  fuel.addRow(["Fuel date", "Record ID", "Request ID", "Trip ID", "Vehicle", "Plate", "Driver", "Fuel type", "Liters", "Amount", "Price/L", "Odometer", "Station", "Review status", "Receipt transaction ID"]);
  report.fuelRecords.forEach((item) => fuel.addRow([
    excelDay(item.fuel_date), item.fuel_record_id, item.fuel_request_id, item.trip_id,
    safeText(item.vehicle_name), safeText(item.plate_number), safeText(item.driver_name), safeText(item.fuel_type),
    item.liters, item.amount, item.price_per_liter, item.odometer, safeText(item.station_name), item.status, safeText(item.receipt_transaction_id),
  ]));
  finishDetailSheet(fuel, [14, 12, 12, 10, 24, 14, 24, 14, 12, 16, 14, 14, 24, 16, 24], report.fuelRecords.length);
  fuel.getColumn(1).numFmt = "yyyy-mm-dd";
  [9, 11, 12].forEach((column) => { fuel.getColumn(column).numFmt = "0.00"; });
  fuel.getColumn(10).numFmt = '₱#,##0.00';

  const trips = workbook.addWorksheet("Trip Details", { properties: { tabColor: { argb: COLORS.teal } } });
  trips.addRow(["Trip ID", "Vehicle", "Plate", "Driver", "Route", "Origin", "Destination", "Started", "Completed", "Distance (km)", "Duration (min)", "Status"]);
  report.trips.forEach((item) => trips.addRow([
    item.trip_id, safeText(item.vehicle_name), safeText(item.plate_number), safeText(item.driver_name), safeText(item.route_name),
    safeText(item.origin), safeText(item.destination), excelDateTime(item.start_time), excelDateTime(item.end_time),
    item.distance, item.actual_duration, item.trip_status,
  ]));
  finishDetailSheet(trips, [10, 24, 14, 24, 24, 24, 24, 20, 20, 16, 16, 14], report.trips.length);
  [8, 9].forEach((column) => { trips.getColumn(column).numFmt = "yyyy-mm-dd hh:mm"; });
  trips.getColumn(10).numFmt = "0.00";

  const comparisonRows = Math.min(8, report.byVehicle.length);
  return writeWorkbook(workbook, [
    nativeChart("Summary", "Estimated efficiency vs vehicle baseline (km/L)", `A18:A${17 + comparisonRows}`, comparisonRows, [chartSeries("C17", `C18:C${17 + comparisonRows}`, COLORS.blue), chartSeries("D17", `D18:D${17 + comparisonRows}`, COLORS.amber)], { direction: "bar", numberFormat: "0.00", anchor: { from: { col: 8, row: 15 }, to: { col: 16, row: 31 } } }),
    nativeChart("Analysis", "Variance from vehicle baseline", `A6:A${report.byVehicle.length + 5}`, report.byVehicle.length, [chartSeries("J5", `J6:J${report.byVehicle.length + 5}`, COLORS.blue)], { direction: "bar", numberFormat: "0%", anchor: { from: { col: 12, row: 3 }, to: { col: 20, row: 19 } } }),
    nativeChart("Trends", "Monthly estimated fuel efficiency (km/L)", `A5:A${report.monthlyData.length + 4}`, report.monthlyData.length, [chartSeries("F4", `F5:F${report.monthlyData.length + 4}`, COLORS.teal)], { type: "line", numberFormat: "0.00", anchor: { from: { col: 7, row: 3 }, to: { col: 15, row: 19 } } }),
  ]);
}
