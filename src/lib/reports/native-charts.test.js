import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { addNativeCharts } from "./native-charts";

describe("native Excel charts", () => {
  it("adds an editable chart linked to worksheet ranges without media files", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Summary");
    sheet.addRows([["Month", "Cost"], ["2026-07", 120], ["2026-08", 180]]);

    const output = await addNativeCharts(await workbook.xlsx.writeBuffer(), workbook, [{
      sheet: "Summary",
      title: "Monthly cost (PHP)",
      categoryRange: "A2:A3",
      rowCount: 2,
      series: [{ nameCell: "B1", range: "B2:B3", color: "2563EB" }],
      type: "line",
      numberFormat: '"PHP" #,##0',
    }]);

    const zip = await JSZip.loadAsync(output);
    const chart = await zip.file("xl/charts/chart1.xml").async("string");
    const worksheet = await zip.file("xl/worksheets/sheet1.xml").async("string");
    expect(chart).toContain("&apos;Summary&apos;!$A$2:$A$3");
    expect(chart).toContain("&apos;Summary&apos;!$B$2:$B$3");
    expect(worksheet).toContain("<drawing r:id=");
    expect(zip.file(/^xl\/media\//)).toHaveLength(0);

    const reloaded = new ExcelJS.Workbook();
    await expect(reloaded.xlsx.load(output)).resolves.toBeDefined();
  });
});
