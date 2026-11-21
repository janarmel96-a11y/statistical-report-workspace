// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import * as XLSX from 'xlsx';
import {
  CLASSES, compareWithSheet, DAY, dayEntries, EM, ERROR_FIELDS, lineValues, misspellingAudit, monthMismatches, monthRange, MONTHS,
  overallLabel, overallTitle, PATIENT_TYPES, periodStats, philippineHolidays, workerChecks, workingDays,
  type DayEntry, type MswdCheck, type MswdReport, type Prepared,
} from '../core/mswd';
import { analyzeMswd } from '../core/mswdAnalyst';
import type { RawCell } from '../core/types';
import { safeSheetName } from './workbook';
import { colName, StyleBook, writeXlsx, type XCell, type XRow, type XSheet, type XStyle } from './xlsxWriter';

/**
 * Builds the MSWD performance workbook in the layout of the original report: DASHBOARD, DATA CHECKS,
 * MSWD PERFORMANCE, WORKER REPORT, MASTER DATA, one sheet per month, and their helper sheets.
 * Every number is an Excel formula over MASTER DATA, saved with the value this app calculated,
 * so the file is correct the moment it opens and stays correct when MASTER DATA is edited.
 */

export interface MswdWorkbookOptions {
  department: string;
  /** Adds a hidden copy of MASTER DATA for each month, as in the original workbook. */
  monthSheets: boolean;
  dailyTarget: number;
  lowCount: number;
}

export const DEFAULT_OPTIONS: MswdWorkbookOptions = { department: 'MALASAKIT CENTER', monthSheets: true, dailyTarget: 15, lowCount: 50 };

const NAMES = {
  dashboard: 'DASHBOARD', settings: 'DASHBOARD SETTINGS', checks: 'DATA CHECKS', performance: 'MSWD PERFORMANCE', totals: 'RSW MONTHLY TOTALS',
  audit: 'MISSPELLING AUDIT', master: 'MASTER DATA', worker: 'WORKER REPORT', data: 'DASHBOARD DATA',
};

const q = (sheet: string) => `'${sheet.replace(/'/g, "''")}'`;
const str = (s: string) => `"${s.replace(/"/g, '""')}"`;
/** A COUNTIFS criterion that matches this exact text: no wildcards, and never read as a comparison. */
const exact = (s: string) => str(`=${s.replace(/[~*?]/g, '~$&')}`);
const isDate = (v: RawCell): v is { date: number } => typeof v === 'object' && v !== null;
const inExcelRange = (ms: number) => ms >= Date.UTC(1900, 2, 1) && ms <= Date.UTC(9999, 11, 31);
const serial = (ms: number) => ms / DAY + 25569;
const ALL = 'ALL WORKERS';
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Excel's TEXT(date, "mmm d") and TEXT(date, "mmm d, yyyy"). */
const mmmd = (ms: number, year = false) => { const d = new Date(ms); return `${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}${year ? `, ${d.getUTCFullYear()}` : ''}`; };
const ALL_DEPT = 'ALL DEPARTMENTS';

function styles() {
  const book = new StyleBook();
  const A = (s: XStyle) => book.add({ font: 'Arial', size: 10, ...s });
  const line = 'BFBFBF';
  const head = (fill: string, size = 10) => A({ bold: true, size, color: 'FFFFFF', fill, border: line, align: 'center', valign: 'center', wrap: true });
  return {
    book,
    title: A({ bold: true, size: 16, color: '1F4E5F', align: 'center' }),
    blockTitle: A({ bold: true, size: 22, color: '1F4E5F', align: 'center' }),
    gold: head('B8860B'), goldSmall: head('B8860B', 9),
    navy: head('1F4E5F'), blue: head('2E75B6'), green: head('548235'), red: head('C00000'), brown: head('7F6000'),
    blueSmall: head('2E75B6', 9), greenSmall: head('548235', 9), redSmall: head('C00000', 9), brownSmall: head('7F6000', 9),
    summaryText: A({ fill: 'FFE699', border: line, numFmt: '@' }),
    summaryName: A({ bold: true, fill: 'FFE699', border: line }),
    summaryNumber: A({ bold: true, fill: 'FFE699', border: line, align: 'center', numFmt: '#,##0' }),
    name: A({ border: line }),
    count: A({ border: line, align: 'center' }),
    totalName: A({ bold: true, fill: 'DDEBF7', border: line }),
    totalCount: A({ bold: true, fill: 'DDEBF7', border: line, align: 'center' }),
    blank: A({ border: line }),
    helperHead: A({ bold: true, size: 11, fill: 'B2A1C7', align: 'center', valign: 'center' }),
    plain: A({}),
    wrapped: A({ size: 11, wrap: true, valign: 'top' }),
    aiTitle: A({ bold: true, size: 16, color: 'FFFFFF', fill: '4E5B92', valign: 'center' }),
    aiHeadline: A({ bold: true, size: 13, color: '1E2C71', wrap: true, valign: 'top' }),
    bold: A({ bold: true }),
    note: A({ size: 9, color: '71798B', valign: 'center' }),
    // Dashboard
    dashTitle: A({ bold: true, size: 14, color: 'FFFFFF', fill: '4E5B92', align: 'left', valign: 'center' }),
    label: A({ bold: true, color: '333E58', valign: 'center' }),
    input: A({ bold: true, color: '0000FF', fill: 'FFFF00', valign: 'center' }),
    inputDate: A({ bold: true, color: '0000FF', fill: 'FFFF00', valign: 'center', numFmt: 'mmm d, yyyy' }),
    inputNumber: A({ bold: true, color: '0000FF', fill: 'FFFF00', valign: 'center', numFmt: '#,##0' }),
    shownDate: A({ bold: true, color: '333E58', align: 'left', valign: 'center', numFmt: 'mmm d, yyyy' }),
    shownNumber: A({ bold: true, color: '333E58', align: 'left', valign: 'center', numFmt: '#,##0' }),
    kpiLabel: A({ bold: true, size: 9, color: '3E4B8B', fill: 'ECF0FF', align: 'center', valign: 'center', wrap: true }),
    kpiValue: A({ bold: true, size: 16, color: '1E2C71', fill: 'ECF0FF', align: 'center', valign: 'center', numFmt: '#,##0' }),
    kpiDecimal: A({ bold: true, size: 16, color: '1E2C71', fill: 'ECF0FF', align: 'center', valign: 'center', numFmt: '#,##0.0' }),
    kpiName: A({ bold: true, color: '7E3E0B', fill: 'ECF0FF', align: 'center', valign: 'center', wrap: true }),
    kpiNote: A({ size: 8, color: '71798B', fill: 'ECF0FF', align: 'center', valign: 'center', wrap: true }),
    section: A({ bold: true, size: 11, color: '1E2C71', fill: 'DDDFFF', valign: 'center' }),
    th: A({ bold: true, size: 9, color: 'FFFFFF', fill: '4E5B92', border: line, align: 'center', valign: 'center', wrap: true }),
    td: A({ border: 'D8D8D8', valign: 'center' }),
    tdNumber: A({ border: 'D8D8D8', valign: 'center', numFmt: '#,##0' }),
    tdDecimal: A({ border: 'D8D8D8', valign: 'center', numFmt: '#,##0.0' }),
    tdSigned: A({ border: 'D8D8D8', valign: 'center', numFmt: '+#,##0.0;-#,##0.0;0.0' }),
    tdPercent: A({ border: 'D8D8D8', valign: 'center', numFmt: '0.0%' }),
    tdDate: A({ border: 'D8D8D8', valign: 'center', numFmt: 'mmm d, yyyy', align: 'left' }),
    tdSmallDate: A({ size: 9, color: '71798B', border: 'D8D8D8', valign: 'center', numFmt: 'mmm d, yyyy' }),
    tdStamp: A({ border: 'D8D8D8', valign: 'center', numFmt: 'yyyy-mm-dd hh:mm' }),
    tdTotal: A({ bold: true, fill: 'DDDFFF', border: 'BFBFBF', valign: 'center' }),
    tdTotalNumber: A({ bold: true, fill: 'DDDFFF', border: 'BFBFBF', valign: 'center', numFmt: '#,##0' }),
    tdTotalDecimal: A({ bold: true, fill: 'DDDFFF', border: 'BFBFBF', valign: 'center', numFmt: '#,##0.0' }),
    tdTotalPercent: A({ bold: true, fill: 'DDDFFF', border: 'BFBFBF', valign: 'center', numFmt: '0.0%' }),
    hidden: A({ color: 'FFFFFF' }),
    // Data sheets
    dataHead: book.add({ bold: true, size: 11, font: 'Calibri', fill: 'E8F0FB', valign: 'top', wrap: true }),
    day: book.add({ size: 11, font: 'Calibri', numFmt: 'yyyy-mm-dd' }),
    stamp: book.add({ size: 11, font: 'Calibri', numFmt: 'yyyy-mm-dd hh:mm:ss' }),
    whole: book.add({ size: 11, font: 'Calibri', numFmt: '0' }),
    good: A({ color: '006100', fill: 'C6EFCE', border: 'D8D8D8' }),
    warn: A({ color: '9C5700', fill: 'FFEB9C', border: 'D8D8D8' }),
    bad: A({ color: '9C0006', fill: 'FFC7CE', border: 'D8D8D8' }),
    info: A({ color: '1F4E79', fill: 'DDEBF7', border: 'D8D8D8' }),
  };
}
type Styles = ReturnType<typeof styles>;

/** A sparse grid of cells that is turned into sheet rows at the end. */
class Grid {
  rows: (XCell | null)[][] = [];
  heights = new Map<number, number>();
  set(r: number, c: number, cell: XCell | null) { (this.rows[r] ??= [])[c] = cell; }
  /** Row and column are counted from zero. */
  put(r: number, c: number, v: XCell['v'], s?: number) { this.set(r, c, { v, s }); }
  f(r: number, c: number, f: string, v: XCell['v'], s?: number) { this.set(r, c, { f, v, s }); }
  out(): () => Iterable<XRow> {
    const rows = this.rows;
    const heights = this.heights;
    return function* () { for (let r = 0; r < rows.length; r++) yield { cells: rows[r] ?? [], height: heights.get(r) }; };
  }
}
const ref = (r: number, c: number, absRow = false, absCol = false) => `${absCol ? '$' : ''}${colName(c)}${absRow ? '$' : ''}${r + 1}`;
const abs = (r: number, c: number) => ref(r, c, true, true);
const span = (r1: number, c1: number, r2: number, c2: number) => `${abs(r1, c1)}:${abs(r2, c2)}`;
const area = (r1: number, c1: number, r2: number, c2: number) => `${ref(r1, c1)}:${ref(r2, c2)}`;

function cellOf(v: RawCell, st: Styles): XCell | null {
  if (v === null || v === undefined || v === '') return null;
  if (isDate(v)) return inExcelRange(v.date) ? { date: v.date, s: v.date % DAY === 0 ? st.day : st.stamp } : { v: new Date(v.date).toISOString().slice(0, 19).replace('T', ' ') };
  if (typeof v === 'number') return Number.isFinite(v) ? { v, s: Number.isInteger(v) && Math.abs(v) >= 100000 ? st.whole : undefined } : null;
  return { v };
}

function dataSheet(name: string, headers: string[], rows: RawCell[][], st: Styles, hidden = false): XSheet {
  return {
    name, hidden,
    cols: headers.map((h) => ({ width: Math.min(40, Math.max(12, String(h).length * 0.9)) })),
    freeze: { rows: 1, cols: 0 },
    autoFilter: headers.length ? `A1:${colName(headers.length - 1)}${Math.max(1, rows.length) + 1}` : undefined,
    rows: function* () {
      yield { height: 45, cells: headers.map((h) => ({ v: h, s: st.dataHead })) };
      for (const r of rows) yield { cells: r.map((v) => cellOf(v, st)) };
    },
  };
}

interface Context {
  p: Prepared;
  report: MswdReport;
  checks: MswdCheck[];
  opts: MswdWorkbookOptions;
  st: Styles;
  entries: DayEntry[];
  /** Last row of MASTER DATA and DASHBOARD DATA, counted from one. */
  end: number;
  master: (field: keyof Prepared['cols']) => string | null;
  data: (col: string) => string;
  holidays: { date: number; name: string; type: string }[];
  holidayRange: string;
  dataThrough: number | null;
  settings: { methodCell: string; fixedCell: string; lowCell: string; throughCell: string; workerList: string; deptList: string; deptRange: string };
}

/* ---------- MSWD PERFORMANCE ---------- */

function performanceSheet(x: Context): XSheet {
  const { report, st } = x;
  const g = new Grid();
  const W = report.workers.length;
  const M = report.months.length;
  const merges: string[] = [];
  const rules: XSheet['rules'] = [];
  const masterOf = (f: keyof Prepared['cols']) => x.master(f);
  const monthCol = masterOf('month');
  const workerCol = masterOf('worker');

  g.put(0, 0, report.title, st.title);
  g.heights.set(0, 24);
  merges.push(area(0, 0, 0, 18));
  g.put(2, 0, `MOST PATIENTS CATERED ${EM} TOP RSW PER MONTH`, st.gold);
  merges.push(area(2, 0, 2, 3));
  ['MONTH', 'TOP RSW (MOST PATIENTS CATERED)', 'PATIENTS', 'MONTH TOTAL'].forEach((h, c) => g.put(3, c, h, st.goldSmall));

  const firstBlock = 4 + M + 1 + 2;
  const stride = W + 6;
  report.blocks.forEach((b, i) => {
    const t = firstBlock + i * stride;
    const first = t + 3;
    const last = t + 2 + Math.max(W, 1);
    const isOverall = b.label === null;
    const month = b.label;
    g.put(t, 0, isOverall ? overallTitle(report.months) : `MSWD PERFORMANCE ${EM} ${month}`, st.blockTitle);
    g.heights.set(t, 32);
    merges.push(area(t, 0, t, 18));
    g.put(t + 1, 0, 'RSW NAMES', st.navy); g.put(t + 2, 0, null, st.navy); merges.push(area(t + 1, 0, t + 2, 0));
    g.put(t + 1, 1, 'TOTAL PATIENT CATERED', st.navy); g.put(t + 2, 1, null, st.navy); merges.push(area(t + 1, 1, t + 2, 1));
    const groups: [string, number, number, number, number][] = [
      ['TYPE OF PATIENT', 2, 5, st.blue, st.blueSmall], ['CLASSIFICATION', 6, 10, st.green, st.greenSmall],
      ['MISSPELLINGS IN BARANGAY, MUNICIPALITY, PROVINCE & REGION', 11, 15, st.red, st.redSmall], ['PATIENT TYPE', 16, 17, st.brown, st.brownSmall],
    ];
    for (const [name, c1, c2, big] of groups) { for (let c = c1; c <= c2; c++) g.put(t + 1, c, c === c1 ? name : null, big); merges.push(area(t + 1, c1, t + 1, c2)); }
    const subs = [...PATIENT_TYPES, ...CLASSES, 'Barangay', 'Municipality', 'Province', 'Region', 'TOTAL', 'NEW', 'OLD'];
    subs.forEach((s, k) => { const c = 2 + k; const small = c <= 5 ? st.blueSmall : c <= 10 ? st.greenSmall : c <= 15 ? st.redSmall : st.brownSmall; g.put(t + 2, c, s, small); });
    g.put(t + 1, 18, 'RANK', st.navy); g.put(t + 2, 18, null, st.navy); merges.push(area(t + 1, 18, t + 2, 18));
    g.put(t + 1, 19, 'SCHEDULE (7-3, 3-11, 11-7)', st.navy); g.put(t + 2, 19, null, st.navy); merges.push(area(t + 1, 19, t + 2, 19));
    g.put(t + 1, 20, isOverall ? 'OVERALL' : (month ?? '').split(' ')[0], st.helperHead);

    const crit = (extra: string) => {
      const parts = [isOverall || !monthCol ? null : `${monthCol},${str(month!)}`, workerCol ? `${workerCol},$A${'{R}'}` : null, extra || null].filter(Boolean);
      return parts.join(',');
    };
    const countF = (extraCol: string | null, value: string | null) => (workerCol ? `COUNTIFS(${crit(extraCol && value ? `${extraCol},${value}` : '')})` : null);
    const typeCol = masterOf('typeOfPatient');
    const classCol = masterOf('classification');
    const ptCol = masterOf('patientType');
    const errCols = ERROR_FIELDS.map((f) => masterOf(f));
    const totalErrCol = masterOf('totalErrors');
    // Unique ranks decide the hidden sorted list in columns U and V, ties keeping the alphabetical order.
    const order = b.lines.map((l, k) => ({ l, k })).sort((a, c) => c.l.total - a.l.total || a.k - c.k);
    b.lines.forEach((l, k) => {
      const r = first + k;
      const R = String(r + 1);
      const withRow = (f: string | null) => (f ? `${f.replace(/\{R\}/g, R)}` : null);
      const put = (c: number, f: string | null, v: number) => (f ? g.f(r, c, withRow(f)!, v, st.count) : g.put(r, c, v, st.count));
      g.put(r, 0, l.name, st.name);
      put(1, countF(null, null), l.total);
      PATIENT_TYPES.forEach((tp, j) => put(2 + j, typeCol ? countF(typeCol, str(tp)) : null, l.types[j]));
      CLASSES.forEach((cl, j) => put(6 + j, classCol ? countF(classCol, str(cl)) : null, l.classes[j]));
      errCols.forEach((ec, j) => put(11 + j, ec ? countF(ec, '"?*"') : null, l.errors[j]));
      put(15, totalErrCol && workerCol ? `SUMIFS(${totalErrCol},${crit('')})` : null, l.errorTotal);
      put(16, ptCol ? countF(ptCol, '"NEW"') : null, l.newPatients);
      put(17, ptCol ? countF(ptCol, '"OLD"') : null, l.oldPatients);
      g.f(r, 18, `RANK($B${R},${span(first, 1, last, 1)})`, l.rank, st.count);
      g.put(r, 19, null, st.blank);
      const unique = order.findIndex((o) => o.k === k) + 1;
      g.f(r, 22, `COUNTIF(${span(first, 1, last, 1)},">"&$B${R})+COUNTIF(${abs(first, 1)}:$B${R},$B${R})`, unique);
      const sorted = order[k];
      g.f(t + 2 + k, 20, `INDEX(${span(first, 0, last, 0)},MATCH(${k + 1},${span(first, 22, last, 22)},0))`, sorted.l.name);
      g.f(t + 2 + k, 21, `INDEX(${span(first, 1, last, 1)},MATCH(${k + 1},${span(first, 22, last, 22)},0))`, sorted.l.total);
    });
    const tr = last + 1;
    g.put(tr, 0, 'TOTAL', st.totalName);
    lineValues(b.total).forEach((v, j) => g.f(tr, 1 + j, `SUM(${area(first, 1 + j, last, 1 + j)})`, v, st.totalCount));
    g.put(tr, 18, null, st.totalCount);
    if (W) rules.push({ type: 'expression', ref: area(first, 0, last, 18), formula: `AND($B${first + 1}>0,$B${first + 1}=MAX(${span(first, 1, last, 1)}))`, style: { bold: true, fill: 'FFE699' } });

    // Summary row at the top of the sheet.
    const sr = 4 + i;
    const partial = !isOverall && i === M - 1 && report.months[i]?.partial;
    g.put(sr, 0, isOverall ? overallLabel(report.months) : `${month}${partial ? ' (partial)' : ''}`, st.summaryText);
    g.f(sr, 1, `INDEX(${span(first, 0, last, 0)},MATCH(MAX(${span(first, 1, last, 1)}),${span(first, 1, last, 1)},0))`, b.top.name, st.summaryName);
    g.f(sr, 2, `MAX(${span(first, 1, last, 1)})`, b.top.count, st.summaryNumber);
    g.f(sr, 3, `SUM(${span(first, 1, last, 1)})`, b.total.total, st.summaryNumber);
  });

  const widths = [32, 30, 11, 11, 11, 11.57, 11, 11, 11, 11, 11, 11, 11, 11, 11, 9, 11, 11, 7, 12, 33, 8, 9];
  // The misspelling columns and the sorting helpers are hidden, as in the original workbook.
  const hiddenCols = new Set([11, 12, 13, 14, 15, 20, 21, 22]);
  return {
    name: NAMES.performance, rows: g.out(), merges, rules, freeze: { rows: 0, cols: 1 },
    cols: widths.map((width, c) => ({ width, hidden: hiddenCols.has(c) })),
  };
}

/* ---------- RSW MONTHLY TOTALS ---------- */

function totalsSheet(x: Context): XSheet {
  const { report, st } = x;
  const g = new Grid();
  const W = report.workers.length;
  const M = report.months.length;
  const monthCol = x.master('month');
  const workerCol = x.master('worker');
  const last = report.months[M - 1];
  const range = last ? monthRange(last.label) : null;
  const titled = (m: string) => m.charAt(0) + m.slice(1).toLowerCase();
  const period = report.title.split(`${EM}  `)[1]?.replace(/\s*\(.*$/, '') ?? '';
  g.put(0, 0, `RSW MONTHLY TOTALS ${EM} PATIENTS CATERED${period ? `, ${period}` : ''}`, st.bold);
  const partialNote = last?.partial && range ? ` ${titled(last.label)} covers ${titled(MONTHS[new Date(range.from).getUTCMonth()])} ${last.partial} only.` : '';
  g.put(1, 0, `Counts come from MASTER DATA (Month and Medical Social Worker columns).${partialNote}`, st.note);
  g.put(3, 0, 'RSW NAMES', st.navy);
  report.months.forEach((m, j) => g.put(3, 1 + j, m.label, st.navy));
  g.put(3, 1 + M, 'TOTAL', st.navy);
  g.put(3, 2 + M, 'RANK', st.navy);
  const overall = report.blocks[report.blocks.length - 1];
  const first = 4;
  const lastRow = 3 + Math.max(W, 1);
  report.workers.forEach((w, k) => {
    const r = first + k;
    g.put(r, 0, w, st.name);
    report.months.forEach((_, j) => {
      const v = report.blocks[j].lines[k].total;
      if (monthCol && workerCol) g.f(r, 1 + j, `COUNTIFS(${monthCol},${ref(3, 1 + j, true)},${workerCol},$A${r + 1})`, v, st.count);
      else g.put(r, 1 + j, v, st.count);
    });
    g.f(r, 1 + M, M ? `SUM(${area(r, 1, r, M)})` : '0', overall.lines[k].total, st.totalCount);
    g.f(r, 2 + M, `RANK(${ref(r, 1 + M)},${span(first, 1 + M, lastRow, 1 + M)})`, overall.lines[k].rank, st.count);
  });
  const tr = lastRow + 1;
  g.put(tr, 0, 'TOTAL', st.totalName);
  for (let j = 0; j <= M; j++) g.f(tr, 1 + j, `SUM(${area(first, 1 + j, lastRow, 1 + j)})`, j < M ? report.blocks[j].total.total : overall.total.total, st.totalCount);
  g.put(tr + 1, 0, 'TOP RSW', st.totalName);
  for (let j = 0; j <= M; j++) {
    const b = j < M ? report.blocks[j] : overall;
    g.f(tr + 1, 1 + j, `INDEX(${span(first, 0, lastRow, 0)},MATCH(MAX(${area(first, 1 + j, lastRow, 1 + j)}),${area(first, 1 + j, lastRow, 1 + j)},0))`, b.top.name, st.totalName);
  }
  const chart = M ? [{
    title: `Total Patients Catered per Month${last?.partial ? ` (${last.label.split(' ')[0].toLowerCase().replace(/^./, (s) => s.toUpperCase())} partial)` : ''}`,
    at: { row: tr + 3, col: 0 }, width: 900, height: 380,
    series: [{ name: 'Patients catered', categories: `${q(NAMES.totals)}!${span(3, 1, 3, M)}`, values: `${q(NAMES.totals)}!${span(tr, 1, tr, M)}`, color: 'B8860B',
      cache: { categories: report.months.map((m) => m.label), values: report.blocks.slice(0, M).map((b) => b.total.total) } }],
  }] : [];
  return {
    name: NAMES.totals, hidden: true, rows: g.out(), freeze: { rows: 4, cols: 1 }, charts: chart,
    cols: [{ width: 34 }, ...report.months.map(() => ({ width: 16 })), { width: 12 }, { width: 8 }],
  };
}

/* ---------- DASHBOARD DATA and DASHBOARD SETTINGS ---------- */

function dashboardDataSheet(x: Context): XSheet {
  const { entries, st } = x;
  return {
    name: NAMES.data,
    cols: [{ width: 13 }, { width: 34 }, { width: 13 }, { width: 42 }, { width: 11 }, { width: 14 }, { width: 14 }, { width: 28 }, { width: 3 }, { width: 70 }],
    freeze: { rows: 1, cols: 0 },
    rows: function* () {
      yield { height: 30, cells: ['Date', 'Medical Social Worker', 'Patient Type', 'Worker-Date Key', 'First Entry of Day', 'Type of Patient', 'Classification', 'Service', null, 'Helper columns for DASHBOARD and DATA CHECKS. They are filled from MASTER DATA by the app; do not type here.'].map((v, i) => (v === null ? null : { v, s: i === 9 ? st.note : st.dataHead })) };
      for (const e of entries) {
        yield { cells: [
          e.day === null ? null : { date: e.day, s: st.day }, e.worker === null ? null : { v: e.worker }, e.patientType === null ? null : { v: e.patientType },
          e.worker === null || e.day === null ? null : { v: `${e.worker}|${serial(e.day)}` }, e.first ? { v: 1 } : null,
          e.type === null ? null : { v: e.type }, e.classification === null ? null : { v: e.classification }, e.service === null ? null : { v: e.service },
        ] };
      }
    },
  };
}

function settingsSheet(x: Context): XSheet {
  const { st, report, opts } = x;
  const g = new Grid();
  g.put(1, 1, 'DASHBOARD SETTINGS', st.section);
  g.put(3, 1, 'Working days method', st.label); g.put(3, 2, 'CALENDAR', st.input);
  g.put(3, 3, 'CALENDAR = Mon to Fri minus the holidays below (the latest month counts up to the latest Timestamp). FIXED = use the fixed number below.', st.note);
  g.put(4, 1, 'Fixed working days per month', st.label); g.put(4, 2, 22, st.inputNumber);
  g.put(5, 1, 'Low patient count flag', st.label); g.put(5, 2, opts.lowCount, st.inputNumber); g.put(5, 3, 'Workers below this total are flagged on DATA CHECKS.', st.note);
  g.put(6, 1, 'Data through (latest Timestamp)', st.label);
  g.f(6, 2, `MAX(${x.data('A')})`, x.dataThrough === null ? 0 : serial(x.dataThrough), st.shownDate);
  g.put(6, 3, 'Latest date in MASTER DATA.', st.note);
  g.put(9, 1, 'HOLIDAYS', st.section);
  g.put(9, 3, 'Add local holidays or office closures in the empty rows below the list.', st.note);
  ['Date', 'Holiday', 'Type'].forEach((h, k) => g.put(10, 1 + k, h, st.th));
  x.holidays.forEach((h, k) => { g.set(11 + k, 1, { date: h.date, s: st.tdDate }); g.put(11 + k, 2, h.name, st.td); g.put(11 + k, 3, h.type, st.td); });
  const ws = workerStart(x);
  g.put(ws - 2, 1, 'WORKER DEPARTMENTS', st.section);
  g.put(ws - 1, 1, "Change a worker's Department or Status here. The Department picker on DASHBOARD counts only the workers of that department.", st.note);
  ['Medical Social Worker', 'Department', 'Status'].forEach((h, k) => g.put(ws, 1 + k, h, st.th));
  g.put(ws, 5, 'Departments', st.th);
  g.put(ws, 7, 'Worker drop-down list', st.th);
  report.workers.forEach((w, k) => { g.put(ws + 1 + k, 1, w, st.td); g.put(ws + 1 + k, 2, opts.department, st.td); g.put(ws + 1 + k, 3, 'ACTIVE', st.td); });
  [ALL_DEPT, opts.department].forEach((d, k) => g.put(ws + 1 + k, 5, d, st.td));
  for (let k = 2; k < 10; k++) g.put(ws + 1 + k, 5, null, st.td);
  [ALL, ...report.workers].forEach((w, k) => g.put(ws + 1 + k, 7, w, st.td));
  return {
    name: NAMES.settings, hidden: true, rows: g.out(), noGrid: true,
    cols: [{ width: 3 }, { width: 34 }, { width: 24 }, { width: 22 }, { width: 3 }, { width: 24 }, { width: 3 }, { width: 34 }],
    validations: [{ ref: 'C4', list: ['CALENDAR', 'FIXED'] }],
  };
}

const workerStart = (x: Context) => 11 + x.holidays.length + 12;

/* ---------- DASHBOARD ---------- */

function dashboardSheet(x: Context): XSheet {
  const { st, report, entries, opts } = x;
  const g = new Grid();
  const W = report.workers.length;
  const M = report.months.length;
  const merges: string[] = [];
  const rules: XSheet['rules'] = [];
  const S = q(NAMES.settings);
  const DA = x.data('A'), DB = x.data('B'), DC = x.data('C'), DE = x.data('E');
  const lastMonth = report.months[M - 1];
  const selected = lastMonth ? monthRange(lastMonth.label) : null;
  const from = selected?.from ?? 0;
  const to = selected?.to ?? 0;
  const through = x.dataThrough ?? to;
  const holidayDays = x.holidays.map((h) => h.date);
  const days = selected ? workingDays(from, Math.min(to, through), holidayDays) : 0;
  const period = periodStats(entries, report.workers, from, to);
  const W0 = 12; // first worker row (0-based)
  const WL = W0 + Math.max(W, 1) - 1;
  const TR = WL + 1;
  const workers = span(W0, 1, WL, 1);
  const flags = span(W0, 20, WL, 20);
  const total = period.workers.reduce((n, w) => n + w.total, 0);
  const active = period.workers.filter((w) => w.total > 0).length;
  const avg = active ? total / active : 0;
  const top = period.workers.reduce<{ name: string; total: number } | null>((b, w) => (!b || w.total > b.total ? w : b), null);
  const newTotal = period.workers.reduce((n, w) => n + w.newPatients, 0);
  const oldTotal = period.workers.reduce((n, w) => n + w.oldPatients, 0);
  const allSel = 'OR($C$6="",$C$6="ALL WORKERS")';
  const within = (r1: string, r2: string) => `${DA},">="&${r1},${DA},"<="&${r2}`;
  const wd = (a: string, b: string) => `IF(${S}!${x.settings.methodCell}="FIXED",${S}!${x.settings.fixedCell},MAX(0,NETWORKDAYS(${a},MIN(${b},${S}!${x.settings.throughCell}),${x.holidayRange})))`;

  g.put(1, 1, 'MSWD DASHBOARD: PATIENTS CATERED PER WORKER', st.dashTitle); merges.push(area(1, 1, 1, 19)); g.heights.set(1, 28);
  g.put(2, 1, 'Pick a Month and a Worker in the yellow cells, or enter a custom date range in row 7. Counts use the Timestamp in MASTER DATA. Working days, holidays, and departments are set on DASHBOARD SETTINGS.', st.note); merges.push(area(2, 1, 2, 19));
  g.put(3, 1, 'Department:', st.label); g.put(3, 2, opts.department, st.input);
  g.put(4, 1, 'Month:', st.label); g.put(4, 2, lastMonth?.label ?? '', st.input);
  g.put(4, 3, 'From:', st.label); g.f(4, 4, 'IF(AND(ISNUMBER($C$7),ISNUMBER($E$7)),$C$7,IFERROR(DATEVALUE("1 "&$C$5),""))', selected ? serial(from) : '', st.shownDate);
  g.put(4, 5, 'To:', st.label); g.f(4, 6, 'IF(AND(ISNUMBER($C$7),ISNUMBER($E$7)),$E$7,IF($E$5="","",EOMONTH($E$5,0)))', selected ? serial(to) : '', st.shownDate);
  g.put(5, 1, 'Worker:', st.label); g.put(5, 2, ALL, st.input);
  g.put(5, 3, 'Working Days:', st.label); g.f(5, 4, `IF($E$5="","",${wd('$E$5', '$G$5')})`, days, st.shownNumber);
  g.put(5, 5, 'Daily Target:', st.label); g.put(5, 6, opts.dailyTarget, st.inputNumber);
  g.put(6, 1, 'Custom range (optional):', st.label); g.put(6, 2, null, st.inputDate); g.put(6, 3, 'to', st.label); g.put(6, 4, null, st.inputDate);
  g.put(6, 5, 'Leave both blank to use the Month.', st.note);

  ['TOTAL PATIENTS', 'ACTIVE WORKERS', 'AVG PER WORKER', 'AVG PER WORKER PER DAY', 'AVG PER DAY', 'TOP WORKER', 'NEW PATIENTS', 'OLD PATIENTS'].forEach((h, k) => g.put(7, 1 + k, h, st.kpiLabel));
  g.heights.set(7, 26); g.heights.set(8, 34); g.heights.set(9, 24);
  const sumIfSel = (c: number) => `SUMIF(${workers},$C$6,${span(W0, c, WL, c)})`;
  g.f(8, 1, `IF(${allSel},${abs(TR, 2)},${sumIfSel(2)})`, total, st.kpiValue);
  g.f(8, 2, `COUNTIF(${span(W0, 2, WL, 2)},">0")`, active, st.kpiValue);
  g.f(8, 3, `IF($C$9=0,0,${abs(TR, 2)}/$C$9)`, avg, st.kpiDecimal);
  g.f(8, 4, 'IF(N($E$6)=0,0,$D$9/$E$6)', days ? avg / days : 0, st.kpiDecimal);
  g.f(8, 5, 'IF(N($E$6)=0,0,$B$9/$E$6)', days ? total / days : 0, st.kpiDecimal);
  g.f(8, 6, `IF(${abs(TR, 2)}=0,"-",INDEX(${workers},MATCH(MAX(${span(W0, 2, WL, 2)}),${span(W0, 2, WL, 2)},0)))`, total && top ? top.name : '-', st.kpiName);
  g.f(8, 7, `IF(${allSel},${abs(TR, 7)},${sumIfSel(7)})`, newTotal, st.kpiValue);
  g.f(8, 8, `IF(${allSel},${abs(TR, 8)},${sumIfSel(8)})`, oldTotal, st.kpiValue);
  g.f(9, 1, `IF(${allSel},"Selected period, "&$C$4,"Selected period, "&$C$6)`, `Selected period, ${opts.department}`, st.kpiNote);
  g.put(9, 2, 'With at least 1 patient', st.kpiNote);
  g.put(9, 3, 'Total ÷ active workers', st.kpiNote);
  g.put(9, 4, 'Avg per worker ÷ working days', st.kpiNote);
  g.put(9, 5, 'Total ÷ working days', st.kpiNote);
  g.f(9, 6, `TEXT(MAX(${span(W0, 2, WL, 2)}),"#,##0")&" patients"`, `${(top?.total ?? 0).toLocaleString('en-US')} patients`, st.kpiNote);
  g.f(9, 7, 'IF($B$9=0,"",TEXT($H$9/$B$9,"0.0%")&" of total")', total ? `${((newTotal / total) * 100).toFixed(1)}% of total` : '', st.kpiNote);
  g.f(9, 8, 'IF($B$9=0,"",TEXT($I$9/$B$9,"0.0%")&" of total")', total ? `${((oldTotal / total) * 100).toFixed(1)}% of total` : '', st.kpiNote);

  // Workers in the selected period.
  ['Medical Social Worker', 'Patients Catered', '% of Period', 'Active Days', 'Avg per Working Day', 'vs Avg per Worker', 'New', 'Old'].forEach((h, k) => g.put(11, 1 + k, h, st.th));
  g.heights.set(11, 30);
  const deptRange = x.settings.deptRange;
  period.workers.forEach((w, k) => {
    const r = W0 + k;
    const R = r + 1;
    g.put(r, 1, w.name, st.td);
    g.f(r, 2, `IF($U${R}=0,0,COUNTIFS(${DB},$B${R},${within('$E$5', '$G$5')}))`, w.total, st.tdNumber);
    g.f(r, 3, `IF(${abs(TR, 2)}=0,0,$C${R}/${abs(TR, 2)})`, total ? w.total / total : 0, st.tdPercent);
    g.f(r, 4, `IF($U${R}=0,0,COUNTIFS(${DB},$B${R},${within('$E$5', '$G$5')},${DE},1))`, w.activeDays, st.tdNumber);
    g.f(r, 5, `IF(N($E$6)=0,0,$C${R}/$E$6)`, days ? w.total / days : 0, st.tdDecimal);
    g.f(r, 6, `$C${R}-$D$9`, w.total - avg, st.tdSigned);
    g.f(r, 7, `IF($U${R}=0,0,COUNTIFS(${DB},$B${R},${within('$E$5', '$G$5')},${DC},"NEW"))`, w.newPatients, st.tdNumber);
    g.f(r, 8, `IF($U${R}=0,0,COUNTIFS(${DB},$B${R},${within('$E$5', '$G$5')},${DC},"OLD"))`, w.oldPatients, st.tdNumber);
    g.f(r, 20, `IF(OR($C$4="",$C$4="${ALL_DEPT}"),1,IF(IFERROR(VLOOKUP($B${R},${deptRange},2,FALSE),"UNASSIGNED")=$C$4,1,0))`, 1, st.hidden);
  });
  g.put(TR, 1, 'TOTAL', st.tdTotal);
  for (const c of [2, 3, 4, 7, 8]) {
    const v = c === 2 ? total : c === 3 ? (total ? 1 : 0) : c === 4 ? period.workers.reduce((n, w) => n + w.activeDays, 0) : c === 7 ? newTotal : oldTotal;
    g.f(TR, c, `SUM(${span(W0, c, WL, c)})`, v, c === 3 ? st.tdTotalPercent : st.tdTotalNumber);
  }
  for (const c of [5, 6]) g.put(TR, c, null, st.tdTotal);
  if (W) {
    rules.push({ type: 'expression', ref: area(W0, 5, WL, 5), formula: `AND($B${W0 + 1}<>"",ISNUMBER($G$6),$F${W0 + 1}>=$G$6)`, style: { color: '006100', fill: 'C6EFCE' } });
    rules.push({ type: 'expression', ref: area(W0, 5, WL, 5), formula: `AND($B${W0 + 1}<>"",ISNUMBER($G$6),$C${W0 + 1}>0,$F${W0 + 1}<$G$6)`, style: { color: '9C5700', fill: 'FFEB9C' } });
    rules.push({ type: 'expression', ref: area(W0, 1, WL, 8), formula: `AND($B${W0 + 1}<>"",$B${W0 + 1}=$C$6)`, style: { bold: true, fill: 'FFF2CC' } });
  }

  // Patients per month.
  const K = 10;
  const M0 = 12;
  const ML = M0 + Math.max(M, 1) - 1;
  g.f(10, K, `"AVERAGE PATIENTS CATERED PER MONTH: "&$C$4`, `AVERAGE PATIENTS CATERED PER MONTH: ${opts.department}`, st.section); merges.push(area(10, K, 10, 19));
  ['Month', 'Total Patients', 'Active Workers', 'Avg per Worker', 'Working Days', 'Avg per Working Day', 'Worker-Days', 'Avg per Worker per Working Day', 'From', 'To'].forEach((h, k) => g.put(11, K + k, h, st.th));
  const monthly = report.months.map((m) => {
    const rg = monthRange(m.label)!;
    const s = periodStats(entries, report.workers, rg.from, rg.to);
    const wdays = workingDays(rg.from, Math.min(rg.to, through), holidayDays);
    return { label: m.label, rg, s, wdays };
  });
  monthly.forEach((m, k) => {
    const r = M0 + k;
    const R = r + 1;
    const counted = (extra = '') => `SUMPRODUCT(COUNTIFS(${DB},${workers},${within(`$S${R}`, `$T${R}`)}${extra})*${flags})`;
    g.put(r, K, m.label, st.td);
    g.f(r, K + 1, counted(), m.s.total, st.tdNumber);
    g.f(r, K + 2, `SUMPRODUCT((COUNTIFS(${DB},${workers},${within(`$S${R}`, `$T${R}`)})>0)*${flags})`, m.s.activeWorkers, st.tdNumber);
    const perWorker = m.s.activeWorkers ? m.s.total / m.s.activeWorkers : 0;
    g.f(r, K + 3, `IF($M${R}=0,0,$L${R}/$M${R})`, perWorker, st.tdDecimal);
    g.f(r, K + 4, wd(`$S${R}`, `$T${R}`), m.wdays, st.tdNumber);
    g.f(r, K + 5, `IF(N($O${R})=0,0,$L${R}/$O${R})`, m.wdays ? m.s.total / m.wdays : 0, st.tdDecimal);
    g.f(r, K + 6, counted(`,${DE},1`), m.s.workerDays, st.tdNumber);
    g.f(r, K + 7, `IF(N($O${R})=0,0,$N${R}/$O${R})`, m.wdays ? perWorker / m.wdays : 0, st.tdDecimal);
    g.f(r, K + 8, `DATEVALUE("1 "&$K${R})`, serial(m.rg.from), st.tdSmallDate);
    g.f(r, K + 9, `EOMONTH($S${R},0)`, serial(m.rg.to), st.tdSmallDate);
  });
  const MA = ML + 1;
  const sum = (f: (m: typeof monthly[number]) => number) => monthly.reduce((n, m) => n + f(m), 0);
  const mean = (f: (m: typeof monthly[number]) => number) => (monthly.length ? sum(f) / monthly.length : 0);
  const perWorkerOf = (m: typeof monthly[number]) => (m.s.activeWorkers ? m.s.total / m.s.activeWorkers : 0);
  g.put(MA, K, 'AVERAGE / OVERALL', st.tdTotal);
  g.f(MA, K + 1, `AVERAGE(${area(M0, K + 1, ML, K + 1)})`, mean((m) => m.s.total), st.tdTotalDecimal);
  g.f(MA, K + 2, `AVERAGE(${area(M0, K + 2, ML, K + 2)})`, mean((m) => m.s.activeWorkers), st.tdTotalDecimal);
  g.f(MA, K + 3, `AVERAGE(${area(M0, K + 3, ML, K + 3)})`, mean(perWorkerOf), st.tdTotalDecimal);
  g.f(MA, K + 4, `SUM(${area(M0, K + 4, ML, K + 4)})`, sum((m) => m.wdays), st.tdTotalNumber);
  g.f(MA, K + 5, `IF(${ref(MA, K + 4)}=0,0,SUM(${area(M0, K + 1, ML, K + 1)})/${ref(MA, K + 4)})`, sum((m) => m.wdays) ? sum((m) => m.s.total) / sum((m) => m.wdays) : 0, st.tdTotalDecimal);
  g.f(MA, K + 6, `SUM(${area(M0, K + 6, ML, K + 6)})`, sum((m) => m.s.workerDays), st.tdTotalNumber);
  g.f(MA, K + 7, `AVERAGE(${area(M0, K + 7, ML, K + 7)})`, mean((m) => (m.wdays ? perWorkerOf(m) / m.wdays : 0)), st.tdTotalDecimal);
  for (const c of [K + 8, K + 9]) g.put(MA, c, null, st.tdTotal);
  g.put(MA + 2, K, 'The latest month counts working days only up to the latest Timestamp, so its per-day figures stay comparable.', st.note);
  if (M) rules.push({ type: 'expression', ref: area(M0, K, ML, K + 9), formula: `$K${M0 + 1}=$C$5`, style: { bold: true, fill: 'FFF2CC' } });

  // Detail per month for the selected worker or department.
  const D0 = MA + 6;
  g.f(D0 - 2, K, `"DETAIL: "&IF(${allSel},"ALL WORKERS, "&$C$4,$C$6)`, `DETAIL: ALL WORKERS, ${opts.department}`, st.section); merges.push(area(D0 - 2, K, D0 - 2, 15));
  ['Month', 'Patients Catered', 'Active Days (worker-days)', 'Avg per Working Day', '% of Department', 'Avg per Worker vs Dept'].forEach((h, k) => g.put(D0 - 1, K + k, h, st.th));
  monthly.forEach((m, k) => {
    const r = D0 + k;
    const R = r + 1;
    const mr = M0 + k + 1;
    g.f(r, K, `$K${mr}`, m.label, st.td);
    g.f(r, K + 1, `IF(${allSel},$L${mr},COUNTIFS(${DB},$C$6,${within(`$S${mr}`, `$T${mr}`)}))`, m.s.total, st.tdNumber);
    g.f(r, K + 2, `IF(${allSel},$Q${mr},COUNTIFS(${DB},$C$6,${within(`$S${mr}`, `$T${mr}`)},${DE},1))`, m.s.workerDays, st.tdNumber);
    g.f(r, K + 3, `IF(N($O${mr})=0,0,$L${R}/$O${mr})`, m.wdays ? m.s.total / m.wdays : 0, st.tdDecimal);
    g.f(r, K + 4, `IF(N($L${mr})=0,0,$L${R}/$L${mr})`, m.s.total ? 1 : 0, st.tdPercent);
    g.f(r, K + 5, `IF(N($N${mr})=0,0,IF(${allSel},$L${R}/MAX(1,$M${mr}),$L${R})/$N${mr})`, m.s.total ? 1 : 0, st.tdPercent);
  });
  const DL = D0 + Math.max(M, 1) - 1;

  // Workload breakdown for the selected period.
  const B0 = DL + 4;
  g.f(B0 - 2, K, `"WORKLOAD BREAKDOWN: "&IF(${allSel},"ALL WORKERS ("&$C$4&")",$C$6)&", "&TEXT($E$5,"mmm d")&" to "&TEXT($G$5,"mmm d, yyyy")`, `WORKLOAD BREAKDOWN: ALL WORKERS (${opts.department})${selected ? `, ${mmmd(from)} to ${mmmd(to, true)}` : ''}`, st.section); merges.push(area(B0 - 2, K, B0 - 2, 15));
  const kinds: { title: string; col: string; pick: (e: DayEntry) => string | null; limit: number }[] = [
    { title: 'Type of Patient', col: x.data('F'), pick: (e) => e.type, limit: 10 },
    { title: 'Classification', col: x.data('G'), pick: (e) => e.classification, limit: 10 },
    { title: 'Service', col: x.data('H'), pick: (e) => e.service, limit: 15 },
  ];
  let breakdownRows = 0;
  kinds.forEach((kind, j) => {
    const c = K + j * 2;
    g.put(B0 - 1, c, kind.title, st.th); g.put(B0 - 1, c + 1, 'Patients', st.th);
    const overall = new Map<string, number>();
    const inPeriod = new Map<string, number>();
    for (const e of entries) {
      const v = kind.pick(e);
      if (v === null) continue;
      overall.set(v, (overall.get(v) ?? 0) + 1);
      if (e.day !== null && e.day >= from && e.day <= to) inPeriod.set(v, (inPeriod.get(v) ?? 0) + 1);
    }
    const labels = [...overall].sort((a, b) => b[1] - a[1]).slice(0, kind.limit).map(([v]) => v);
    breakdownRows = Math.max(breakdownRows, labels.length);
    labels.forEach((v, k) => {
      const r = B0 + k;
      g.put(r, c, v, st.td);
      g.f(r, c + 1, `IF(${allSel},SUMPRODUCT(COUNTIFS(${kind.col},${exact(v)},${DB},${workers},${within('$E$5', '$G$5')})*${flags}),COUNTIFS(${kind.col},${exact(v)},${DB},$C$6,${within('$E$5', '$G$5')}))`, inPeriod.get(v) ?? 0, st.tdNumber);
    });
  });

  // Daily count for the selected period.
  const Y0 = TR + 4;
  const fromSerial = serial(from);
  g.f(Y0 - 2, 1, `"DAILY COUNT: "&IF(${allSel},"ALL WORKERS ("&$C$4&")",$C$6)&", "&TEXT($E$5,"mmm d")&" to "&TEXT(MIN($G$5,$E$5+30),"mmm d, yyyy")`, `DAILY COUNT: ALL WORKERS (${opts.department})${selected ? `, ${mmmd(from)} to ${mmmd(Math.min(to, from + 30 * DAY), true)}` : ''}`, st.section); merges.push(area(Y0 - 2, 1, Y0 - 2, 5));
  ['Date', 'Day', 'Selected Patients', 'Department Total', 'Share of Department'].forEach((h, k) => g.put(Y0 - 1, 1 + k, h, st.th));
  const perDay = new Map<number, number>();
  for (const e of entries) if (e.day !== null) perDay.set(e.day, (perDay.get(e.day) ?? 0) + 1);
  for (let k = 0; k < 31; k++) {
    const r = Y0 + k;
    const R = r + 1;
    const d = from + k * DAY;
    const inRange = selected !== null && d <= to;
    const n = inRange ? perDay.get(d) ?? 0 : 0;
    g.f(r, 1, `IF($E$5="","",IF($E$5+ROW()-ROW(${abs(Y0, 1)})>$G$5,"",$E$5+ROW()-ROW(${abs(Y0, 1)})))`, inRange ? fromSerial + k : '', st.tdDate);
    g.f(r, 2, `IF($B${R}="","",TEXT($B${R},"ddd"))`, inRange ? new Date(d).toUTCString().slice(0, 3) : '', st.td);
    g.f(r, 4, `IF($B${R}="","",SUMPRODUCT(COUNTIFS(${DB},${workers},${DA},$B${R})*${flags}))`, inRange ? n : '', st.tdNumber);
    g.f(r, 3, `IF($B${R}="","",IF(${allSel},$E${R},COUNTIFS(${DB},$C$6,${DA},$B${R})))`, inRange ? n : '', st.tdNumber);
    g.f(r, 5, `IF($B${R}="","",IF(N($E${R})=0,0,$D${R}/$E${R}))`, inRange ? (n ? 1 : 0) : '', st.tdPercent);
  }

  const chartRow = Math.max(Y0 + 33, B0 + breakdownRows + 2) + 2;
  g.put(chartRow - 1, 1, 'CHARTS', st.section); merges.push(area(chartRow - 1, 1, chartRow - 1, 19));
  const D = q(NAMES.dashboard);
  const charts: XSheet['charts'] = [];
  if (M) charts.push({
    title: 'Patients Catered per Month and Avg per Worker per Working Day', at: { row: chartRow, col: 1 }, width: 820, height: 380, categoryTitle: 'Month',
    series: [
      { name: 'Total Patients', categories: `${D}!${span(M0, K, ML, K)}`, values: `${D}!${span(M0, K + 1, ML, K + 1)}`, color: '4E5B92', cache: { categories: monthly.map((m) => m.label), values: monthly.map((m) => m.s.total) } },
      { name: 'Avg per Worker per Working Day', type: 'line', secondary: true, categories: `${D}!${span(M0, K, ML, K)}`, values: `${D}!${span(M0, K + 7, ML, K + 7)}`, color: 'B8860B', cache: { categories: monthly.map((m) => m.label), values: monthly.map((m) => (m.wdays ? perWorkerOf(m) / m.wdays : 0)) } },
    ],
  });
  if (W) charts.push({
    title: 'Patients Catered per Worker (selected period)', at: { row: chartRow, col: K }, width: 820, height: Math.max(380, 22 * W + 80), horizontal: true,
    series: [{ name: 'Patients Catered', categories: `${D}!${workers}`, values: `${D}!${span(W0, 2, WL, 2)}`, color: '4E5B92', cache: { categories: period.workers.map((w) => w.name), values: period.workers.map((w) => w.total) } }],
  });

  return {
    name: NAMES.dashboard, rows: g.out(), merges, rules, noGrid: true, charts,
    cols: [3, 35.86, 17.29, 17.29, 17.29, 17.29, 17.29, 15.86, 15.86, 4.43, 24.43, 17.29, 18.71, 17.29, 24.43, 17.29, 17.29, 17.29, 14.43, 14.43, 6].map((width, c) => ({ width, hidden: c === 20 })),
    validations: [
      ...(M ? [{ ref: 'C5', list: `$K$${M0 + 1}:$K$${ML + 1}` }] : []),
      { ref: 'C6', list: x.settings.workerList },
      { ref: 'C4', list: x.settings.deptList },
    ],
  };
}

/* ---------- DATA CHECKS ---------- */

function checksSheet(x: Context): XSheet {
  const { st, p, report, checks } = x;
  const g = new Grid();
  const mism = monthMismatches(p);
  const workers = workerChecks(p, report.workers, x.opts.lowCount);
  g.put(1, 1, 'DATA CHECKS: MASTER DATA', st.dashTitle);
  g.heights.set(1, 26);
  g.put(3, 1, 'Rows where the Month label does not match the Timestamp:', st.label);
  g.f(3, 5, `COUNTA(${area(6, 2, 6 + Math.max(mism.length, 1) - 1, 2)})`, mism.length, st.shownNumber);
  g.put(3, 8, 'Worker name check (possible typos or duplicates):', st.label);
  const flagged = workers.filter((w) => w.flag).length;
  g.f(3, 14, `COUNTIF(${area(6, 14, 6 + Math.max(workers.length, 1) - 1, 14)},"?*")&" flagged"`, `${flagged} flagged`, st.label);
  ['Sheet Row', 'Month Label', 'Timestamp', 'Month by Timestamp', 'Medical Social Worker', 'Hospital No.'].forEach((h, k) => g.put(5, 1 + k, h, st.th));
  ['Medical Social Worker', 'Total Patients', 'First Date', 'Last Date', 'Months Active', 'Surname', 'Flag'].forEach((h, k) => g.put(5, 8 + k, h, st.th));
  g.heights.set(5, 30);
  mism.forEach((m, k) => {
    const r = 6 + k;
    g.put(r, 1, m.row, st.td);
    g.put(r, 2, m.label, st.td);
    g.set(r, 3, { date: m.stamp, s: st.tdStamp });
    g.put(r, 4, m.byStamp, st.td);
    g.put(r, 5, m.worker, st.td);
    const h = cellOf(m.hospitalNo, st);
    g.set(r, 6, h ? { ...h, s: st.td } : { v: null, s: st.td });
  });
  const lowCell = `${q(NAMES.settings)}!${x.settings.lowCell}`;
  workers.forEach((w, k) => {
    const r = 6 + k;
    g.put(r, 8, w.name, st.td);
    g.f(r, 9, `COUNTIF(${x.data('B')},$I${r + 1})`, w.total, st.tdNumber);
    g.set(r, 10, w.first === null ? { v: null, s: st.tdDate } : { date: w.first, s: st.tdDate });
    g.set(r, 11, w.last === null ? { v: null, s: st.tdDate } : { date: w.last, s: st.tdDate });
    g.put(r, 12, w.months, st.tdNumber);
    g.put(r, 13, w.surname, st.td);
    // The low-count part follows the setting; the other notes are worked out by the app.
    const other = w.flag.replace(/^Low patient count\.\s*/, '');
    g.f(r, 14, `TRIM(IF($J${r + 1}<${lowCell},"Low patient count. ","")&${str(other)})`, w.flag, st.td);
  });
  const C0 = 6 + workers.length + 3;
  g.put(C0 - 1, 8, 'REPORT CHECKS', st.section);
  g.put(C0 - 1, 9, null, st.section);
  checks.forEach((c, k) => {
    const s = c.level === 'good' ? st.good : c.level === 'warn' ? st.warn : c.level === 'bad' ? st.bad : st.info;
    g.put(C0 + k, 8, c.level === 'good' ? 'OK' : c.level === 'warn' ? 'CHECK' : c.level === 'bad' ? 'ERROR' : 'NOTE', s);
    g.put(C0 + k, 9, `${c.title}${c.detail ? `. ${c.detail.replace(/\.$/, '')}` : ''}${c.items?.length ? `: ${c.items.slice(0, 6).map((i) => `${i.label} (${i.count})`).join('; ')}` : ''}`, st.td);
  });
  return {
    name: NAMES.checks, rows: g.out(), freeze: { rows: 6, cols: 0 }, noGrid: true,
    merges: [area(1, 1, 1, 14), ...checks.map((_, k) => area(C0 + k, 9, C0 + k, 14))],
    cols: [3, 17.29, 17.29, 20.14, 20.14, 33, 15.86, 4.43, 34.43, 15.14, 15.14, 15.14, 15.14, 15.14, 45.86].map((width) => ({ width })),
    rules: workers.length ? [{ type: 'expression', ref: area(6, 8, 6 + workers.length - 1, 14), formula: 'LEN($O7)>0', style: { color: '9C0006', fill: 'FFC7CE' } }] : [],
  };
}

/* ---------- MISSPELLING AUDIT ---------- */

function auditSheet(x: Context): XSheet {
  const { st, report } = x;
  const lines = misspellingAudit(x.p);
  const months = report.months.map((m) => m.label);
  return {
    name: NAMES.audit, hidden: true, freeze: { rows: 1, cols: 0 },
    autoFilter: `A1:${colName(4 + months.length)}${Math.max(1, lines.length) + 1}`,
    cols: [{ width: 14 }, { width: 16 }, { width: 34 }, { width: 26 }, { width: 9 }, ...months.map(() => ({ width: 14 }))],
    rows: function* () {
      yield { cells: ['Field', 'Reason', 'Value as encoded', 'Municipality as encoded', 'Times', ...months.map((m) => m.split(' ')[0])].map((v) => ({ v, s: st.dataHead })) };
      for (const l of lines) yield { cells: [{ v: l.field }, { v: l.reason }, { v: l.value }, { v: l.municipality }, { v: l.times }, ...months.map((m) => { const n = l.byMonth.get(m.toUpperCase()) ?? l.byMonth.get(m) ?? 0; return n ? { v: n } : null; })] };
    },
  };
}

/* ---------- WORKER REPORT ---------- */

function workerSheet(x: Context): XSheet {
  const { st, report, entries } = x;
  const g = new Grid();
  const W = report.workers.length;
  const M = report.months.length;
  const T = q(NAMES.totals);
  const merges: string[] = [];
  const overall = report.blocks[report.blocks.length - 1];
  const tLast = 4 + Math.max(W, 1);
  const tNames = `${T}!$A$5:$A$${tLast}`;
  const tValues = `${T}!$B$5:$${colName(1 + M)}$${tLast}`;
  const tHeads = `${T}!$B$4:$${colName(1 + M)}$4`;
  g.put(1, 1, 'MSWD WORKER PERFORMANCE DASHBOARD', st.dashTitle); merges.push(area(1, 1, 1, 3)); g.heights.set(1, 28);
  g.put(2, 1, 'Select Month / Period:', st.label); g.put(2, 2, 'TOTAL', st.input);
  ['TOTAL PATIENTS', 'AVG PER ACTIVE WORKER', 'TOP SOCIAL WORKER'].forEach((h, k) => g.put(4, 1 + k, h, st.kpiLabel));
  const R0 = 9;
  const RL = R0 + Math.max(W, 1) - 1;
  const total = overall.total.total;
  const active = overall.lines.filter((l) => l.total > 0).length;
  g.f(5, 1, `SUM(${area(R0, 2, RL, 2)})`, total, st.kpiValue);
  g.f(5, 2, `IFERROR(AVERAGEIF(${area(R0, 2, RL, 2)},">0"),0)`, active ? total / active : 0, st.kpiDecimal);
  g.f(5, 3, `IFERROR(INDEX(${area(R0, 1, RL, 1)},MATCH(MAX(${area(R0, 2, RL, 2)}),${area(R0, 2, RL, 2)},0)),"-")`, overall.top.name || '-', st.kpiName);
  g.put(6, 1, 'Selected Period Total', st.kpiNote); g.put(6, 2, 'With at least 1 patient', st.kpiNote);
  g.f(6, 3, `IFERROR(TEXT(MAX(${area(R0, 2, RL, 2)}),"#,##0")&" Patients","-")`, `${overall.top.count.toLocaleString('en-US')} Patients`, st.kpiNote);
  g.heights.set(5, 34);
  ['Medical Social Worker', 'Patients Catered', '% of Total'].forEach((h, k) => g.put(8, 1 + k, h, st.th));
  overall.lines.forEach((l, k) => {
    const r = R0 + k;
    g.f(r, 1, `${T}!A${5 + k}`, l.name, st.td);
    g.f(r, 2, `IFERROR(INDEX(${tValues},MATCH($B${r + 1},${tNames},0),MATCH($C$3,${tHeads},0)),0)`, l.total, st.tdNumber);
    g.f(r, 3, `IF($B$6>0,$C${r + 1}/$B$6,0)`, total ? l.total / total : 0, st.tdPercent);
  });
  g.put(RL + 1, 1, 'TOTAL', st.tdTotal);
  g.f(RL + 1, 2, `SUM(${area(R0, 2, RL, 2)})`, total, st.tdTotalNumber);
  g.f(RL + 1, 3, `SUM(${area(R0, 3, RL, 3)})`, total ? 1 : 0, st.tdTotalPercent);

  const W_ = q(NAMES.worker);
  const charts: XSheet['charts'] = W ? [{
    title: 'Patients Catered per Medical Social Worker', at: { row: 2, col: 5 }, width: 760, height: Math.max(360, 18 * W + 120), categoryTitle: 'Medical Social Worker',
    series: [{ name: 'Patients Catered', categories: `${W_}!${span(R0, 1, RL, 1)}`, values: `${W_}!${span(R0, 2, RL, 2)}`, color: '4E5B92', cache: { categories: overall.lines.map((l) => l.name), values: overall.lines.map((l) => l.total) } }],
  }] : [];

  // Individual worker tracer: the patients one worker catered on each day of a month.
  const workerCol = x.master('worker');
  const whenCol = x.master('timestamp') ?? x.master('date');
  const monthCol = x.master('month');
  const lastMonth = report.months[M - 1];
  const S0 = Math.max(RL + 4, 32);
  const validations: XSheet['validations'] = [{ ref: 'C3', list: `${T}!$B$4:$${colName(1 + M)}$4` }];
  if (workerCol && whenCol && monthCol && lastMonth && W) {
    const pick = overall.top.name || report.workers[0];
    const rg = monthRange(lastMonth.label)!;
    const mine = entries.filter((e) => e.worker?.toUpperCase() === pick.toUpperCase());
    const daily = new Map<number, number>();
    for (const e of mine) if (e.day !== null && e.day >= rg.from && e.day <= rg.to) daily.set(e.day, (daily.get(e.day) ?? 0) + 1);
    const latest = [...daily.keys()].sort((a, b) => b - a)[0] ?? rg.from;
    const monthTotal = report.blocks[M - 1].lines[report.workers.indexOf(pick)]?.total ?? 0;
    const activeDays = [...daily.values()].filter((n) => n > 0).length;
    g.put(S0, 1, 'INDIVIDUAL WORKER PATIENT TRACER & DAILY ACTIVITY', st.dashTitle); merges.push(area(S0, 1, S0, 13)); g.heights.set(S0, 26);
    g.put(S0 + 2, 1, 'Social Worker:', st.label); g.put(S0 + 2, 2, pick, st.input); merges.push(area(S0 + 2, 2, S0 + 2, 3));
    g.put(S0 + 2, 4, 'Month:', st.label); g.put(S0 + 2, 5, lastMonth.label, st.input); merges.push(area(S0 + 2, 5, S0 + 2, 6));
    g.put(S0 + 2, 7, 'Date:', st.label); g.set(S0 + 2, 8, { date: latest, s: st.inputDate }); merges.push(area(S0 + 2, 8, S0 + 2, 9));
    const who = abs(S0 + 2, 2), mon = abs(S0 + 2, 5), date = abs(S0 + 2, 8);
    const D0 = S0 + 9;
    const DL = D0 + 30;
    ['PATIENTS ON SELECTED DATE', 'MONTH PATIENT TOTAL', 'ACTIVE WORKING DAYS'].forEach((h, k) => { g.put(S0 + 4, 1 + k * 4, h, st.kpiLabel); merges.push(area(S0 + 4, 1 + k * 4, S0 + 4, 3 + k * 4)); });
    const day = `IF(ISNUMBER(${date}),INT(${date}),DATEVALUE(${date}))`;
    g.f(S0 + 5, 1, `COUNTIFS(${workerCol},${who},${whenCol},">="&${day},${whenCol},"<"&(${day}+1))`, daily.get(latest) ?? 0, st.kpiValue); merges.push(area(S0 + 5, 1, S0 + 5, 3));
    g.f(S0 + 5, 5, `COUNTIFS(${workerCol},${who},${monthCol},${mon})`, monthTotal, st.kpiValue); merges.push(area(S0 + 5, 5, S0 + 5, 7));
    g.f(S0 + 5, 9, `COUNTIF(${span(D0, 3, DL, 3)},">0")`, activeDays, st.kpiValue); merges.push(area(S0 + 5, 9, S0 + 5, 11));
    g.heights.set(S0 + 5, 34);
    g.f(S0 + 6, 1, `IFERROR(TEXT(${day},"dddd, mmmm dd, yyyy"),"Specific Date")`, new Date(latest).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: '2-digit', year: 'numeric', timeZone: 'UTC' }), st.kpiNote); merges.push(area(S0 + 6, 1, S0 + 6, 3));
    g.f(S0 + 6, 5, `IFERROR(${mon}&" Total Patients","Selected Month")`, `${lastMonth.label} Total Patients`, st.kpiNote); merges.push(area(S0 + 6, 5, S0 + 6, 7));
    g.f(S0 + 6, 9, `IFERROR("Avg "&TEXT(IF(${ref(S0 + 5, 9)}>0,${ref(S0 + 5, 5)}/${ref(S0 + 5, 9)},0),"0.0")&" pts / active day","-")`, `Avg ${(activeDays ? monthTotal / activeDays : 0).toFixed(1)} pts / active day`, st.kpiNote); merges.push(area(S0 + 6, 9, S0 + 6, 11));
    ['Date', 'Day', 'Patients Catered'].forEach((h, k) => g.put(D0 - 1, 1 + k, h, st.th));
    const lastDay = new Date(rg.to).getUTCDate();
    for (let k = 0; k < 31; k++) {
      const r = D0 + k;
      const R = r + 1;
      const d = rg.from + k * DAY;
      const inMonth = k < lastDay;
      if (k === 0) g.f(r, 1, `IFERROR(DATEVALUE("1 "&${mon}),"")`, serial(rg.from), st.tdDate);
      else g.f(r, 1, `IF($B${R - 1}="","",IF(DAY($B${R - 1})<DAY(EOMONTH($B$${D0 + 1},0)),$B${R - 1}+1,""))`, inMonth ? serial(d) : '', st.tdDate);
      g.f(r, 2, `IF($B${R}="","",TEXT($B${R},"ddd"))`, inMonth ? new Date(d).toUTCString().slice(0, 3) : '', st.td);
      g.f(r, 3, `IF($B${R}="","",COUNTIFS(${workerCol},${who},${whenCol},">="&$B${R},${whenCol},"<"&($B${R}+1)))`, inMonth ? daily.get(d) ?? 0 : '', st.tdNumber);
    }
    validations.push({ ref: ref(S0 + 2, 2), list: tNames }, { ref: ref(S0 + 2, 5), list: `${T}!$B$4:$${colName(M)}$4` }, { ref: ref(S0 + 2, 8), list: `${W_}!${span(D0, 1, DL, 1)}` });
    charts.push({
      title: 'Daily Patient Volume Trend', at: { row: D0 - 1, col: 5 }, width: 760, height: 360, categoryTitle: 'Date',
      series: [{ name: 'Patients Catered', categories: `${W_}!${span(D0, 2, DL, 2)}`, values: `${W_}!${span(D0, 3, DL, 3)}`, color: '4E5B92',
        cache: { categories: Array.from({ length: lastDay }, (_, k) => String(k + 1)), values: Array.from({ length: lastDay }, (_, k) => daily.get(rg.from + k * DAY) ?? 0) } }],
    });
    return {
      name: NAMES.worker, rows: g.out(), merges, charts, validations, noGrid: true,
      rules: [{ type: 'expression', ref: area(D0, 1, DL, 3), formula: `$B${D0 + 1}=${day}`, style: { bold: true, fill: 'FFF2CC' } }],
      cols: [4.43, 37.29, 18.71, 15.86, 10.86, 12, 12, 12, 12, 12, 12, 12, 12, 12].map((width) => ({ width })),
    };
  }
  return { name: NAMES.worker, rows: g.out(), merges, charts, validations, noGrid: true, cols: [4.43, 37.29, 18.71, 15.86, 10.86].map((width) => ({ width })) };
}

/* ---------- ANALYST SUMMARY ---------- */

function aiSheet(x: Context): XSheet {
  const { st } = x;
  const brief = analyzeMswd(x.p, x.report, x.checks);
  const g = new Grid();
  const AI = q('ANALYST SUMMARY');
  g.put(1, 1, 'ANALYST: MSWD PERFORMANCE', st.aiTitle);
  g.heights.set(1, 30);
  g.put(2, 1, 'Worked out on this device from MASTER DATA. Each statement names the test or figure behind it. The charts on the right read the tables at the bottom of this sheet.', st.note);
  g.put(4, 1, brief.headline, st.aiHeadline);
  g.heights.set(4, 36);
  // Key numbers, one per line, so they stay readable in a narrow window too.
  let r = 6;
  if (brief.keyNumbers.length) {
    g.put(r++, 1, 'KEY NUMBERS', st.section);
    for (const k of brief.keyNumbers) { g.put(r, 1, `${k.label}: ${k.value}${k.note ? `  (${k.note})` : ''}`, st.wrapped); r++; }
    r++;
  }
  for (const sec of brief.sections) {
    g.put(r, 1, sec.heading.toUpperCase(), st.section);
    g.heights.set(r, 20);
    r++;
    for (const line of sec.lines) {
      g.put(r, 1, line, st.wrapped);
      g.heights.set(r, Math.max(18, Math.ceil(line.length / 100) * 16));
      r++;
    }
    r++;
  }
  // Tables behind the charts.
  const charts: XSheet['charts'] = [];
  r += 1;
  if (brief.monthly.length) {
    g.put(r, 1, 'PATIENTS PER MONTH', st.section);
    g.put(r, 2, 'Patients', st.navy);
    g.put(r, 3, 'Forecast', st.navy);
    const t0 = r + 1;
    const rows = [
      ...brief.monthly.map((m) => ({ label: `${m.label}${m.partial ? ' (partial)' : ''}`, value: m.value as number | null, fc: null as number | null })),
      ...(brief.forecast ? brief.forecast.labels.map((l, i) => ({ label: `${l} (forecast)`, value: null, fc: Math.round(brief.forecast!.values[i]) })) : []),
    ];
    rows.forEach((row, i) => {
      g.put(t0 + i, 1, row.label, st.name);
      g.put(t0 + i, 2, row.value, st.count);
      g.put(t0 + i, 3, row.fc, st.count);
    });
    const tl = t0 + rows.length - 1;
    charts.push({
      title: 'Patients Catered per Month and Forecast', at: { row: 3, col: 4 }, width: 760, height: 360, categoryTitle: 'Month',
      series: [
        { name: 'Patients', categories: `${AI}!${span(t0, 1, tl, 1)}`, values: `${AI}!${span(t0, 2, tl, 2)}`, color: '1C5CAB', cache: { categories: rows.map((x) => x.label), values: rows.map((x) => x.value ?? 0) } },
        ...(brief.forecast ? [{ name: 'Forecast', type: 'line' as const, categories: `${AI}!${span(t0, 1, tl, 1)}`, values: `${AI}!${span(t0, 3, tl, 3)}`, color: 'B8860B', cache: { categories: rows.map((x) => x.label), values: rows.map((x) => x.fc ?? 0) } }] : []),
      ],
    });
    r = tl + 2;
  }
  if (brief.workload && brief.workload.rows.length) {
    g.put(r, 1, `PATIENTS PER RSW, ${brief.workload.month.toUpperCase()}`, st.section);
    g.put(r, 2, 'Patients', st.navy);
    const t0 = r + 1;
    brief.workload.rows.forEach((w, i) => { g.put(t0 + i, 1, w.label, st.name); g.put(t0 + i, 2, w.value, st.count); });
    const tl = t0 + brief.workload.rows.length - 1;
    charts.push({
      title: `Workload by RSW, ${brief.workload.month}`, at: { row: 25, col: 4 }, width: 760, height: Math.max(360, brief.workload.rows.length * 20 + 100), horizontal: true,
      series: [{ name: 'Patients', categories: `${AI}!${span(t0, 1, tl, 1)}`, values: `${AI}!${span(t0, 2, tl, 2)}`, color: '4E5B92', cache: { categories: brief.workload.rows.map((w) => w.label), values: brief.workload.rows.map((w) => w.value) } }],
    });
  }
  return { name: 'ANALYST SUMMARY', rows: g.out(), noGrid: true, charts, cols: [{ width: 3 }, { width: 100 }, { width: 12 }, { width: 12 }] };
}

/* ---------- Workbook ---------- */

export function monthSheetNames(months: { label: string }[]): string[] {
  const short = months.map((m) => m.label.split(' ')[0]);
  const clash = new Set(short.filter((s, i) => short.indexOf(s) !== i));
  return months.map((m, i) => (clash.has(short[i]) ? m.label : short[i]));
}

export async function buildMswdWorkbook(p: Prepared, report: MswdReport, checks: MswdCheck[], opts: MswdWorkbookOptions, onProgress?: (message: string) => void): Promise<Uint8Array<ArrayBuffer>> {
  const st = styles();
  const end = Math.max(2, p.rows.length + 1);
  const masterCol = (field: keyof Prepared['cols']) => { const c = p.cols[field]; return c === undefined ? null : `${q(NAMES.master)}!$${colName(c)}$2:$${colName(c)}$${end}`; };
  const entries = dayEntries(p);
  const days = entries.map((e) => e.day).filter((d): d is number => d !== null);
  const dataThrough = days.length ? days.reduce((a, b) => Math.max(a, b)) : null;
  const years = report.months.map((m) => Math.floor((monthRange(m.label)?.from ?? Date.UTC(new Date().getUTCFullYear(), 0, 1)) / DAY))
    .map((d) => new Date(d * DAY).getUTCFullYear());
  const holidays = philippineHolidays(years.length ? years : [new Date().getUTCFullYear()]);
  const holidayEnd = 11 + holidays.length + 8;
  const x: Context = {
    p, report, checks, opts, st, entries, end, dataThrough, holidays,
    master: masterCol,
    data: (col) => `${q(NAMES.data)}!$${col}$2:$${col}$${end}`,
    holidayRange: `${q(NAMES.settings)}!$B$12:$B$${holidayEnd + 1}`,
    settings: { methodCell: '$C$4', fixedCell: '$C$5', lowCell: '$C$6', throughCell: '$C$7', workerList: '', deptList: '', deptRange: '' },
  };
  const ws = workerStart(x);
  x.settings.workerList = `${q(NAMES.settings)}!$H$${ws + 2}:$H$${ws + 2 + report.workers.length}`;
  x.settings.deptList = `${q(NAMES.settings)}!$F$${ws + 2}:$F$${ws + 11}`;
  x.settings.deptRange = `${q(NAMES.settings)}!$B$${ws + 2}:$C$${ws + 1 + Math.max(1, report.workers.length)}`;

  onProgress?.('Laying out the report sheets');
  const used = new Set<string>([...Object.values(NAMES), 'ANALYST SUMMARY'].map((n) => n.toLowerCase()));
  const months: XSheet[] = [];
  if (opts.monthSheets && p.cols.month !== undefined) {
    const names = monthSheetNames(report.months);
    report.months.forEach((m, i) => {
      const want = m.label.toUpperCase();
      const rows = p.rows.filter((r) => typeof r[p.cols.month!] === 'string' && (r[p.cols.month!] as string).toUpperCase() === want);
      const name = safeSheetName(names[i], used);
      used.add(name.toLowerCase());
      months.push(dataSheet(name, p.headers, rows, st, true));
    });
  }
  const sheets: XSheet[] = [
    dashboardSheet(x), aiSheet(x), settingsSheet(x), checksSheet(x), performanceSheet(x), totalsSheet(x), auditSheet(x),
    dataSheet(NAMES.master, p.headers, p.rows, st), ...months, workerSheet(x), dashboardDataSheet(x),
  ];
  return writeXlsx(sheets, st.book, onProgress);
}

/**
 * Reopens the finished workbook and proves that the MSWD PERFORMANCE sheet shows exactly the numbers
 * computed from the data, and that MASTER DATA kept every row.
 */
export function verifyMswdWorkbook(buf: Uint8Array, p: Prepared, report: MswdReport): { checked: number } {
  const fail = (m: string): never => { throw new Error(`The MSWD workbook failed its safety check: ${m}`); };
  const wb = XLSX.read(buf, { type: 'array', dense: true, sheets: [NAMES.performance, NAMES.master] });
  const perf = wb.Sheets[NAMES.performance] ?? fail('the MSWD PERFORMANCE sheet is missing');
  const grid = (XLSX.utils.sheet_to_json(perf, { header: 1, raw: true, defval: null }) as RawCell[][]);
  const { checked, mismatches, blocks } = compareWithSheet(grid, report);
  if (blocks !== report.blocks.length) fail(`${blocks} of ${report.blocks.length} month blocks were found`);
  if (mismatches.length) { const m = mismatches[0]; fail(`${m.block}, ${m.name}, ${m.column} shows ${m.sheet ?? 'nothing'} instead of ${m.computed}`); }
  const master = wb.Sheets[NAMES.master] ?? fail('the MASTER DATA sheet is missing');
  const range = XLSX.utils.decode_range(master['!ref'] ?? 'A1:A1');
  if (range.e.r !== p.rows.length && p.rows.length > 0) fail(`MASTER DATA has ${range.e.r} rows instead of ${p.rows.length}`);
  return { checked };
}

export const mswdFileName = (report: MswdReport) => {
  const first = report.months[0]?.label.split(' ');
  const last = report.months[report.months.length - 1]?.label.split(' ');
  if (!first || !last) return 'MSWD_PERFORMANCE';
  return first[1] === last[1] ? `MSWD_PERFORMANCE_${first[0]}_${last[0]}_${last[1] ?? ''}`.replace(/_$/, '') : `MSWD_PERFORMANCE_${first.join('_')}_${last.join('_')}`;
};

