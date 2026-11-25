import JSZip from 'jszip';

// Excel charts for the sales workbook (part 15D, ADR 0047). exceljs writes
// no charts, so they are added to the file it makes: a chart part for
// each, a drawing that places them on a sheet, and the links between.
// Each chart reads its cells, so it follows a sheet's filter; the values
// written beside the cells are for a viewer that works nothing out.

export interface SheetChart {
  title: string;
  // What it shows, for a screen reader.
  description: string;
  // Columns over time, or bars ranked from the top.
  kind: 'columns' | 'bars';
  // Where its names (or dates) and values are: a sheet's rows, from
  // first to last, in two of its columns.
  sheet: string;
  first: number;
  last: number;
  labelColumn: string;
  valueColumn: string;
  // What those cells hold; dates as Excel's day numbers, with their format.
  labels: (string | number)[];
  labelFormat?: string;
  values: number[];
  valueName: string;
  valueFormat: string;
  // Its corners on the sheet: columns and rows counted from 0.
  from: { column: number; row: number };
  to: { column: number; row: number };
}

const NS = {
  chart: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
  main: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  sheetDrawing:
    'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
  relationships:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  package: 'http://schemas.openxmlformats.org/package/2006/relationships',
};
const CHART_TYPE =
  'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
const DRAWING_TYPE =
  'application/vnd.openxmlformats-officedocument.drawing+xml';

// The console's chart green, checked on a light card (part 15D), and its
// inks.
const SERIES = '1F7A55';
const INK = '1D2B24';
const MUTED = '4A5A51';
const RULE = 'BFCBC3';
const GRID = 'E3E9E5';
const EDGE = 'D5DFD8';

// Text as XML keeps it: escaped, without the control characters XML
// cannot hold.
export function xmlText(text: string): string {
  let kept = '';
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) {
      kept += character;
    }
  }
  return kept
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const fill = (color: string) =>
  `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
const textProperties = (size: number, color: string) =>
  `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}">${fill(color)}</a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;
const noLine = '<a:ln><a:noFill/></a:ln>';

function cellRange(chart: SheetChart, column: string): string {
  const sheet = chart.sheet.replace(/'/g, "''");
  return `'${xmlText(sheet)}'!$${column}$${chart.first}:$${column}$${chart.last}`;
}

const points = (values: (string | number)[]) =>
  `<c:ptCount val="${values.length}"/>${values
    .map(
      (value, i) =>
        `<c:pt idx="${i}"><c:v>${xmlText(String(value))}</c:v></c:pt>`,
    )
    .join('')}`;

// One chart's part: a single series in the console's green, no legend, its
// title naming it.
export function chartXml(chart: SheetChart): string {
  const bars = chart.kind === 'bars';
  const format = xmlText(chart.valueFormat);
  const labels = chart.labelFormat
    ? `<c:numRef><c:f>${cellRange(chart, chart.labelColumn)}</c:f><c:numCache><c:formatCode>${xmlText(chart.labelFormat)}</c:formatCode>${points(chart.labels)}</c:numCache></c:numRef>`
    : `<c:strRef><c:f>${cellRange(chart, chart.labelColumn)}</c:f><c:strCache>${points(chart.labels)}</c:strCache></c:strRef>`;
  // Ranked bars carry their values; columns over time read off the axis.
  const valueLabels = bars
    ? `<c:dLbls><c:numFmt formatCode="${format}" sourceLinked="0"/><c:spPr><a:noFill/>${noLine}</c:spPr>${textProperties(900, MUTED)}<c:dLblPos val="outEnd"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>`
    : '';
  const series =
    `<c:ser><c:idx val="0"/><c:order val="0"/>` +
    `<c:tx><c:v>${xmlText(chart.valueName)}</c:v></c:tx>` +
    `<c:spPr>${fill(SERIES)}${noLine}</c:spPr>` +
    `<c:invertIfNegative val="0"/>${valueLabels}` +
    `<c:cat>${labels}</c:cat>` +
    `<c:val><c:numRef><c:f>${cellRange(chart, chart.valueColumn)}</c:f><c:numCache><c:formatCode>General</c:formatCode>${points(chart.values)}</c:numCache></c:numRef></c:val>` +
    `</c:ser>`;
  const categoryAxis =
    `<c:catAx><c:axId val="1001"/>` +
    // The best at the top.
    `<c:scaling><c:orientation val="${bars ? 'maxMin' : 'minMax'}"/></c:scaling>` +
    `<c:delete val="0"/><c:axPos val="${bars ? 'l' : 'b'}"/>` +
    (chart.labelFormat
      ? `<c:numFmt formatCode="${xmlText(chart.labelFormat)}" sourceLinked="0"/>`
      : `<c:numFmt formatCode="General" sourceLinked="1"/>`) +
    `<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/>` +
    `<c:spPr><a:noFill/><a:ln w="9525">${fill(RULE)}</a:ln></c:spPr>` +
    textProperties(900, MUTED) +
    `<c:crossAx val="1002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/>` +
    `</c:catAx>`;
  const valueAxis =
    `<c:valAx><c:axId val="1002"/><c:scaling><c:orientation val="minMax"/></c:scaling>` +
    // Bars are labelled with their values: no axis for them.
    `<c:delete val="${bars ? 1 : 0}"/><c:axPos val="${bars ? 'b' : 'l'}"/>` +
    (bars
      ? ''
      : `<c:majorGridlines><c:spPr><a:ln w="9525">${fill(GRID)}</a:ln></c:spPr></c:majorGridlines>`) +
    `<c:numFmt formatCode="${format}" sourceLinked="0"/>` +
    `<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
    `<c:spPr><a:noFill/>${noLine}</c:spPr>` +
    textProperties(900, MUTED) +
    `<c:crossAx val="1001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/>` +
    `</c:valAx>`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<c:chartSpace xmlns:c="${NS.chart}" xmlns:a="${NS.main}" xmlns:r="${NS.relationships}">` +
    `<c:date1904 val="0"/><c:lang val="en-US"/><c:roundedCorners val="0"/>` +
    `<c:chart>` +
    `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1">${fill(INK)}</a:defRPr></a:pPr><a:r><a:rPr lang="en-US" sz="1200" b="1">${fill(INK)}</a:rPr><a:t>${xmlText(chart.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>` +
    `<c:autoTitleDeleted val="0"/>` +
    `<c:plotArea><c:layout/>` +
    `<c:barChart><c:barDir val="${bars ? 'bar' : 'col'}"/><c:grouping val="clustered"/><c:varyColors val="0"/>` +
    series +
    `<c:gapWidth val="${bars ? 60 : 40}"/><c:axId val="1001"/><c:axId val="1002"/></c:barChart>` +
    categoryAxis +
    valueAxis +
    `<c:spPr><a:noFill/>${noLine}</c:spPr>` +
    `</c:plotArea>` +
    // Only the rows a filter shows.
    `<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>` +
    `</c:chart>` +
    `<c:spPr>${fill('FFFFFF')}<a:ln w="9525">${fill(EDGE)}</a:ln></c:spPr>` +
    textProperties(900, INK) +
    `</c:chartSpace>`
  );
}

// The drawing that places each chart between its corners.
function drawingXml(charts: SheetChart[]): string {
  const anchors = charts.map(
    (chart, i) =>
      `<xdr:twoCellAnchor>` +
      `<xdr:from><xdr:col>${chart.from.column}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${chart.from.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
      `<xdr:to><xdr:col>${chart.to.column}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${chart.to.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
      `<xdr:graphicFrame macro="">` +
      `<xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}" descr="${xmlText(chart.description)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
      `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>` +
      `<a:graphic><a:graphicData uri="${NS.chart}"><c:chart xmlns:c="${NS.chart}" xmlns:r="${NS.relationships}" r:id="rId${i + 1}"/></a:graphicData></a:graphic>` +
      `</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`,
  );
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<xdr:wsDr xmlns:xdr="${NS.sheetDrawing}" xmlns:a="${NS.main}">${anchors.join('')}</xdr:wsDr>`
  );
}

const relationshipsXml = (
  links: { id: string; type: string; target: string }[],
) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<Relationships xmlns="${NS.package}">${links
    .map(
      (link) =>
        `<Relationship Id="${link.id}" Type="${link.type}" Target="${link.target}"/>`,
    )
    .join('')}</Relationships>`;

const attribute = (tag: string, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

// Where a sheet's drawing goes among its parts: before the first of
// those that follow it.
const AFTER_DRAWING = [
  '<legacyDrawing',
  '<drawingHF',
  '<picture',
  '<oleObjects',
  '<controls',
  '<webPublishItems',
  '<tableParts',
  '<extLst',
  '</worksheet>',
];

// The workbook with the charts drawn on the sheet of that name.
export async function withCharts(
  file: Buffer,
  sheetName: string,
  charts: SheetChart[],
): Promise<Buffer> {
  if (charts.length === 0) {
    return file;
  }
  const zip = await JSZip.loadAsync(file, { createFolders: false });
  const read = async (path: string) => {
    const found = zip.file(path);
    if (!found) {
      throw new Error(`The workbook has no ${path}`);
    }
    return found.async('string');
  };
  // A part written as a file of its own: an .xlsx has no folder entries.
  const put = (path: string, text: string) =>
    zip.file(path, text, { createFolders: false });

  // The sheet's part, through the workbook's links.
  const workbook = await read('xl/workbook.xml');
  const sheetTag = (workbook.match(/<sheet\s[^>]*>/g) ?? []).find(
    (tag) => attribute(tag, 'name') === xmlText(sheetName),
  );
  const sheetLink = sheetTag ? attribute(sheetTag, 'r:id') : undefined;
  const links = await read('xl/_rels/workbook.xml.rels');
  const target = (links.match(/<Relationship\s[^>]*>/g) ?? [])
    .filter((tag) => attribute(tag, 'Id') === sheetLink)
    .map((tag) => attribute(tag, 'Target'))[0];
  if (!target) {
    throw new Error(`The workbook has no sheet ${sheetName}`);
  }
  const sheetPath = target.startsWith('/')
    ? target.slice(1)
    : `xl/${target.replace(/^\.\//, '')}`;
  const sheetFile = sheetPath.split('/').pop() ?? '';

  // New parts' names, clear of any the file has.
  const free = (folder: string, name: string, from = 1) => {
    let n = from;
    while (zip.file(`${folder}/${name}${n}.xml`)) {
      n += 1;
    }
    return n;
  };
  const drawing = free('xl/drawings', 'drawing');
  const chartNumbers: number[] = [];
  for (const chart of charts) {
    const n = free('xl/charts', 'chart', (chartNumbers.at(-1) ?? 0) + 1);
    chartNumbers.push(n);
    put(`xl/charts/chart${n}.xml`, chartXml(chart));
  }
  put(`xl/drawings/drawing${drawing}.xml`, drawingXml(charts));
  put(
    `xl/drawings/_rels/drawing${drawing}.xml.rels`,
    relationshipsXml(
      chartNumbers.map((n, i) => ({
        id: `rId${i + 1}`,
        type: `${NS.relationships}/chart`,
        target: `../charts/chart${n}.xml`,
      })),
    ),
  );

  // The sheet's link to its drawing.
  const sheetLinksPath = `xl/worksheets/_rels/${sheetFile}.rels`;
  const drawingLink = {
    id: 'rIdSalesCharts',
    type: `${NS.relationships}/drawing`,
    target: `../drawings/drawing${drawing}.xml`,
  };
  const existing = zip.file(sheetLinksPath);
  if (existing) {
    const known = await existing.async('string');
    put(
      sheetLinksPath,
      known.replace(
        '</Relationships>',
        `<Relationship Id="${drawingLink.id}" Type="${drawingLink.type}" Target="${drawingLink.target}"/></Relationships>`,
      ),
    );
  } else {
    put(sheetLinksPath, relationshipsXml([drawingLink]));
  }

  let sheet = await read(sheetPath);
  if (/<drawing\s/.test(sheet)) {
    throw new Error(`The sheet ${sheetName} has a drawing already`);
  }
  const root = /<worksheet\s[^>]*>/.exec(sheet)?.[0] ?? '';
  const element = root.includes('xmlns:r=')
    ? `<drawing r:id="${drawingLink.id}"/>`
    : `<drawing xmlns:r="${NS.relationships}" r:id="${drawingLink.id}"/>`;
  const at = Math.min(
    ...AFTER_DRAWING.map((tag) => sheet.indexOf(tag)).filter((i) => i >= 0),
  );
  sheet = `${sheet.slice(0, at)}${element}${sheet.slice(at)}`;
  put(sheetPath, sheet);

  const types = await read('[Content_Types].xml');
  put(
    '[Content_Types].xml',
    types.replace(
      '</Types>',
      `<Override PartName="/xl/drawings/drawing${drawing}.xml" ContentType="${DRAWING_TYPE}"/>` +
        chartNumbers
          .map(
            (n) =>
              `<Override PartName="/xl/charts/chart${n}.xml" ContentType="${CHART_TYPE}"/>`,
          )
          .join('') +
        '</Types>',
    ),
  );
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });
}
