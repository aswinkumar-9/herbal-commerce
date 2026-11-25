import JSZip from 'jszip';
import { chartXml, type SheetChart, withCharts, xmlText } from './sales-charts';

const BARS: SheetChart = {
  title: 'Top 10 products',
  description: 'Top 10 products, as bars.',
  kind: 'bars',
  sheet: "Ravi's products",
  first: 5,
  last: 6,
  labelColumn: 'A',
  valueColumn: 'I',
  labels: ['Ashwagandha', 'Tulsi & Neem'],
  values: [856, -428],
  valueName: 'Net sales',
  valueFormat: '"₹"#,##0',
  from: { column: 1, row: 14 },
  to: { column: 7, row: 31 },
};
const COLUMNS: SheetChart = {
  ...BARS,
  title: 'Net sales by day',
  kind: 'columns',
  sheet: 'Sales by day',
  labels: [46346, 46347],
  labelFormat: 'd mmm',
};

const SHEET =
  '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/><pageMargins/><tableParts count="1"/></worksheet>';

// A workbook of two sheets, the second with a table and a chart already.
async function workbook(sheet = SHEET): Promise<Buffer> {
  const zip = new JSZip();
  const put = (path: string, xml: string) =>
    zip.file(path, xml, { createFolders: false });
  put(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
  );
  put(
    'xl/workbook.xml',
    '<workbook><sheets><sheet name="Data &amp; more" sheetId="1" r:id="rId1"/><sheet name="Dashboard" sheetId="2" r:id="rId2"/></sheets></workbook>',
  );
  put(
    'xl/_rels/workbook.xml.rels',
    '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x" Target="/xl/worksheets/sheet7.xml"/></Relationships>',
  );
  put('xl/worksheets/sheet1.xml', SHEET);
  put('xl/worksheets/sheet7.xml', sheet);
  put(
    'xl/worksheets/_rels/sheet7.xml.rels',
    '<Relationships><Relationship Id="rId1" Type="table" Target="../tables/table1.xml"/></Relationships>',
  );
  put('xl/charts/chart1.xml', '<chartSpace/>');
  put('xl/drawings/drawing1.xml', '<wsDr/>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

const text = async (zip: JSZip, path: string) =>
  (await zip.file(path)?.async('string')) ?? `no ${path}`;

describe('xmlText', () => {
  it('escapes text for XML, without the control characters XML cannot hold', () => {
    expect(xmlText(`<a href="x">Tulsi & Neem's</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tulsi &amp; Neem&apos;s&lt;/a&gt;',
    );
    expect(xmlText('a\u0000b\u0007c\u001fd\te\nf\rg')).toBe('abcd\te\nf\rg');
  });
});

describe('chartXml', () => {
  it('draws ranked bars, the best at the top, each labelled with its value, without a value axis', () => {
    const xml = chartXml(BARS);
    expect(xml).toContain('<c:barDir val="bar"/>');
    expect(xml).toContain('<c:orientation val="maxMin"/>');
    expect(xml).toContain('<c:delete val="1"/><c:axPos val="b"/>');
    expect(xml).toContain('<c:showVal val="1"/>');
    expect(xml).not.toContain('<c:majorGridlines>');
    // The sheet's name quoted for a formula, then escaped for XML.
    expect(xml).toContain(`<c:f>'Ravi&apos;&apos;s products'!$A$5:$A$6</c:f>`);
    expect(xml).toContain(
      '<c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>Ashwagandha</c:v></c:pt><c:pt idx="1"><c:v>Tulsi &amp; Neem</c:v></c:pt></c:strCache>',
    );
    expect(xml).toContain('<c:pt idx="1"><c:v>-428</c:v></c:pt>');
    expect(xml).toContain('formatCode="&quot;₹&quot;#,##0"');
    expect(xml).toContain('<a:srgbClr val="1F7A55"/>');
    expect(xml).toContain('<a:t>Top 10 products</a:t>');
    // A single series: no legend.
    expect(xml).not.toContain('<c:legend>');
    expect(xml).toContain('<c:plotVisOnly val="1"/>');
  });

  it('draws columns over time on a value axis, the days as dates', () => {
    const xml = chartXml(COLUMNS);
    expect(xml).toContain('<c:barDir val="col"/>');
    expect(xml).toContain('<c:orientation val="minMax"/>');
    expect(xml).toContain('<c:delete val="0"/><c:axPos val="l"/>');
    expect(xml).toContain('<c:majorGridlines>');
    expect(xml).not.toContain('<c:dLbls>');
    expect(xml).toContain(
      `<c:numRef><c:f>'Sales by day'!$A$5:$A$6</c:f><c:numCache><c:formatCode>d mmm</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>46346</c:v></c:pt>`,
    );
    expect(xml).toContain('<c:numFmt formatCode="d mmm" sourceLinked="0"/>');
  });
});

describe('withCharts', () => {
  it('leaves a workbook without charts as it is', async () => {
    const file = await workbook();
    await expect(withCharts(file, 'Dashboard', [])).resolves.toBe(file);
  });

  it('adds the charts in new parts, linked from the sheet of that name, its drawing before its tables', async () => {
    const zip = await JSZip.loadAsync(
      await withCharts(await workbook(), 'Dashboard', [COLUMNS, BARS]),
    );
    // Clear of the parts it had.
    expect(await text(zip, 'xl/charts/chart2.xml')).toContain(
      '<c:barDir val="col"/>',
    );
    expect(await text(zip, 'xl/charts/chart3.xml')).toContain(
      '<c:barDir val="bar"/>',
    );
    expect(await text(zip, 'xl/charts/chart1.xml')).toBe('<chartSpace/>');
    const drawing = await text(zip, 'xl/drawings/drawing2.xml');
    expect(drawing).toContain(
      '<xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>14</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>7</xdr:col>',
    );
    expect(drawing).toContain(
      '<xdr:cNvPr id="3" name="Chart 2" descr="Top 10 products, as bars."/>',
    );
    expect(drawing).toContain('r:id="rId2"/>');
    expect(await text(zip, 'xl/drawings/_rels/drawing2.xml.rels')).toContain(
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart3.xml"/>',
    );
    // Its links kept, the drawing's added.
    expect(await text(zip, 'xl/worksheets/_rels/sheet7.xml.rels')).toBe(
      '<Relationships><Relationship Id="rId1" Type="table" Target="../tables/table1.xml"/><Relationship Id="rIdSalesCharts" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing2.xml"/></Relationships>',
    );
    // Its root names no relationships: the drawing does.
    expect(await text(zip, 'xl/worksheets/sheet7.xml')).toContain(
      '<pageMargins/><drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdSalesCharts"/><tableParts count="1"/>',
    );
    expect(await text(zip, 'xl/worksheets/sheet1.xml')).toBe(SHEET);
    expect(await text(zip, '[Content_Types].xml')).toBe(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/drawings/drawing2.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/charts/chart2.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/><Override PartName="/xl/charts/chart3.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>',
    );
    // No folder entries: an .xlsx has none of its own.
    expect(Object.keys(zip.files).filter((name) => name.endsWith('/'))).toEqual(
      [],
    );
  });

  it('refuses a sheet it cannot find, or one with a drawing already', async () => {
    await expect(
      withCharts(await workbook(), 'Summary', [BARS]),
    ).rejects.toThrow('The workbook has no sheet Summary');
    await expect(
      withCharts(
        await workbook(SHEET.replace('<pageMargins/>', '<drawing r:id="x"/>')),
        'Dashboard',
        [BARS],
      ),
    ).rejects.toThrow('The sheet Dashboard has a drawing already');
  });
});
