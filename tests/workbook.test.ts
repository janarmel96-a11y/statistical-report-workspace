import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { analyzeReport, briefSections } from '../src/core/analyst';
import { runAudit } from '../src/core/audit';
import { Engine } from '../src/core/engine';
import { generateInsights, newReport, profileTable } from '../src/core/insights';
import { inferTable } from '../src/core/parse';
import { applyRecipe } from '../src/core/recipe';
import { visualTable } from '../src/core/report';
import type { Cell, DataTable } from '../src/core/types';
import { buildCsv, buildWorkbook, csvEscape, safeCell, safeSheetName, safeText, type WorkbookInput } from '../src/export/workbook';
import { BrokenFileError, verifyWorkbook } from '../src/export/verify';
import { readCsv, readWorkbook } from '../src/ingest/readers';

const OUT = process.env.EXPORT_TEST_DIR;

function retailInput(): WorkbookInput {
  const [raw] = readCsv(readFileSync('public/samples/retail-sales.csv', 'utf8'), 'retail-sales.csv');
  const { table, inferred } = inferTable(raw);
  const findings = runAudit(table, inferred);
  const clean = applyRecipe(table, findings.filter((f) => f.auto).flatMap((f) => f.steps));
  const en = new Engine(clean);
  const report = newReport(en, 'Retail: Sales / Review [2025]?');
  const visuals = report.pages.flatMap((p) => p.visuals).flatMap((v) => { const t = visualTable(en, v, []); return t ? [t] : []; });
  return {
    title: report.title, generatedAt: new Date('2026-11-18T10:00:00Z'), filters: 'None',
    kpis: [{ label: 'Net Sales', value: en.evaluate({ kind: 'col', col: 'Net Sales', agg: 'sum' }, []), format: 'currency' }],
    insights: generateInsights(en, []), brief: briefSections(analyzeReport(en, findings, [])), visuals, data: clean, rows: en.allRows, profile: profileTable(clean), findings, measures: [{ name: '=Danger', expr: '=SUM([Net Sales])' }],
  };
}

/** Text and numbers that commonly corrupt spreadsheets. */
function hostileInput(): WorkbookInput {
  const nasty: Cell[] = ['=1+1', '+SUM(A1)', '-2+3', '@cmd', 'a\u0000b\u0008c', 'emoji 😀 ok', 'lone \uD83D surrogate', '<b>&"\'</b>', 'x'.repeat(40000), 'NaN', 'undefined', 'line\nbreak'];
  const rows = nasty.length;
  const t: DataTable = {
    name: 'Bad / data:*?', rowCount: rows, rowIds: nasty.map((_, i) => i),
    columns: [
      { name: 'Text [odd]: name', type: 'text', role: 'text', values: nasty },
      { name: 'Text [odd]: name', type: 'number', role: 'measure', format: 'currency', currency: 'P"H', values: [1, NaN, Infinity, -Infinity, 1e308, -0, 0.1, 0.2, null, 5, 6, 7] },
      { name: 'When', type: 'date', role: 'date', values: [Date.UTC(2024, 1, 29), Date.UTC(1800, 0, 1), Date.UTC(1900, 0, 1), 8.64e15, null, 0, Date.UTC(9999, 11, 31), 1, 2, 3, 4, 5] },
      { name: 'Flag', type: 'boolean', role: 'dimension', values: nasty.map((_, i) => i % 2 === 0) },
    ],
  };
  return {
    title: 'History', generatedAt: new Date('2026-11-18T10:00:00Z'), filters: '=none', kpis: [{ label: '=KPI', value: NaN }, { label: 'x', value: Infinity }, { label: 'y', value: null }],
    insights: [{ id: 'a', kind: 'share', headline: '=Bad\u0007', text: '+text', priority: 1, audit: { formula: '', n: 1, filters: '' } }],
    visuals: [
      { title: 'History', headers: ['A', 'B'], rows: [['=x', 1], ['y', NaN]], formats: [undefined, { format: 'number' }], additive: [false, true] },
      { title: 'history', headers: ['A', 'B'], rows: [['a', 0], ['b', 0]], formats: [undefined, { format: 'percent' }], additive: [false, true] },
      { title: 'A very long visual title that goes well beyond the thirty one character sheet name limit', headers: ['A', 'B', 'C'], rows: [['a', 1, 2]], formats: [undefined, {}, {}], additive: [false, true, true] },
      { title: 'A very long visual title that goes well beyond the thirty one character sheet name limit', headers: ['A', 'B'], rows: [['a', 1]], formats: [undefined, {}], additive: [false, false], overall: ['Overall', 1] },
      { title: '***', headers: ['A'], rows: [['a']], formats: [undefined], additive: [false] },
    ],
    data: t, rows: Uint32Array.from({ length: rows }, (_, i) => i), profile: profileTable({ ...t, columns: t.columns.slice(0, 1) }),
    findings: [{ id: 'f', kind: 'wrong-calculation', severity: 'error', title: '=t', detail: '@d', count: 1, steps: [], auto: true, changes: [{ row: 0, column: '=c', before: NaN, after: 'x\u0001', reason: '+r' }] }],
    measures: [],
  };
}

const save = (name: string, buf: ArrayBuffer) => { if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, name), Buffer.from(buf)); } };

describe('Excel and Google Sheets export', () => {
  it.each(['excel', 'sheets'] as const)('retail report for %s passes verification and keeps every number', async (target) => {
    const input = retailInput();
    const buf = await buildWorkbook(input, { target });
    save(`retail-${target}.xlsx`, buf);
    await verifyWorkbook(buf, input);
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellFormula: true, cellDates: false });
    expect(wb.SheetNames.slice(0, 1)).toEqual(['Summary']);
    ['Data', 'Column Statistics', 'Corrections', 'Measures'].forEach((n) => expect(wb.SheetNames).toContain(n));
    // The AI analyst brief has its own sheet, starting with its headline.
    expect(wb.SheetNames[1]).toBe('AI Summary');
    expect(String(wb.Sheets['AI Summary'].A1.v)).toBe('AI analyst brief');
    expect(String(wb.Sheets['AI Summary'].A4.v)).toBe(input.brief![0].heading);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Data, { header: 1, blankrows: false });
    expect(rows.length - 3).toBe(input.rows.length);
    const netCol = input.data.columns.findIndex((c) => c.name === 'Net Sales');
    const saved = rows.slice(3).reduce<number>((s, r) => s + (r[netCol] as number), 0);
    const source = (input.data.columns[netCol].values as number[]).reduce((a, b) => a + b, 0);
    expect(Math.abs(saved - source)).toBeLessThan(1e-6);
    // Dates stay real dates, not text.
    const dateCell = wb.Sheets.Data[XLSX.utils.encode_cell({ r: 3, c: 1 })];
    expect(dateCell.t).toBe('n');
    expect(Math.round(dateCell.v as number)).toBe(Math.round((input.data.columns[1].values[0] as number) / 86400000 + 25569));
    // Formula-like text stays as text.
    const m = wb.Sheets.Measures.B4;
    expect(m.t).toBe('s');
    expect(m.f).toBeUndefined();
  });

  it('survives hostile content', async () => {
    const input = hostileInput();
    const buf = await buildWorkbook(input, { target: 'excel' });
    save('hostile-excel.xlsx', buf);
    await verifyWorkbook(buf, input);
    const zip = await JSZip.loadAsync(buf);
    for (const f of Object.keys(zip.files).filter((n) => n.endsWith('.xml'))) {
      const text = await zip.file(f)!.async('string');
      // eslint-disable-next-line no-control-regex
      expect(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text), f).toBe(false);
    }
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellFormula: true });
    expect(new Set(wb.SheetNames.map((n) => n.toLowerCase())).size).toBe(wb.SheetNames.length);
    wb.SheetNames.forEach((n) => { expect(n.length).toBeLessThanOrEqual(31); expect(n).not.toMatch(/[\\/*?:[\]]/); });
    expect(wb.SheetNames.map((n) => n.toLowerCase())).not.toContain('history');
    const a = wb.Sheets.Data.A4;
    expect(a.t).toBe('s');
    expect(a.f).toBeUndefined();
    expect(a.v).toBe('=1+1');
  });

  it('the verifier rejects damaged files', async () => {
    const input = retailInput();
    const buf = await buildWorkbook(input, { target: 'sheets' });
    const zip = await JSZip.loadAsync(buf);
    zip.remove('xl/styles.xml');
    await expect(verifyWorkbook(await zip.generateAsync({ type: 'arraybuffer' }), input)).rejects.toBeInstanceOf(BrokenFileError);
    const tampered = { ...input, data: { ...input.data, columns: input.data.columns.map((c) => (c.name === 'Net Sales' ? { ...c, values: c.values.map((v) => (v as number) + 1) } : c)) } };
    await expect(verifyWorkbook(buf, tampered)).rejects.toBeInstanceOf(BrokenFileError);
  });

  it('an exported workbook can be imported again with identical totals', async () => {
    const input = retailInput();
    const buf = await buildWorkbook(input, { target: 'sheets' });
    const tables = readWorkbook(buf, 'round.xlsx');
    const dataTable = tables.find((t) => t.name === 'Data')!;
    const { table } = inferTable(dataTable);
    const net = table.columns.find((c) => c.name === 'Net Sales')!;
    expect(table.rowCount).toBe(input.rows.length);
    expect(net.type).toBe('number');
    const total = (net.values as number[]).reduce((a, b) => a + b, 0);
    expect(Math.abs(total - (input.data.columns.find((c) => c.name === 'Net Sales')!.values as number[]).reduce((a, b) => a + b, 0))).toBeLessThan(1e-6);
    expect(table.columns.find((c) => c.name === 'Order Date')!.type).toBe('date');
  });

  it('cleans individual values', () => {
    expect(safeText('a\u0000b')).toBe('ab');
    expect(safeText('x'.repeat(40000)).length).toBe(32767);
    expect(safeCell(NaN)).toBeNull();
    expect(safeCell(Infinity)).toBeNull();
    expect(safeCell(Date.UTC(1800, 0, 1), { type: 'date' })).toBe('1800-01-01');
    const used = new Set<string>();
    expect(safeSheetName('A/B:C*D?[E]', used)).toBe('A B C D E');
    expect(safeSheetName('a b c d e', used)).toBe('a b c d e (2)');
    expect(safeSheetName('History', used)).toBe('History (2)');
    expect(safeSheetName('', used)).toBe('Sheet');
  });

  it('CSV blocks formula injection but keeps real numbers', () => {
    expect(csvEscape('=1+1')).toBe("'=1+1");
    expect(csvEscape('@x')).toBe("'@x");
    expect(csvEscape(-5)).toBe('-5');
    expect(csvEscape('a,"b"')).toBe('"a,""b"""');
    const t: DataTable = { name: 'x', rowCount: 1, rowIds: [0], columns: [{ name: 'D', type: 'date', role: 'date', values: [Date.UTC(2024, 0, 2)] }, { name: 'N', type: 'number', role: 'measure', values: [1.5] }] };
    expect(buildCsv(t, [0])).toBe('﻿D,N\r\n2024-01-02,1.5\r\n');
  });
});
