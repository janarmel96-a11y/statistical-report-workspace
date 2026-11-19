import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  checkReport, computeReport, dayEntries, detectColumns, monthMismatches, monthOf, overallLabel, periodStats, philippineHolidays,
  planEntryCleanup, prepare, workerChecks, workerNames, workingDays, type MswdColumns,
} from '../src/core/mswd';
import type { RawCell } from '../src/core/types';
import { buildMswdWorkbook, DEFAULT_OPTIONS, monthSheetNames, mswdFileName, verifyMswdWorkbook } from '../src/export/mswdWorkbook';

const at = (y: number, m: number, d: number, h = 9) => ({ date: Date.UTC(y, m - 1, d, h) });

/** Headers in the order of the "NEW PATIENT" Google Form responses. */
const HEADERS = ['Timestamp', 'Score', 'Patient Status', 'Date and Time', 'Hospital No.', 'Medical Social Worker', 'Barangay', 'Municipality', 'Province ', 'Region', 'Type of Patient', 'Service ', 'Classification'];

interface Spec { stamp: RawCell; served?: RawCell; status: string; worker: string; brgy?: string; town?: string; prov?: string; region?: string; type?: string; cls?: string; service?: string }
const row = (s: Spec): RawCell[] => [s.stamp, 0, s.status, s.served ?? s.stamp, '12-34-56', s.worker, s.brgy ?? 'POBLACION', s.town ?? 'DUMANGAS', s.prov ?? 'ILOILO', s.region ?? 'VI', s.type ?? 'OP', s.service ?? 'Family Medicine', s.cls ?? 'C3'];

function sample(): RawCell[][] {
  const rows: RawCell[][] = [];
  // 30 well-formed rows per worker in January and February 2026, so place names have a clear majority.
  for (let d = 1; d <= 30; d++) {
    rows.push(row({ stamp: at(2026, 1, Math.min(d, 31)), status: d % 3 ? 'Old' : 'New', worker: 'ABAJAR, MARY JOY E.', type: d % 5 ? 'OP' : 'ER/ED' }));
    rows.push(row({ stamp: at(2026, 1, Math.min(d, 31), 10), status: 'Old', worker: 'BALAIROS, KYROSE B.', cls: d % 4 ? 'C3' : 'C2' }));
    rows.push(row({ stamp: at(2026, 2, Math.min(d, 28)), status: 'New', worker: 'BALAIROS, KYROSE B.', town: 'BAROTAC NUEVO' }));
  }
  rows.push(row({ stamp: at(2026, 2, 3), status: 'Old', worker: 'ABAJAR, MARY JOY E.', prov: 'ILOLO' }));
  rows.push(row({ stamp: at(2026, 2, 4), status: 'Old', worker: 'ABAJAR, MARY JOY E.', prov: 'DUMANGAS', region: 'ILOILO' }));
  rows.push(row({ stamp: at(2026, 2, 5), status: 'Case Closed', worker: 'abajar, mary joy e.', type: 'Op' }));
  // Entered on March 1 for a February service: counted in February, flagged on DATA CHECKS.
  rows.push(row({ stamp: at(2026, 3, 1, 0), served: at(2026, 2, 27, 15), status: 'Old', worker: 'BALAIROS, KYROSE B.' }));
  return rows;
}

function build() {
  const rows = sample();
  const cols = detectColumns(HEADERS);
  const plan = planEntryCleanup(HEADERS, rows, cols);
  const p = prepare(HEADERS, rows, cols, plan);
  const workers = workerNames(p);
  const report = computeReport(p, workers);
  return { rows, cols, plan, p, workers, report, checks: checkReport(p, report) };
}

describe('MSWD columns and months', () => {
  it('finds the columns of the Google Form responses', () => {
    const c = detectColumns(HEADERS);
    expect(c).toMatchObject({ timestamp: 0, patientStatus: 2, date: 3, hospitalNo: 4, worker: 5, barangay: 6, municipality: 7, province: 8, region: 9, typeOfPatient: 10, service: 11, classification: 12 });
    expect(c.month).toBeUndefined();
    expect(c.patientType).toBeUndefined();
  });
  it('keeps referral addresses away from the patient address', () => {
    const c = detectColumns(['Month', 'Patient Type', 'Medical Social Worker', '🟡 Region (Address of Referring Jail Facility )', 'Region', 'Barangay Error']);
    expect(c).toMatchObject({ month: 0, patientType: 1, worker: 2, region: 4, barangayError: 5 });
  });
  it('reads month labels written in different ways', () => {
    expect(monthOf('January 2026')?.label).toBe('JANUARY 2026');
    expect(monthOf('Sept 2026')?.label).toBe('SEPTEMBER 2026');
    expect(monthOf('2026-03')?.label).toBe('MARCH 2026');
    expect(monthOf('04/2026')?.label).toBe('APRIL 2026');
    expect(monthOf('MAY', 2026)?.label).toBe('MAY 2026');
    expect(monthOf({ date: Date.UTC(2026, 9, 14) })?.label).toBe('OCTOBER 2026');
  });
});

describe('MSWD data preparation', () => {
  it('adds Month and Patient Type first, as in MASTER DATA, and the place-name error columns last', () => {
    const { p } = build();
    expect(p.headers.slice(0, 3)).toEqual(['Month', 'Patient Type', 'Timestamp']);
    expect(p.headers.slice(-5)).toEqual(['Barangay Error', 'Municipality Error', 'Province Error', 'Region Error', 'Total Place-Name Errors']);
    expect(p.added).toEqual(['Month', 'Patient Type', 'Barangay Error', 'Municipality Error', 'Province Error', 'Region Error', 'Total Place-Name Errors']);
    expect(p.months.map((m) => m.label)).toEqual(['JANUARY 2026', 'FEBRUARY 2026']);
    const types = new Set(p.rows.map((r) => r[p.cols.patientType!]));
    expect(types).toEqual(new Set(['OLD', 'NEW', 'CASE CLOSED']));
  });
  it('puts rows in month order, then in the order they were entered', () => {
    const { p } = build();
    const keys = p.rows.map((r) => `${r[p.cols.month!]}`);
    expect(keys.indexOf('FEBRUARY 2026')).toBe(keys.lastIndexOf('JANUARY 2026') + 1);
    const stamps = p.rows.filter((r) => r[p.cols.month!] === 'JANUARY 2026').map((r) => (r[p.cols.timestamp!] as { date: number }).date);
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
  });
  it('reads dates typed as text, as in a CSV download of the form responses', () => {
    const headers = ['Timestamp', 'Patient Status', 'Date and Time', 'Medical Social Worker'];
    const rows: RawCell[][] = [['11/1/2026 9:29:34', 'New', '11/1/2026 9:23:00', 'A'], ['10/31/2026 17:02:11', 'Old', '', 'A'], ['11/18/2026 8:00:00', 'Old', '5/11/1950 8:00:00', 'B']];
    const p = prepare(headers, rows, detectColumns(headers), []);
    expect(p.months.map((m) => m.label)).toEqual(['OCTOBER 2026', 'NOVEMBER 2026']);
    expect(p.rows[0][p.cols.timestamp!]).toEqual({ date: Date.UTC(2026, 9, 31, 17, 2, 11) });
    // A service date decades before the entry is a typing slip, so the Timestamp decides the month.
    expect(p.rows[2][p.cols.month!]).toBe('NOVEMBER 2026');
  });
  it('trims extra spaces in every other cell when asked, without touching the reviewed columns', () => {
    const headers = ['Month', 'Medical Social Worker', 'Patient Family Name', 'Hospital No. ', 'Remarks', 'Type of Patient'];
    const rows: RawCell[][] = [
      ['JANUARY 2026', 'A', ' ABOLOCION ', '25-11-82 \u200B', 'first line  \n\n  second\tline', 'OP '],
      ['JANUARY 2026', 'A', 'BRAGA', '24-86-07', '   ', 'OP'],
    ];
    const cols = detectColumns(headers);
    const plan = planEntryCleanup(headers, rows, cols);
    const keep = new Set(plan.flatMap((p) => p.fixes.map((f) => `${p.col}\u0001${f.from}`)));
    const p = prepare(headers, rows, cols, plan, keep, { trim: true });
    expect(p.rows[0].slice(2, 5)).toEqual(['ABOLOCION', '25-11-82', 'first line\nsecond line']);
    expect(p.rows[1][4]).toBeNull();
    // Type of Patient is a counted column: its correction was switched off, so auto trim leaves it as typed.
    expect(p.rows[0][5]).toBe('OP ');
    expect(p.trimmed).toBe(4);
    expect(p.headers[3]).toBe('Hospital No.');
    expect(prepare(headers, rows, cols, plan).rows[0][2]).toBe(' ABOLOCION ');
  });
  it('flags typos and place names typed in the wrong column', () => {
    const { p } = build();
    const c = p.cols;
    const typo = p.rows.find((r) => r[c.provinceError!] === 'typo')!;
    expect(typo).toBeDefined();
    expect(typo[c.totalErrors!]).toBe(1);
    const shifted = p.rows.find((r) => r[c.regionError!] === 'wrong field')!;
    expect(shifted[c.provinceError!]).toBe('wrong field');
    expect(shifted[c.totalErrors!]).toBe(2);
    expect(p.audit.map((a) => `${a.field}:${a.reason}:${a.value}`)).toEqual(expect.arrayContaining(['Province:typo:ILOLO', 'Province:wrong field:DUMANGAS', 'Region:wrong field:ILOILO']));
  });
});

describe('MSWD report counts', () => {
  it('counts like the COUNTIFS formulas of the original workbook', () => {
    const { report } = build();
    const [jan, feb, overall] = report.blocks;
    const abajar = (b: typeof jan) => b.lines.find((l) => l.name === 'ABAJAR, MARY JOY E.')!;
    expect(abajar(jan)).toMatchObject({ total: 30, types: [0, 6, 24, 0], newPatients: 10, oldPatients: 20 });
    // "abajar, mary joy e." and "Op" match regardless of letter case; CASE CLOSED is neither NEW nor OLD.
    expect(abajar(feb)).toMatchObject({ total: 3, types: [0, 0, 3, 0], newPatients: 0, oldPatients: 2, errors: [0, 0, 2, 1], errorTotal: 3 });
    expect(overall.total.total).toBe(94);
    expect(jan.total.total + feb.total.total).toBe(overall.total.total);
    expect(feb.top).toEqual({ name: 'BALAIROS, KYROSE B.', count: 31 });
    expect(overall.lines.map((l) => l.rank)).toEqual([2, 1]);
  });
  it('proves the totals and explains rows outside the column groups', () => {
    const { checks } = build();
    expect(checks[0]).toMatchObject({ level: 'good', title: 'All 94 rows are counted once' });
    expect(checks.find((c) => c.title.startsWith('Patient type'))).toMatchObject({ level: 'warn', items: [{ label: 'CASE CLOSED', count: 1 }] });
    expect(checks.some((c) => c.level === 'bad')).toBe(false);
  });
  it('names the period like the original report', () => {
    const { report } = build();
    expect(report.title).toBe('MSWD PERFORMANCE REPORT  —  JANUARY to FEBRUARY 2026');
    expect(overallLabel(report.months)).toBe('OVERALL (JAN–FEB 2026)');
    expect(mswdFileName(report)).toBe('MSWD_PERFORMANCE_JANUARY_FEBRUARY_2026');
  });
  it('marks a last month that stops early as partial', () => {
    const headers = ['Month', 'Medical Social Worker', 'Date and Time'];
    const rows: RawCell[][] = [['SEPTEMBER 2026', 'A', at(2026, 9, 30)], ['OCTOBER 2026', 'A', at(2026, 10, 14)]];
    const cols = detectColumns(headers);
    const p = prepare(headers, rows, cols, []);
    const report = computeReport(p, workerNames(p));
    expect(report.title).toBe('MSWD PERFORMANCE REPORT  —  SEPTEMBER to OCTOBER 2026 (OCTOBER PARTIAL: 1–14)');
  });
});

describe('MSWD dashboard figures', () => {
  it('counts working days like NETWORKDAYS with the Philippine holidays of 2026', () => {
    const h = philippineHolidays([2026]).map((x) => x.date);
    const month = (m: number, last?: number) => workingDays(Date.UTC(2026, m - 1, 1), Date.UTC(2026, m - 1, last ?? new Date(Date.UTC(2026, m, 0)).getUTCDate()), h);
    // The working days shown on the original DASHBOARD for January to October 2026 (October through the 15th).
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => month(m))).toEqual([21, 19, 21, 19, 19, 21, 23, 19, 22]);
    expect(month(10, 15)).toBe(11);
  });
  it('finds Holy Week from Easter', () => {
    const names = philippineHolidays([2027]).filter((x) => /Thursday|Good Friday/.test(x.name)).map((x) => new Date(x.date).toISOString().slice(0, 10));
    expect(names).toEqual(['2027-03-25', '2027-03-26']);
  });
  it('counts active days once per worker and day', () => {
    const { p, workers } = build();
    const e = dayEntries(p);
    const jan = periodStats(e, workers, Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 31));
    expect(jan.workers.map((w) => [w.total, w.activeDays])).toEqual([[30, 30], [30, 30]]);
    expect(jan.workerDays).toBe(60);
  });
  it('lists month labels that differ from the Timestamp, with their MASTER DATA row', () => {
    const { p } = build();
    const m = monthMismatches(p);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ label: 'FEBRUARY 2026', byStamp: 'MARCH 2026', worker: 'BALAIROS, KYROSE B.', hospitalNo: '12-34-56' });
    expect(p.rows[m[0].row - 2][p.cols.month!]).toBe('FEBRUARY 2026');
  });
  it('flags worker names that look misspelled', () => {
    const headers = ['Month', 'Medical Social Worker'];
    const rows: RawCell[][] = [...Array.from({ length: 60 }, () => ['JANUARY 2026', 'SALVADOR, MICHELLE A.']), ['JANUARY 2026', 'SALVADOR, MICHELE A.']];
    const p = prepare(headers, rows, detectColumns(headers), []);
    const checks = workerChecks(p, workerNames(p));
    expect(checks.find((w) => w.name === 'SALVADOR, MICHELE A.')).toMatchObject({ similarTo: 'SALVADOR, MICHELLE A.', flag: expect.stringContaining('Low patient count.') });
  });
});

describe('MSWD workbook', () => {
  it('writes the sheets of the original report with formulas that hold the computed values', async () => {
    const { p, report, checks } = build();
    const buf = await buildMswdWorkbook(p, report, checks, DEFAULT_OPTIONS);
    expect(verifyMswdWorkbook(buf, p, report).checked).toBe(3 * 2 * 17);
    const wb = XLSX.read(buf, { type: 'array', cellFormula: true });
    expect(wb.SheetNames).toEqual(['DASHBOARD', 'AI SUMMARY', 'DASHBOARD SETTINGS', 'DATA CHECKS', 'MSWD PERFORMANCE', 'RSW MONTHLY TOTALS', 'MISSPELLING AUDIT', 'MASTER DATA', 'JANUARY', 'FEBRUARY', 'WORKER REPORT', 'DASHBOARD DATA']);
    const perf = wb.Sheets['MSWD PERFORMANCE'];
    expect(perf.A1.v).toBe(report.title);
    expect(perf.A5.v).toBe('JANUARY 2026');
    expect(perf.B5).toMatchObject({ v: 'ABAJAR, MARY JOY E.' });
    expect(perf.A7.v).toBe('OVERALL (JAN–FEB 2026)');
    expect(perf.A10.v).toBe('MSWD PERFORMANCE — JANUARY 2026');
    expect(perf.B13.f).toBe(`COUNTIFS('MASTER DATA'!$A$2:$A$95,"JANUARY 2026",'MASTER DATA'!$H$2:$H$95,$A13)`);
    expect(perf.B13.v).toBe(30);
    const dash = wb.Sheets.DASHBOARD;
    expect(dash.C5.v).toBe('FEBRUARY 2026');
    expect(dash.E6.v).toBe(19);
    expect(dash.B9.v).toBe(report.blocks[1].total.total - 1);
    const totals = wb.Sheets['RSW MONTHLY TOTALS'];
    expect(totals.D5.v).toBe(33);
    expect(wb.Sheets['DATA CHECKS'].F4.v).toBe(1);
    expect(wb.Sheets['MASTER DATA']['!ref']).toBe('A1:T95');
    expect(wb.Sheets.JANUARY['!ref']).toBe('A1:T61');
    expect(wb.Workbook?.Sheets?.map((s) => s.Hidden)).toEqual([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 0]);
  });
  it('adds seven charts (five as in the original, two on AI SUMMARY) and the drop-down lists', async () => {
    const { p, report, checks } = build();
    const zip = await JSZip.loadAsync(await buildMswdWorkbook(p, report, checks, DEFAULT_OPTIONS));
    expect(Object.keys(zip.files).filter((f) => /^xl\/charts\/chart\d+\.xml$/.test(f))).toHaveLength(7);
    const dashboard = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(dashboard).toContain('<dataValidation type="list"');
    expect(dashboard).toContain('<drawing r:id="rId1"/>');
    const types = await zip.file('[Content_Types].xml')!.async('string');
    expect(types).toContain('/xl/charts/chart5.xml');
  });
  it('names month sheets by month, adding the year when two years share a month', () => {
    expect(monthSheetNames([{ label: 'DECEMBER 2025' }, { label: 'JANUARY 2026' }])).toEqual(['DECEMBER', 'JANUARY']);
    expect(monthSheetNames([{ label: 'JANUARY 2025' }, { label: 'JANUARY 2026' }])).toEqual(['JANUARY 2025', 'JANUARY 2026']);
  });
  it('still works when the file has a Month column and its own error columns', async () => {
    const headers = ['Month', 'Patient Type', 'Medical Social Worker', 'Type of Patient', 'Classification', 'Barangay Error', 'Municipality Error', 'Province Error', 'Region Error', 'Total Place-Name Errors'];
    const rows: RawCell[][] = [
      ['JANUARY 2026', 'NEW', 'A', 'OP', 'C3', null, 'typo', null, null, 1],
      ['JANUARY 2026', 'OLD', 'B', 'IP', 'C2', null, null, null, null, 0],
    ];
    const cols: MswdColumns = detectColumns(headers);
    const p = prepare(headers, rows, cols, planEntryCleanup(headers, rows, cols));
    expect(p.added).toEqual([]);
    const report = computeReport(p, workerNames(p));
    expect(report.blocks[0].lines[0]).toMatchObject({ errors: [0, 1, 0, 0], errorTotal: 1 });
    const buf = await buildMswdWorkbook(p, report, checkReport(p, report), { ...DEFAULT_OPTIONS, monthSheets: false });
    expect(verifyMswdWorkbook(buf, p, report).checked).toBe(2 * 2 * 17);
  });
});
