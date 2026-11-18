import type ExcelJSNS from 'exceljs';
import type { ColumnProfile, Insight } from '../core/insights';
import type { VisualTable } from '../core/report';
import type { Cell, CellChange, Column, DataTable, Finding, Measure, NumberFormat } from '../core/types';
import { currencySymbol } from '../core/format';

/**
 * Builds the report workbook. The rules here exist to guarantee a file that opens cleanly in
 * Excel and Google Sheets: legal sheet names, XML-safe text, real dates, no NaN or Infinity,
 * and every formula saved together with its calculated result.
 */

export interface WorkbookInput {
  title: string;
  generatedAt: Date;
  filters: string;
  kpis: { label: string; value: number | null; format?: NumberFormat; currency?: string; note?: string }[];
  insights: Insight[];
  visuals: (VisualTable & { image?: { base64: string; width: number; height: number } })[];
  data: DataTable;
  rows: ArrayLike<number>;
  profile: ColumnProfile[];
  findings: Finding[];
  measures: Measure[];
}

export interface WorkbookOptions { target: 'excel' | 'sheets' }

export const EXCEL_MAX_ROWS = 1048575;
export const SHEETS_MAX_CELLS = 10_000_000;
const CELL_TEXT_LIMIT = 32767;
const INK = 'FF0B0B0B';
const MUTED = 'FF52514E';
const ACCENT = 'FF1C5CAB';
const HEAD_FILL = 'FFE8F0FB';

// eslint-disable-next-line no-control-regex
const ILLEGAL_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function safeText(s: string): string {
  return s.replace(ILLEGAL_XML, '').slice(0, CELL_TEXT_LIMIT);
}

export function safeSheetName(name: string, used: Set<string>): string {
  const base = safeText(name).replace(/[\\/*?:[\]]/g, ' ').replace(/^'+|'+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 31).trim() || 'Sheet';
  let out = base;
  let n = 2;
  while (used.has(out.toLowerCase()) || out.toLowerCase() === 'history') {
    const tail = ` (${n++})`;
    out = base.slice(0, 31 - tail.length).trimEnd() + tail;
  }
  used.add(out.toLowerCase());
  return out;
}

export function numFmt(format?: NumberFormat, currency?: string): string {
  switch (format) {
    case 'percent': return '0.0%';
    case 'integer': return '#,##0';
    case 'currency': {
      const s = currencySymbol(currency).replace(/"/g, '');
      return `"${s}"#,##0.00;-"${s}"#,##0.00`;
    }
    default: return '#,##0.00';
  }
}

const MIN_DATE = Date.UTC(1900, 2, 1);
const MAX_DATE = Date.UTC(9999, 11, 31);

/** A value Excel can store safely. Out-of-range dates become ISO text rather than a corrupt cell. */
export function safeCell(v: Cell | undefined, col?: Pick<Column, 'type'>): string | number | boolean | Date | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    if (col?.type === 'date') return v >= MIN_DATE && v <= MAX_DATE ? new Date(v) : new Date(v).toISOString().slice(0, 10);
    return v;
  }
  if (typeof v === 'boolean') return v;
  return safeText(v);
}

function headerRow(ws: ExcelJSNS.Worksheet, rowNo: number, columns: number) {
  const r = ws.getRow(rowNo);
  r.font = { bold: true, color: { argb: INK }, name: 'Calibri', size: 11 };
  r.alignment = { vertical: 'middle', wrapText: true };
  r.height = 30;
  for (let c = 1; c <= columns; c++) {
    const cell = r.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_FILL } };
    cell.border = { bottom: { style: 'medium', color: { argb: ACCENT } } };
  }
}

function title(ws: ExcelJSNS.Worksheet, text: string, sub?: string) {
  ws.getCell('A1').value = safeText(text);
  ws.getCell('A1').font = { bold: true, size: 16, color: { argb: INK } };
  ws.getRow(1).height = 26;
  if (sub) {
    ws.getCell('A2').value = safeText(sub);
    ws.getCell('A2').font = { size: 10, color: { argb: MUTED } };
  }
}

function widths(ws: ExcelJSNS.Worksheet, sample: (string | number | boolean | Date | null)[][], cols: number, max = 42) {
  for (let c = 0; c < cols; c++) {
    let w = 10;
    for (const r of sample) {
      const v = r[c];
      const len = v === null || v === undefined ? 0 : v instanceof Date ? 11 : typeof v === 'number' ? 14 : String(v).length;
      w = Math.max(w, len + 2);
    }
    ws.getColumn(c + 1).width = Math.min(max, w);
  }
}

const colLetter = (n: number) => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

function addVisualSheet(wb: ExcelJSNS.Workbook, v: WorkbookInput['visuals'][number], name: string) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 3 }] });
  title(ws, v.title);
  const first = 3;
  const additiveCols = v.additive.flatMap((a, i) => (a ? [i] : []));
  const shareCol = additiveCols.length === 1 ? additiveCols[0] : -1;
  const headers = [...v.headers.map(safeText), ...(shareCol >= 0 ? ['% of total'] : [])];
  headers.forEach((h, c) => { ws.getCell(first, c + 1).value = h; });
  headerRow(ws, first, headers.length);
  const start = first + 1;
  const end = first + v.rows.length;
  const total = end + 1;
  const hasTotal = additiveCols.length > 0 && v.rows.length > 0;
  const sumFor = (c: number) => v.rows.reduce((s, r) => s + (typeof r[c] === 'number' && Number.isFinite(r[c] as number) ? (r[c] as number) : 0), 0);

  v.rows.forEach((r, i) => {
    const rowNo = start + i;
    r.forEach((val, c) => {
      const cell = ws.getCell(rowNo, c + 1);
      cell.value = safeCell(val);
      if (typeof val === 'number') cell.numFmt = numFmt(v.formats[c]?.format, v.formats[c]?.currency);
    });
    if (shareCol >= 0) {
      const L = colLetter(shareCol + 1);
      const val = r[shareCol];
      const whole = sumFor(shareCol);
      const cell = ws.getCell(rowNo, headers.length);
      if (typeof val === 'number' && Number.isFinite(val)) {
        const result = whole !== 0 ? val / whole : '';
        cell.value = { formula: `IF(${L}$${total}=0,"",${L}${rowNo}/${L}$${total})`, result } as ExcelJSNS.CellFormulaValue;
      } else cell.value = null;
      cell.numFmt = '0.0%';
    }
  });

  if (hasTotal) {
    ws.getCell(total, 1).value = 'Total';
    additiveCols.forEach((c) => {
      const L = colLetter(c + 1);
      const cell = ws.getCell(total, c + 1);
      cell.value = { formula: `SUM(${L}${start}:${L}${end})`, result: sumFor(c) } as ExcelJSNS.CellFormulaValue;
      cell.numFmt = numFmt(v.formats[c]?.format, v.formats[c]?.currency);
    });
    if (shareCol >= 0) {
      const L = colLetter(headers.length);
      const c = ws.getCell(total, headers.length);
      c.value = { formula: `SUM(${L}${start}:${L}${end})`, result: sumFor(shareCol) !== 0 ? 1 : 0 } as ExcelJSNS.CellFormulaValue;
      c.numFmt = '0.0%';
    }
    const tr = ws.getRow(total);
    tr.font = { bold: true };
    for (let c = 1; c <= headers.length; c++) tr.getCell(c).border = { top: { style: 'thin', color: { argb: INK } } };
  } else if (v.overall && v.overall.some((x, i) => i > 0 && x !== null)) {
    // Averages and rates cannot be added. This is the true overall value from the underlying rows.
    v.overall.forEach((val, c) => {
      const cell = ws.getCell(total, c + 1);
      cell.value = safeCell(val);
      if (typeof val === 'number') cell.numFmt = numFmt(v.formats[c]?.format, v.formats[c]?.currency);
    });
    ws.getRow(total).font = { bold: true };
  }
  widths(ws, [headers, ...v.rows.slice(0, 200).map((r) => r.map((x) => safeCell(x)))], headers.length);
}

export async function buildWorkbook(input: WorkbookInput, opts: WorkbookOptions): Promise<ArrayBuffer> {
  const mod = await import('exceljs');
  const ExcelJS = (mod.default ?? mod) as typeof ExcelJSNS;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Statistical Report Workspace';
  wb.created = input.generatedAt;
  wb.modified = input.generatedAt;
  wb.calcProperties = { fullCalcOnLoad: true };
  const used = new Set<string>();
  const stamp = input.generatedAt.toISOString().slice(0, 16).replace('T', ' ');

  /* Summary ---------------------------------------------------------------------------------- */
  const sum = wb.addWorksheet(safeSheetName('Summary', used), { views: [{ showGridLines: false }] });
  title(sum, input.title, `Generated ${stamp} UTC. Filters applied: ${input.filters}`);
  sum.getColumn(1).width = 38;
  sum.getColumn(2).width = 22;
  sum.getColumn(3).width = 60;
  let row = 4;
  ['Key figure', 'Value', 'Comparison'].forEach((h, i) => { sum.getCell(row, i + 1).value = h; });
  headerRow(sum, row, 3);
  row++;
  for (const k of input.kpis) {
    sum.getCell(row, 1).value = safeText(k.label);
    const c = sum.getCell(row, 2);
    c.value = safeCell(k.value);
    c.numFmt = numFmt(k.format, k.currency);
    c.font = { bold: true };
    sum.getCell(row, 3).value = k.note ? safeText(k.note) : null;
    row++;
  }
  row++;
  sum.getCell(row, 1).value = 'Finding';
  sum.getCell(row, 2).value = 'Detail';
  sum.mergeCells(row, 2, row, 3);
  headerRow(sum, row, 3);
  row++;
  for (const i of input.insights.slice(0, 15)) {
    sum.getCell(row, 1).value = safeText(i.headline);
    sum.getCell(row, 1).alignment = { wrapText: true, vertical: 'top' };
    sum.getCell(row, 1).font = { bold: true };
    sum.getCell(row, 2).value = safeText(i.text);
    sum.mergeCells(row, 2, row, 3);
    sum.getCell(row, 2).alignment = { wrapText: true, vertical: 'top' };
    sum.getRow(row).height = Math.max(32, Math.ceil(i.text.length / 85) * 16);
    row++;
  }

  /* Charts (Excel only: Google Sheets recreates data views from the tables) ----------------- */
  const pictures = opts.target === 'excel' ? input.visuals.filter((v) => v.image) : [];
  if (pictures.length) {
    const ws = wb.addWorksheet(safeSheetName('Charts', used), { views: [{ showGridLines: false }] });
    title(ws, 'Charts', input.title);
    pictures.forEach((v, i) => {
      const id = wb.addImage({ base64: v.image!.base64, extension: 'png' });
      const col = i % 2 === 0 ? 0 : 10;
      const top = 3 + Math.floor(i / 2) * 22;
      const heading = ws.getCell(top, col + 1);
      heading.value = safeText(v.title);
      heading.font = { bold: true, size: 12, color: { argb: INK } };
      ws.addImage(id, { tl: { col, row: top } as ExcelJSNS.Anchor, ext: { width: 620, height: Math.round((620 * v.image!.height) / v.image!.width) }, editAs: 'oneCell' });
    });
  }

  /* One sheet of data for each visual -------------------------------------------------------- */
  input.visuals.filter((v) => v.rows.length).slice(0, 40).forEach((v) => addVisualSheet(wb, v, safeSheetName(v.title, used)));

  /* Underlying data -------------------------------------------------------------------------- */
  const cols = input.data.columns;
  let count = input.rows.length;
  let note = `${count.toLocaleString('en-US')} rows after filters and corrections`;
  const cellLimit = opts.target === 'sheets' ? Math.floor(SHEETS_MAX_CELLS * 0.8 / Math.max(1, cols.length)) : Infinity;
  const limit = Math.min(EXCEL_MAX_ROWS - 3, cellLimit);
  if (count > limit) {
    note = `First ${limit.toLocaleString('en-US')} of ${count.toLocaleString('en-US')} rows. The spreadsheet limit was reached.`;
    count = limit;
  }
  const ds = wb.addWorksheet(safeSheetName('Data', used), { views: [{ state: 'frozen', ySplit: 3 }] });
  title(ds, input.data.name, note);
  const heads = cols.map((c) => safeText(c.name));
  heads.forEach((h, c) => { ds.getCell(3, c + 1).value = h; });
  headerRow(ds, 3, cols.length);
  const fmts = cols.map((c) => (c.type === 'date' ? 'yyyy-mm-dd' : c.type === 'number' ? numFmt(c.format, c.currency) : undefined));
  cols.forEach((c, i) => {
    const f = fmts[i];
    if (f) ds.getColumn(i + 1).numFmt = f;
    void c;
  });
  const sample: ReturnType<typeof safeCell>[][] = [heads];
  for (let i = 0; i < count; i++) {
    const r = input.rows[i];
    const vals = cols.map((c) => safeCell(c.values[r], c));
    ds.addRow(vals);
    if (i < 200) sample.push(vals);
  }
  if (cols.length && count > 0) ds.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + count, column: cols.length } };
  widths(ds, sample, cols.length);

  /* Column profile --------------------------------------------------------------------------- */
  const pf = wb.addWorksheet(safeSheetName('Column Statistics', used), { views: [{ state: 'frozen', ySplit: 3 }] });
  title(pf, 'Column statistics');
  const pfHead = ['Column', 'Type', 'Values', 'Missing', 'Missing %', 'Distinct', 'Mean', 'Median', 'Std dev', 'Min', 'Max', 'Q1', 'Q3', 'Skewness', 'Kurtosis', '95% CI low', '95% CI high', 'Outliers (IQR)'];
  pfHead.forEach((h, i) => { pf.getCell(3, i + 1).value = h; });
  headerRow(pf, 3, pfHead.length);
  input.profile.forEach((p, i) => {
    const vals: (string | number | undefined)[] = [p.name, p.type, p.count, p.missing, p.missingPct, p.distinct, p.mean, p.median, p.stdev, p.min, p.max, p.q1, p.q3, p.skew, p.kurt, p.ciLow, p.ciHigh, p.outliersIqr];
    vals.forEach((v, c) => {
      const cell = pf.getCell(4 + i, c + 1);
      cell.value = safeCell(v ?? null);
      if (typeof v === 'number') cell.numFmt = c === 4 ? '0.0%' : [2, 3, 5, 17].includes(c) ? '#,##0' : '#,##0.00';
    });
  });
  widths(pf, [pfHead], pfHead.length, 22);
  pf.getColumn(1).width = 28;

  /* Corrections audit trail ------------------------------------------------------------------ */
  const changes: CellChange[] = input.findings.flatMap((f) => f.changes);
  const cr = wb.addWorksheet(safeSheetName('Corrections', used), { views: [{ state: 'frozen', ySplit: 3 }] });
  title(cr, 'Corrections and data checks', `${changes.length.toLocaleString('en-US')} calculated values corrected. File row numbers include the header row.`);
  const crHead = ['Check', 'Severity', 'Column', 'Affected', 'What was found'];
  crHead.forEach((h, i) => { cr.getCell(3, i + 1).value = h; });
  headerRow(cr, 3, crHead.length);
  let at = 4;
  for (const f of input.findings) {
    [f.title, f.severity, f.column ?? '', f.count, f.detail].forEach((v, c) => { cr.getCell(at, c + 1).value = typeof v === 'string' ? safeText(v) : v; });
    cr.getCell(at, 1).alignment = { wrapText: true, vertical: 'top' };
    cr.getCell(at, 5).alignment = { wrapText: true, vertical: 'top' };
    at++;
  }
  [46, 11, 22, 10, 80].forEach((w, i) => { cr.getColumn(i + 1).width = w; });
  if (changes.length) {
    at += 1;
    ['File row', 'Column', 'Original value', 'Corrected value', 'Reason'].forEach((h, i) => { cr.getCell(at, i + 1).value = h; });
    headerRow(cr, at, 5);
    at++;
    for (const c of changes.slice(0, 50000)) {
      [c.row + 2, safeText(c.column), safeCell(c.before), safeCell(c.after), safeText(c.reason)].forEach((v, i) => { cr.getCell(at, i + 1).value = v; });
      at++;
    }
  }

  /* Measures --------------------------------------------------------------------------------- */
  if (input.measures.length) {
    const ms = wb.addWorksheet(safeSheetName('Measures', used));
    title(ms, 'Calculated measures');
    ['Measure', 'Formula'].forEach((h, i) => { ms.getCell(3, i + 1).value = h; });
    headerRow(ms, 3, 2);
    input.measures.forEach((m, i) => {
      ms.getCell(4 + i, 1).value = safeText(m.name);
      // Stored as text. A leading = must not be read as a spreadsheet formula.
      ms.getCell(4 + i, 2).value = safeText(m.expr);
    });
    ms.getColumn(1).width = 30;
    ms.getColumn(2).width = 90;
  }

  return (await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer;
}

/* ---------- CSV ---------- */

/** Neutralizes text that a spreadsheet would run as a formula when the CSV is opened. */
export function csvEscape(v: string | number | boolean | null): string {
  if (v === null) return '';
  if (typeof v !== 'string') return String(v);
  const guarded = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function buildCsv(t: DataTable, rows: ArrayLike<number>): string {
  const lines = [t.columns.map((c) => csvEscape(c.name)).join(',')];
  for (let i = 0; i < rows.length; i++) {
    lines.push(t.columns.map((c) => {
      const v = c.values[rows[i]];
      if (c.type === 'date' && typeof v === 'number') return new Date(v).toISOString().slice(0, 10);
      return csvEscape(v ?? null);
    }).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}
