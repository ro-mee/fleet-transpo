import JSZip from "jszip";

const XMLNS = {
  chart: "http://schemas.openxmlformats.org/drawingml/2006/chart",
  drawing: "http://schemas.openxmlformats.org/drawingml/2006/main",
  relationships: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  packageRelationships: "http://schemas.openxmlformats.org/package/2006/relationships",
  spreadsheetDrawing: "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
};

const escapeXml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

const absoluteRange = (range) => range.replace(/([A-Z]+)(\d+)/g, (_, column, row) => `$${column}$${row}`);
const reference = (sheet, range) => `'${String(sheet).replaceAll("'", "''")}'!${absoluteRange(range)}`;

function titleXml(title) {
  return `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-PH" sz="1200" b="1"/><a:t>${escapeXml(title)}</a:t></a:r><a:endParaRPr lang="en-PH"/></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title>`;
}

function seriesXml(series, index, sourceSheet, categoryRange, type) {
  const marker = type === "line" ? '<c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>' : "";
  const smooth = type === "line" ? '<c:smooth val="0"/>' : "";
  return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:strRef><c:f>${escapeXml(reference(sourceSheet, series.nameCell))}</c:f></c:strRef></c:tx><c:spPr><a:solidFill><a:srgbClr val="${series.color}"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="${series.color}"/></a:solidFill></a:ln></c:spPr>${marker}<c:cat><c:strRef><c:f>${escapeXml(reference(sourceSheet, categoryRange))}</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>${escapeXml(reference(sourceSheet, series.range))}</c:f></c:numRef></c:val>${smooth}</c:ser>`;
}

function chartXml(spec, chartIndex) {
  const categoryAxisId = 48650112 + (chartIndex * 10);
  const valueAxisId = categoryAxisId + 1;
  const type = spec.type === "line" ? "line" : "bar";
  const horizontal = type === "bar" && spec.direction === "bar";
  const series = spec.series.map((item, index) => seriesXml(item, index, spec.sourceSheet || spec.sheet, spec.categoryRange, type)).join("");
  const plot = type === "line"
    ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:dLbls><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls><c:axId val="${categoryAxisId}"/><c:axId val="${valueAxisId}"/></c:lineChart>`
    : `<c:barChart><c:barDir val="${horizontal ? "bar" : "col"}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series}<c:gapWidth val="80"/><c:axId val="${categoryAxisId}"/><c:axId val="${valueAxisId}"/></c:barChart>`;
  const legend = spec.series.length > 1 ? '<c:legend><c:legendPos val="b"/><c:layout/><c:overlay val="0"/></c:legend>' : "";
  const categoryPosition = horizontal ? "l" : "b";
  const valuePosition = horizontal ? "b" : "l";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${XMLNS.chart}" xmlns:a="${XMLNS.drawing}" xmlns:r="${XMLNS.relationships}"><c:date1904 val="0"/><c:lang val="en-PH"/><c:roundedCorners val="0"/><c:style val="10"/><c:chart>${titleXml(spec.title)}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${plot}<c:catAx><c:axId val="${categoryAxisId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${categoryPosition}"/><c:tickLblPos val="nextTo"/><c:crossAx val="${valueAxisId}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="${valueAxisId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${valuePosition}"/><c:majorGridlines/><c:numFmt formatCode="${escapeXml(spec.numberFormat || "General")}" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="${categoryAxisId}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx></c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart><c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/><c:pageSetup/></c:printSettings></c:chartSpace>`;
}

function drawingXml(spec, chartIndex) {
  const from = spec.anchor?.from || { col: 8, row: 4 };
  const to = spec.anchor?.to || { col: 16, row: 20 };
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="${XMLNS.spreadsheetDrawing}" xmlns:a="${XMLNS.drawing}"><xdr:twoCellAnchor><xdr:from><xdr:col>${from.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${from.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${to.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${to.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart ${chartIndex}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${XMLNS.chart}"><c:chart xmlns:c="${XMLNS.chart}" xmlns:r="${XMLNS.relationships}" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;
}

function nextRelationshipId(xml = "") {
  const ids = [...xml.matchAll(/Id="rId(\d+)"/g)].map((match) => Number(match[1]));
  return `rId${Math.max(0, ...ids) + 1}`;
}

function addRelationship(xml, id, type, target) {
  const relationship = `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;
  if (xml) return xml.replace("</Relationships>", `${relationship}</Relationships>`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${XMLNS.packageRelationships}">${relationship}</Relationships>`;
}

function addContentType(xml, partName, contentType) {
  if (xml.includes(`PartName="${partName}"`)) return xml;
  return xml.replace("</Types>", `<Override PartName="${partName}" ContentType="${contentType}"/></Types>`);
}

/** Adds one native, editable chart per target sheet to an ExcelJS-produced buffer. */
export async function addNativeCharts(buffer, workbook, chartSpecs = []) {
  const charts = chartSpecs.filter((spec) => spec.rowCount > 0 && spec.series?.length);
  if (!charts.length) return buffer;

  const zip = await JSZip.loadAsync(buffer);
  let contentTypes = await zip.file("[Content_Types].xml").async("string");

  for (let index = 0; index < charts.length; index += 1) {
    const spec = charts[index];
    const chartIndex = index + 1;
    const sheet = workbook.getWorksheet(spec.sheet);
    if (!sheet) throw new Error(`Chart target sheet not found: ${spec.sheet}`);

    const sheetPath = `xl/worksheets/sheet${sheet.id}.xml`;
    const sheetFile = zip.file(sheetPath);
    if (!sheetFile) throw new Error(`Chart target part not found: ${sheetPath}`);
    let sheetXml = await sheetFile.async("string");
    if (!sheetXml.includes("xmlns:r=")) sheetXml = sheetXml.replace("<worksheet ", `<worksheet xmlns:r="${XMLNS.relationships}" `);

    const sheetRelsPath = `xl/worksheets/_rels/sheet${sheet.id}.xml.rels`;
    const existingRels = zip.file(sheetRelsPath) ? await zip.file(sheetRelsPath).async("string") : "";
    const drawingRelationshipId = nextRelationshipId(existingRels);
    const drawingIndex = chartIndex;
    zip.file(sheetRelsPath, addRelationship(existingRels, drawingRelationshipId, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing", `../drawings/drawing${drawingIndex}.xml`));
    sheetXml = sheetXml.replace("</worksheet>", `<drawing r:id="${drawingRelationshipId}"/></worksheet>`);
    zip.file(sheetPath, sheetXml);

    zip.file(`xl/drawings/drawing${drawingIndex}.xml`, drawingXml(spec, chartIndex));
    zip.file(`xl/drawings/_rels/drawing${drawingIndex}.xml.rels`, addRelationship("", "rId1", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart", `../charts/chart${chartIndex}.xml`));
    zip.file(`xl/charts/chart${chartIndex}.xml`, chartXml(spec, chartIndex));
    contentTypes = addContentType(contentTypes, `/xl/drawings/drawing${drawingIndex}.xml`, "application/vnd.openxmlformats-officedocument.drawing+xml");
    contentTypes = addContentType(contentTypes, `/xl/charts/chart${chartIndex}.xml`, "application/vnd.openxmlformats-officedocument.drawingml.chart+xml");
  }

  zip.file("[Content_Types].xml", contentTypes);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
