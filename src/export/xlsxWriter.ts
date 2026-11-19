// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import JSZip from 'jszip';
import { safeText } from './workbook';

/**
 * A small Excel writer for large tables. Rows are turned straight into sheet XML, so a sheet of
 * 50,000 rows and 150 columns needs a few hundred megabytes at most instead of several gigabytes.
 * It writes styles, merged cells, frozen panes, conditional formatting, and formulas saved with
 * their calculated results, so the file shows correct numbers before Excel recalculates.
 */

export interface XStyle {
  bold?: boolean;
  italic?: boolean;
  size?: number;
  color?: string;
  font?: string;
  fill?: string;
  border?: string;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'center' | 'bottom';
  wrap?: boolean;
  numFmt?: string;
}

export interface XCell {
  /** A text, number, or true/false value. For a formula, the result calculated by this app. */
  v?: string | number | boolean | null;
  /** A date, in milliseconds since 1970. */
  date?: number;
  f?: string;
  s?: number;
}

export interface XRow { cells: (XCell | null | undefined)[]; height?: number }

export type XRule =
  | { type: 'expression'; ref: string; formula: string; style: XStyle }
  | { type: 'colorScale'; ref: string; colors: [string, string, string] };

/** A drop-down list. `list` is either a range such as `'Sheet'!$A$1:$A$9` or a short list of values. */
export interface XValidation { ref: string; list: string | string[] }

export interface XChartSeries {
  name: string;
  /** Ranges such as `'Sheet name'!$B$2:$B$9`. */
  categories: string;
  values: string;
  /** Values calculated by this app, so the chart shows before Excel recalculates. */
  cache?: { categories: (string | number)[]; values: number[] };
  type?: 'bar' | 'line';
  color?: string;
  /** Draws the series against a second value axis on the right. */
  secondary?: boolean;
}

export interface XChart {
  title: string;
  /** Top-left cell, counted from zero. */
  at: { row: number; col: number };
  /** Size in pixels. */
  width: number;
  height: number;
  series: XChartSeries[];
  /** Bars run left to right instead of bottom to top. */
  horizontal?: boolean;
  categoryTitle?: string;
  valueFormat?: string;
}

export interface XSheet {
  name: string;
  hidden?: boolean;
  cols?: { width?: number; hidden?: boolean }[];
  /** Rows are produced on demand, so large tables are never held twice in memory. */
  rows: () => Iterable<XRow>;
  merges?: string[];
  freeze?: { rows: number; cols: number };
  autoFilter?: string;
  rules?: XRule[];
  validations?: XValidation[];
  charts?: XChart[];
  /** Shows the sheet without grid lines, like a dashboard. */
  noGrid?: boolean;
}

const DAY = 86400000;
const BUILTIN_FORMATS: Record<string, number> = { General: 0, '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10, '@': 49 };

export function colName(c: number): string {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
export const cellRef = (r: number, c: number) => `${colName(c)}${r + 1}`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const argb = (hex: string) => { const h = hex.replace('#', '').toUpperCase(); return h.length === 8 ? h : `FF${h}`; };

/** Collects styles and returns the index Excel uses for each distinct one. */
export class StyleBook {
  private xfs: string[] = ['0|0|0|0|'];
  private xfIndex = new Map<string, number>([['0|0|0|0|', 0]]);
  private fonts = ['<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'];
  private fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  private borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  private numFmts = new Map<string, number>();
  readonly dxfs: string[] = [];

  private pick(list: string[], xml: string) {
    const at = list.indexOf(xml);
    if (at >= 0) return at;
    list.push(xml);
    return list.length - 1;
  }

  private fontXml(s: XStyle) {
    return `<font>${s.bold ? '<b/>' : ''}${s.italic ? '<i/>' : ''}<sz val="${s.size ?? 10}"/>${s.color ? `<color rgb="${argb(s.color)}"/>` : ''}<name val="${esc(s.font ?? 'Arial')}"/><family val="2"/></font>`;
  }

  add(s: XStyle): number {
    const font = this.pick(this.fonts, this.fontXml(s));
    const fill = s.fill ? this.pick(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="${argb(s.fill)}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    const side = s.border ? `style="thin"><color rgb="${argb(s.border)}"/>` : '';
    const border = s.border ? this.pick(this.borders, `<border><left ${side}</left><right ${side}</right><top ${side}</top><bottom ${side}</bottom><diagonal/></border>`) : 0;
    let fmt = 0;
    if (s.numFmt) {
      fmt = BUILTIN_FORMATS[s.numFmt] ?? this.numFmts.get(s.numFmt) ?? 164 + this.numFmts.size;
      if (fmt >= 164) this.numFmts.set(s.numFmt, fmt);
    }
    const align = s.align || s.valign || s.wrap ? `<alignment${s.align ? ` horizontal="${s.align}"` : ''}${s.valign ? ` vertical="${s.valign}"` : ''}${s.wrap ? ' wrapText="1"' : ''}/>` : '';
    const key = `${font}|${fill}|${border}|${fmt}|${align}`;
    const known = this.xfIndex.get(key);
    if (known !== undefined) return known;
    this.xfs.push(key);
    this.xfIndex.set(key, this.xfs.length - 1);
    return this.xfs.length - 1;
  }

  addDxf(s: XStyle): number {
    this.dxfs.push(`<dxf><font>${s.bold ? '<b/>' : ''}${s.color ? `<color rgb="${argb(s.color)}"/>` : ''}</font>${s.fill ? `<fill><patternFill patternType="solid"><bgColor rgb="${argb(s.fill)}"/></patternFill></fill>` : ''}</dxf>`);
    return this.dxfs.length - 1;
  }

  xml(): string {
    const fmts = [...this.numFmts].map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${esc(code)}"/>`).join('');
    const xfs = this.xfs.map((k) => {
      const [font, fill, border, fmt, align] = k.split('|');
      const apply = `${fill !== '0' ? ' applyFill="1"' : ''}${border !== '0' ? ' applyBorder="1"' : ''}${fmt !== '0' ? ' applyNumberFormat="1"' : ''}${font !== '0' ? ' applyFont="1"' : ''}`;
      return align ? `<xf numFmtId="${fmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${apply} applyAlignment="1">${align}</xf>` : `<xf numFmtId="${fmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${apply}/>`;
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + (fmts ? `<numFmts count="${this.numFmts.size}">${fmts}</numFmts>` : '')
      + `<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts><fills count="${this.fills.length}">${this.fills.join('')}</fills>`
      + `<borders count="${this.borders.length}">${this.borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
      + `<cellXfs count="${this.xfs.length}">${xfs}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`
      + `<dxfs count="${this.dxfs.length}">${this.dxfs.join('')}</dxfs></styleSheet>`;
  }
}

/** Gathers XML text and turns it into bytes in pieces, so no single string grows too large. */
class ByteSink {
  private parts: string[] = [];
  private size = 0;
  private chunks: Uint8Array[] = [];
  private enc = new TextEncoder();
  push(s: string) { this.parts.push(s); this.size += s.length; if (this.size > 1 << 20) this.flush(); }
  private flush() { if (!this.parts.length) return; this.chunks.push(this.enc.encode(this.parts.join(''))); this.parts = []; this.size = 0; }
  bytes(): Uint8Array {
    this.flush();
    const out = new Uint8Array(this.chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of this.chunks) { out.set(c, at); at += c.length; }
    this.chunks = [];
    return out;
  }
}

class SharedStrings {
  private index = new Map<string, number>();
  private list: string[] = [];
  id(s: string): number {
    let i = this.index.get(s);
    if (i === undefined) { i = this.list.length; this.list.push(s); this.index.set(s, i); }
    return i;
  }
  bytes(): Uint8Array {
    const sink = new ByteSink();
    sink.push(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${this.list.length}" uniqueCount="${this.list.length}">`);
    for (const s of this.list) sink.push(/^\s|\s$/.test(s) ? `<si><t xml:space="preserve">${esc(s)}</t></si>` : `<si><t>${esc(s)}</t></si>`);
    sink.push('</sst>');
    return sink.bytes();
  }
}

function cellXml(r: number, c: number, cell: XCell, sst: SharedStrings): string {
  const ref = cellRef(r, c);
  const s = cell.s ? ` s="${cell.s}"` : '';
  if (cell.f) {
    const f = `<f>${esc(safeText(cell.f))}</f>`;
    if (typeof cell.v === 'number' && Number.isFinite(cell.v)) return `<c r="${ref}"${s}>${f}<v>${cell.v}</v></c>`;
    if (typeof cell.v === 'string') return `<c r="${ref}"${s} t="str">${f}<v>${esc(safeText(cell.v))}</v></c>`;
    if (typeof cell.v === 'boolean') return `<c r="${ref}"${s} t="b">${f}<v>${cell.v ? 1 : 0}</v></c>`;
    return `<c r="${ref}"${s}>${f}</c>`;
  }
  if (cell.date !== undefined && Number.isFinite(cell.date)) return `<c r="${ref}"${s}><v>${cell.date / DAY + 25569}</v></c>`;
  const v = cell.v;
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
  if (typeof v === 'boolean') return `<c r="${ref}"${s} t="b"><v>${v ? 1 : 0}</v></c>`;
  if (typeof v === 'string' && v !== '') return `<c r="${ref}"${s} t="s"><v>${sst.id(safeText(v))}</v></c>`;
  return s ? `<c r="${ref}"${s}/>` : '';
}

function sheetBytes(sheet: XSheet, sst: SharedStrings, styles: StyleBook): Uint8Array {
  const sink = new ByteSink();
  sink.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">');
  const fr = sheet.freeze;
  if (fr && (fr.rows || fr.cols)) {
    const pane = fr.rows && fr.cols ? 'bottomRight' : fr.rows ? 'bottomLeft' : 'topRight';
    sink.push(`<sheetViews><sheetView${sheet.noGrid ? ' showGridLines="0"' : ''} workbookViewId="0"><pane${fr.cols ? ` xSplit="${fr.cols}"` : ''}${fr.rows ? ` ySplit="${fr.rows}"` : ''} topLeftCell="${cellRef(fr.rows, fr.cols)}" activePane="${pane}" state="frozen"/><selection pane="${pane}"/></sheetView></sheetViews>`);
  } else sink.push(`<sheetViews><sheetView${sheet.noGrid ? ' showGridLines="0"' : ''} workbookViewId="0"/></sheetViews>`);
  sink.push('<sheetFormatPr defaultRowHeight="15"/>');
  if (sheet.cols?.length) {
    sink.push('<cols>');
    sheet.cols.forEach((c, i) => { if (c.width !== undefined || c.hidden) sink.push(`<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 9.14}"${c.width !== undefined ? ' customWidth="1"' : ''}${c.hidden ? ' hidden="1"' : ''}/>`); });
    sink.push('</cols>');
  }
  sink.push('<sheetData>');
  let r = 0;
  for (const row of sheet.rows()) {
    const parts: string[] = [];
    row.cells.forEach((cell, c) => { if (cell) { const x = cellXml(r, c, cell, sst); if (x) parts.push(x); } });
    if (parts.length || row.height) sink.push(`<row r="${r + 1}"${row.height ? ` ht="${row.height}" customHeight="1"` : ''}>${parts.join('')}</row>`);
    r++;
  }
  sink.push('</sheetData>');
  if (sheet.autoFilter) sink.push(`<autoFilter ref="${sheet.autoFilter}"/>`);
  if (sheet.merges?.length) sink.push(`<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`);
  let priority = 1;
  for (const rule of sheet.rules ?? []) {
    if (rule.type === 'expression') {
      sink.push(`<conditionalFormatting sqref="${rule.ref}"><cfRule type="expression" dxfId="${styles.addDxf(rule.style)}" priority="${priority++}"><formula>${esc(rule.formula)}</formula></cfRule></conditionalFormatting>`);
    } else {
      sink.push(`<conditionalFormatting sqref="${rule.ref}"><cfRule type="colorScale" priority="${priority++}"><colorScale><cfvo type="min"/><cfvo type="percentile" val="50"/><cfvo type="max"/>${rule.colors.map((c) => `<color rgb="${argb(c)}"/>`).join('')}</colorScale></cfRule></conditionalFormatting>`);
    }
  }
  if (sheet.validations?.length) {
    sink.push(`<dataValidations count="${sheet.validations.length}">`);
    for (const v of sheet.validations) {
      const list = Array.isArray(v.list) ? `"${v.list.map((x) => x.replace(/"/g, '""')).join(',')}"` : v.list;
      sink.push(`<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="${v.ref}"><formula1>${esc(list)}</formula1></dataValidation>`);
    }
    sink.push('</dataValidations>');
  }
  sink.push('<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>');
  if (sheet.charts?.length) sink.push('<drawing r:id="rId1"/>');
  sink.push('</worksheet>');
  return sink.bytes();
}

/* ---------- Charts ---------- */

const EMU = 9525;
const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PALETTE = ['1F4E5F', 'B8860B', '2E75B6', '548235', 'C00000', '7F6000'];

function textXml(text: string, size: number, bold = true) {
  return `<c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size * 100}" b="${bold ? 1 : 0}"/></a:pPr><a:r><a:rPr lang="en-US" sz="${size * 100}" b="${bold ? 1 : 0}"/><a:t>${esc(text)}</a:t></a:r></a:p></c:rich></c:tx>`;
}

function cacheXml(kind: 'str' | 'num', values: (string | number)[]) {
  const pts = values.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(String(v))}</c:v></c:pt>`).join('');
  return kind === 'str' ? `<c:strCache><c:ptCount val="${values.length}"/>${pts}</c:strCache>` : `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${pts}</c:numCache>`;
}

function seriesXml(s: XChartSeries, i: number) {
  const color = (s.color ?? PALETTE[i % PALETTE.length]).replace('#', '');
  const look = s.type === 'line'
    ? `<c:spPr><a:ln w="28575" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:round/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr></c:marker>`
    : `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>`;
  const numericCats = Boolean(s.cache && s.cache.categories.length && typeof s.cache.categories[0] === 'number');
  const cats = s.cache ? cacheXml(numericCats ? 'num' : 'str', s.cache.categories) : '';
  const catRef = numericCats ? `<c:numRef><c:f>${esc(s.categories)}</c:f>${cats}</c:numRef>` : `<c:strRef><c:f>${esc(s.categories)}</c:f>${cats}</c:strRef>`;
  const labels = `<c:dLbls><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="800"/></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>`;
  return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${esc(s.name)}</c:v></c:tx>${look}${s.type === 'line' ? '' : labels}`
    + `<c:cat>${catRef}</c:cat><c:val><c:numRef><c:f>${esc(s.values)}</c:f>${s.cache ? cacheXml('num', s.cache.values) : ''}</c:numRef></c:val>${s.type === 'line' ? '<c:smooth val="0"/>' : ''}</c:ser>`;
}

function axisXml(kind: 'cat' | 'val', id: number, cross: number, pos: 'b' | 'l' | 'r', opts: { title?: string; format?: string; deleted?: boolean; crossesMax?: boolean }) {
  const title = opts.title ? `<c:title>${textXml(opts.title, 9, false)}<c:overlay val="0"/></c:title>` : '';
  const head = `<c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="${opts.deleted ? 1 : 0}"/><c:axPos val="${pos}"/>`;
  const grid = kind === 'val' && pos !== 'r' ? '<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E3E6EA"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>' : '';
  const text = '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="800"/></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>';
  const crosses = opts.crossesMax ? '<c:crosses val="max"/>' : '<c:crosses val="autoZero"/>';
  if (kind === 'cat') return `<c:catAx>${head}${title}<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${text}<c:crossAx val="${cross}"/>${crosses}<c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
  return `<c:valAx>${head}${grid}${title}<c:numFmt formatCode="${esc(opts.format ?? '#,##0')}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${text}<c:crossAx val="${cross}"/>${crosses}<c:crossBetween val="between"/></c:valAx>`;
}

/** A clustered bar chart, optionally with lines, the second of which can use its own axis. */
export function chartXml(chart: XChart): string {
  const bars = chart.series.map((s, i) => ({ s, i })).filter((x) => x.s.type !== 'line');
  const lines = chart.series.map((s, i) => ({ s, i })).filter((x) => x.s.type === 'line');
  const second = bars.length > 0 && lines.some((x) => x.s.secondary);
  const barXml = bars.length ? `<c:barChart><c:barDir val="${chart.horizontal ? 'bar' : 'col'}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${bars.map((x) => seriesXml(x.s, x.i)).join('')}<c:gapWidth val="60"/><c:axId val="1001"/><c:axId val="1002"/></c:barChart>` : '';
  const lineXml = lines.length ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${lines.map((x) => seriesXml(x.s, x.i)).join('')}<c:marker val="1"/><c:axId val="${second ? 1003 : 1001}"/><c:axId val="${second ? 1004 : 1002}"/></c:lineChart>` : '';
  const catPos = chart.horizontal ? 'l' : 'b';
  const valPos = chart.horizontal ? 'b' : 'l';
  const axes = axisXml('cat', 1001, 1002, catPos, { title: chart.categoryTitle }) + axisXml('val', 1002, 1001, valPos, { format: chart.valueFormat })
    + (second ? axisXml('cat', 1003, 1004, catPos, { deleted: true }) + axisXml('val', 1004, 1003, 'r', { format: '#,##0.0', crossesMax: true }) : '');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><c:roundedCorners val="0"/>`
    + `<c:chart><c:title>${textXml(chart.title, 12)}<c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${barXml}${lineXml}${axes}</c:plotArea>`
    + `<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>`
    + '<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr></c:chartSpace>';
}

function drawingXml(charts: XChart[], firstId: number): string {
  const anchors = charts.map((ch, i) => `<xdr:oneCellAnchor><xdr:from><xdr:col>${ch.at.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${ch.at.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>`
    + `<xdr:ext cx="${Math.round(ch.width * EMU)}" cy="${Math.round(ch.height * EMU)}"/><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${firstId + i + 2}" name="Chart ${firstId + i + 1}" title="${esc(ch.title)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>`
    + `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${NS_A}" xmlns:r="${NS_R}">${anchors}</xdr:wsDr>`;
}

/** Writes the workbook. Sheet names must already be legal and unique. */
export async function writeXlsx(sheets: XSheet[], styles: StyleBook, onProgress?: (message: string) => void): Promise<Uint8Array<ArrayBuffer>> {
  const zip = new JSZip();
  const sst = new SharedStrings();
  const drawings: number[] = [];
  let chartCount = 0;
  sheets.forEach((sheet, i) => {
    onProgress?.(`Writing ${sheet.name}`);
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetBytes(sheet, sst, styles));
    if (!sheet.charts?.length) return;
    drawings.push(i + 1);
    const d = drawings.length;
    zip.file(`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_R}/drawing" Target="../drawings/drawing${d}.xml"/></Relationships>`);
    zip.file(`xl/drawings/drawing${d}.xml`, drawingXml(sheet.charts, chartCount));
    zip.file(`xl/drawings/_rels/drawing${d}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheet.charts.map((_, k) => `<Relationship Id="rId${k + 1}" Type="${NS_R}/chart" Target="../charts/chart${chartCount + k + 1}.xml"/>`).join('')}</Relationships>`);
    sheet.charts.forEach((ch, k) => zip.file(`xl/charts/chart${chartCount + k + 1}.xml`, chartXml(ch)));
    chartCount += sheet.charts.length;
  });
  zip.file('xl/sharedStrings.xml', sst.bytes());
  zip.file('xl/styles.xml', styles.xml());
  const active = Math.max(0, sheets.findIndex((s) => !s.hidden));
  zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<bookViews><workbookView activeTab="${active}" firstSheet="${active}"/></bookViews><sheets>`
    + sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('')
    + '</sheets>'
    + (sheets.some((s) => s.autoFilter) ? `<definedNames>${sheets.map((s, i) => (s.autoFilter ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(s.name.replace(/'/g, "''"))}'!${s.autoFilter.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}</definedName>` : '')).join('')}</definedNames>` : '')
    + '<calcPr calcId="191029"/></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    + `<Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`);
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + drawings.map((_, d) => `<Override PartName="/xl/drawings/drawing${d + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`).join('')
    + Array.from({ length: chartCount }, (_, k) => `<Override PartName="/xl/charts/chart${k + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`).join('')
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>');
  onProgress?.('Compressing the workbook');
  return await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } }) as Uint8Array<ArrayBuffer>;
}
