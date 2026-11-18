import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectRules, qualityScore, runAudit } from '../src/core/audit';
import { detectDateOrder, inferColumn, inferTable, parseDate, parseNumber } from '../src/core/parse';
import { appendTables, applyRecipe, joinTables } from '../src/core/recipe';
import type { RawCell, RawTable, Step } from '../src/core/types';
import { gridToTables } from '../src/ingest/grid';
import { readCsv, readJson } from '../src/ingest/readers';
import { joinPages, tablesOnPage, type TextBox } from '../src/ingest/pdfTables';

const raw = (headers: string[], rows: RawCell[][]): RawTable => ({ name: 'T', source: 't', headers, rows });
const fixAll = (f: ReturnType<typeof runAudit>) => f.filter((x) => x.auto).flatMap((x) => x.steps as Step[]);

describe('reading numbers and dates', () => {
  it.each([
    ['$1,234.50', 1234.5], ['(500)', -500], ['-12', -12], ['12-', -12], ['1.234,56', 1234.56], ['1 234', 1234], ['45%', 0.45],
    ['₱2,500', 2500], ['€1.000,50', 1000.5], ['+7', 7], ['3.5e3', 3500], ['1,234,567', 1234567], ['12,5', 12.5], ['(1,200.75)', -1200.75],
  ])('%s', (s, v) => expect(parseNumber(s)?.value).toBeCloseTo(v, 8));
  it.each(['00123', 'abc', '12a', '2024-01-15', '1,23,4', ''])('rejects %s', (s) => expect(parseNumber(s)).toBeNull());
  it('parses dates without timezone shifts', () => {
    const d = Date.UTC(2024, 2, 5);
    ['2024-03-05', '03/05/2024', 'Mar 5, 2024', '5 March 2024', 'March 5 2024', '2024/03/05'].forEach((s) => expect(parseDate(s)).toBe(d));
    expect(parseDate('05/03/2024', 'dmy')).toBe(d);
    expect(parseDate('2024-02-30')).toBeNull();
    expect(parseDate('13/13/2024')).toBeNull();
    expect(parseDate('Q2 2024')).toBe(Date.UTC(2024, 3, 1));
  });
  it('detects day-first dates from unambiguous values', () => {
    expect(detectDateOrder(['25/03/2024', '01/02/2024'])).toEqual({ order: 'dmy', ambiguous: false });
    expect(detectDateOrder(['03/25/2024'])).toEqual({ order: 'mdy', ambiguous: false });
    expect(detectDateOrder(['01/02/2024']).ambiguous).toBe(true);
  });
  it('keeps codes with leading zeros as text', () => {
    expect(inferColumn('Zip', ['00501', '02134', '10001', '07030', '60601']).column.type).not.toBe('number');
  });
  it('never treats IDs or rates as summable', () => {
    expect(inferColumn('Order ID', [1001, 1002, 1005, 1009, 1200]).column.role).toBe('id');
    expect(inferColumn('Discount Rate', [0.1, 0.2, 0.15]).column.role).toBe('ratio');
    expect(inferColumn('Margin %', ['10%', '20%', '15%']).column.role).toBe('ratio');
    expect(inferColumn('Year', [2022, 2023, 2024]).column.role).toBe('dimension');
    expect(inferColumn('Revenue', [100.5, 220, 310]).column.role).toBe('measure');
  });
});

describe('computation audit', () => {
  const rows = (): RawCell[][] => Array.from({ length: 40 }, (_, i) => {
    const q = (i % 7) + 1;
    const p = 10 + (i % 5) * 2.5;
    return [`SKU-${100 + i}`, ['North', 'South'][i % 2], q, p, q * p];
  });
  const headers = ['SKU Code', 'Region', 'Qty', 'Unit Price', 'Amount'];

  it('corrects a wrong multiplication and shows the original value', () => {
    const r = rows();
    const expected = r[5][4];
    r[5][4] = 999999;
    const { table, inferred } = inferTable(raw(headers, r));
    const f = runAudit(table, inferred).find((x) => x.kind === 'wrong-calculation')!;
    expect(f.count).toBe(1);
    expect(f.changes[0]).toMatchObject({ row: 5, column: 'Amount', before: 999999, after: expected });
    expect(applyRecipe(table, f.steps).columns[4].values[5]).toBe(expected);
  });
  it('recalculates spreadsheet errors and missing results', () => {
    const r = rows();
    const [a, b] = [r[3][4], r[8][4]];
    r[3][4] = '#DIV/0!';
    r[8][4] = null;
    const { table, inferred } = inferTable(raw(headers, r));
    const findings = runAudit(table, inferred);
    expect(findings.some((x) => x.kind === 'sheet-error')).toBe(true);
    const out = applyRecipe(table, fixAll(findings));
    expect(out.columns[4].values[3]).toBe(a);
    expect(out.columns[4].values[8]).toBe(b);
  });
  it('does not flag values within rounding', () => {
    const r = Array.from({ length: 30 }, (_, i) => { const q = i + 1; const p = 3.33 + i / 100; return [q, p, Math.round(q * p * 100) / 100]; });
    const { table, inferred } = inferTable(raw(['Qty', 'Price', 'Total'], r));
    expect(runAudit(table, inferred).filter((x) => x.kind === 'wrong-calculation')).toHaveLength(0);
  });
  it('fixes chained calculations in order', () => {
    const r = Array.from({ length: 30 }, (_, i) => { const gross = 100 + i * 7; const disc = i * 2; return [gross, disc, gross - disc, Math.round((gross - disc) * 0.1 * 100) / 100, Math.round((gross - disc) * 1.1 * 100) / 100]; });
    const right = r[4][2];
    r[4][2] = 5; // Net is wrong. Later columns were calculated from the right value.
    const { table, inferred } = inferTable(raw(['Gross', 'Disc', 'Net', 'Tax', 'Due'], r));
    const f = runAudit(table, inferred).filter((x) => x.kind === 'wrong-calculation');
    expect(f.find((x) => x.column === 'Net')?.changes[0].after).toBe(right);
    expect(f.find((x) => x.column === 'Due')).toBeUndefined();
  });
  it('corrects row totals across several columns', () => {
    const r = Array.from({ length: 20 }, (_, i) => {
      const q = [((i * 7) % 13) + 2, ((i * 5) % 11) + 3, ((i * 3) % 17) + 1, ((i * 11) % 19) + 4];
      return [`R${i}`, ...q, q[0] + q[1] + q[2] + q[3]];
    });
    const right = r[7][5];
    r[7][5] = 1;
    const { table, inferred } = inferTable(raw(['Name', 'Q1', 'Q2', 'Q3', 'Q4', 'Total'], r));
    const f = runAudit(table, inferred).find((x) => x.kind === 'wrong-calculation')!;
    expect(f.changes[0].after).toBe(right);
  });
  it('removes total rows and checks their printed values', () => {
    const r: RawCell[][] = [['A', 10], ['B', 20], ['C', 30], ['Total', 70]];
    const { table, inferred } = inferTable(raw(['Item', 'Sales'], r));
    const f = runAudit(table, inferred);
    expect(f.find((x) => x.kind === 'total-row')?.count).toBe(1);
    expect(f.find((x) => x.kind === 'wrong-total')?.changes[0]).toMatchObject({ before: 70, after: 60 });
    const out = applyRecipe(table, fixAll(f));
    expect(out.rowCount).toBe(3);
    expect((out.columns[1].values as number[]).reduce((a, b) => a + b, 0)).toBe(60);
  });
  it('handles subtotals inside the data', () => {
    const r: RawCell[][] = [['A', 1], ['B', 2], ['Subtotal', 3], ['C', 4], ['D', 5], ['Subtotal', 9], ['Grand Total', 12]];
    const { table, inferred } = inferTable(raw(['Item', 'Sales'], r));
    const f = runAudit(table, inferred);
    expect(f.find((x) => x.kind === 'total-row')?.count).toBe(3);
    expect(f.find((x) => x.kind === 'wrong-total')).toBeUndefined();
  });
  it('finds a Total label placed in a date column', () => {
    const r: RawCell[][] = [['2025-01-01', 10], ['2025-01-02', 20], ['2025-01-03', 30], ['2025-01-04', 5], ['2025-01-05', 6], ['Total', 71]];
    const { table, inferred } = inferTable(raw(['Date', 'Sales'], r));
    const f = runAudit(table, inferred);
    expect(f.find((x) => x.kind === 'total-row')?.count).toBe(1);
    expect(f.find((x) => x.kind === 'invalid-value')).toBeUndefined();
    expect(applyRecipe(table, fixAll(f)).rowCount).toBe(5);
  });
  it('removes unlabeled total rows', () => {
    const r: RawCell[][] = [['A', 10, 1], ['B', 20, 2], ['C', 30, 3], ['D', 40, 4], [null, 100, 10]];
    const { table, inferred } = inferTable(raw(['Item', 'Sales', 'Units'], r));
    expect(applyRecipe(table, fixAll(runAudit(table, inferred))).rowCount).toBe(4);
  });
  it('only auto-removes duplicates when an ID proves them', () => {
    const withId = inferTable(raw(['Order ID', 'Sales'], [['A1', 5], ['A2', 6], ['A1', 5], ['A3', 8]]));
    expect(runAudit(withId.table, withId.inferred).find((x) => x.kind === 'duplicate-rows')?.auto).toBe(true);
    const noId = inferTable(raw(['Item', 'Sales'], [['A', 5], ['B', 6], ['A', 5], ['C', 8]]));
    expect(runAudit(noId.table, noId.inferred).find((x) => x.kind === 'duplicate-rows')?.auto).toBe(false);
  });
  it('merges inconsistent labels', () => {
    const v = ['North', 'North', 'north', 'NORTH ', 'South', 'South'];
    const t = inferTable(raw(['Region', 'Sales'], v.map((x, i) => [x, i])));
    const out = applyRecipe(t.table, fixAll(runAudit(t.table, t.inferred)));
    expect(new Set(out.columns[0].values)).toEqual(new Set(['North', 'South']));
  });
  it('finds no calculation rule in unrelated numbers', () => {
    let s = 7;
    const n = () => { s = (s * 16807) % 2147483647; return (s % 9000) / 10; };
    const r = Array.from({ length: 200 }, () => [n(), n(), n(), n()]);
    const { table } = inferTable(raw(['A', 'B', 'C', 'D'], r));
    expect(detectRules(table, table.rowIds)).toHaveLength(0);
  });
  it('clean data gets a perfect score', () => {
    const t = inferTable(raw(['Item', 'Sales'], [['A', 5], ['B', 6], ['C', 7], ['D', 8]]));
    const f = runAudit(t.table, t.inferred);
    expect(f).toHaveLength(0);
    expect(qualityScore(t.table, f).score).toBe(100);
  });
  it('finds every error planted in the retail sample', () => {
    const text = readFileSync('public/samples/retail-sales.csv', 'utf8');
    const [tbl] = readCsv(text, 'retail-sales.csv');
    const { table, inferred } = inferTable(tbl);
    const f = runAudit(table, inferred);
    expect(f.find((x) => x.kind === 'total-row')?.count).toBe(1);
    expect(f.find((x) => x.kind === 'duplicate-rows')?.count).toBe(2);
    // Only the planted Gross Sales total is wrong once the rows themselves are corrected.
    const wrongTotal = f.find((x) => x.kind === 'wrong-total')!;
    expect(wrongTotal.changes.map((c) => c.column)).toEqual(['Gross Sales']);
    expect(Math.abs((wrongTotal.changes[0].before as number) - (wrongTotal.changes[0].after as number))).toBeCloseTo(250, 2);
    expect(f.find((x) => x.kind === 'sheet-error')?.column).toBe('Gross Sales');
    const calc = f.filter((x) => x.kind === 'wrong-calculation');
    expect(calc.find((x) => x.column === 'Gross Sales')?.count).toBe(2);
    expect(calc.find((x) => x.column === 'Net Sales')?.count).toBe(2);
    const out = applyRecipe(table, fixAll(f));
    expect(out.rowCount).toBe(1500);
    const c = (n: string) => out.columns.find((x) => x.name === n)!.values as number[];
    for (let i = 0; i < out.rowCount; i++) {
      expect(Math.abs(c('Gross Sales')[i] - c('Quantity')[i] * c('Unit Price')[i])).toBeLessThan(0.0051);
      expect(Math.abs(c('Net Sales')[i] - (c('Gross Sales')[i] - c('Discount')[i]))).toBeLessThan(0.0051);
    }
    expect(new Set(out.columns.find((x) => x.name === 'Region')!.values).size).toBe(5);
  });
});

describe('importing tables', () => {
  it('skips report titles above the header', () => {
    const t = gridToTables([['Quarterly report', null], [null, null], ['Item', 'Sales'], ['A', 1], ['B', 2]], 'S', 's');
    expect(t).toHaveLength(1);
    expect(t[0].headers).toEqual(['Item', 'Sales']);
    expect(t[0].rows).toHaveLength(2);
  });
  it('finds separate tables on one sheet', () => {
    expect(gridToTables([['A', 'B'], [1, 2], [3, 4], [null, null], ['C', 'D'], [5, 6], [7, 8]], 'S', 's')).toHaveLength(2);
  });
  it('rejoins data split by a stray blank row', () => {
    const t = gridToTables([['Item', 'Sales'], ['A', 1], ['B', 2], [null, null], ['C', 3], ['D', 4]], 'S', 's');
    expect(t).toHaveLength(2 - 1);
    expect(t[0].rows).toHaveLength(4);
  });
  it('handles a table with several hundred thousand rows', () => {
    const grid: RawCell[][] = [['Item', 'Sales'], ...Array.from({ length: 300000 }, (_, i): RawCell[] => [`A${i}`, i])];
    expect(gridToTables(grid, 'S', 's')[0].rows).toHaveLength(300000);
  });
  it('reads semicolon CSV and quoted separators', () => {
    const [t] = readCsv('Name;Amount\n"Smith; John";"1.234,50"\nLee;20\n', 'x.csv');
    expect(t.headers).toEqual(['Name', 'Amount']);
    expect(t.rows[0][0]).toBe('Smith; John');
  });
  it('flattens nested JSON', () => {
    const [t] = readJson(JSON.stringify({ data: [{ id: 1, buyer: { city: 'Davao' }, tags: ['a', 'b'] }, { id: 2, buyer: { city: 'Cebu' } }] }), 'x.json');
    expect(t.headers).toEqual(['id', 'buyer.city', 'tags']);
    expect(t.rows[1][1]).toBe('Cebu');
  });
  it('stacks and joins tables without inflating totals', () => {
    const a = inferTable(raw(['Region', 'Sales'], [['N', 1], ['S', 2]])).table;
    const b = inferTable(raw(['Region', 'Sales'], [['E', 3]])).table;
    expect(appendTables([a, b], 'all').rowCount).toBe(3);
    const lookup = inferTable(raw(['Code', 'Manager'], [['N', 'Ana'], ['N', 'Duplicate'], ['S', 'Ben']])).table;
    const j = joinTables(a, lookup, 'Region', 'Code');
    expect(j.table.rowCount).toBe(2);
    expect(j.repeatedKeys).toBe(1);
    expect(j.table.columns[2].values).toEqual(['Ana', 'Ben']);
  });
  it('extracts PDF tables from positioned text', () => {
    const put = (rowsIn: string[][], top: number): TextBox[] => rowsIn.flatMap((r, y) => r.map((s, x) => ({ str: s, x: 60 + x * 130 + (x ? 40 - s.length * 5 : 0), y: top + y * 16, w: s.length * 5, h: 10 })));
    const page1 = [{ str: 'Annual sales summary for all stores', x: 60, y: 30, w: 200, h: 14 }, ...put([['Region', 'Units', 'Sales'], ['North', '120', '4,500.00'], ['South', '95', '3,120.50'], ['East', '60', '2,010.25']], 80)];
    const t = tablesOnPage(page1, 1);
    expect(t).toHaveLength(1);
    expect(t[0].headers).toEqual(['Region', 'Units', 'Sales']);
    expect(t[0].rows[1]).toEqual(['South', '95', '3,120.50']);
    const pg = (p: number) => tablesOnPage(put([['Region', 'Units', 'Sales'], ['North', '1', '2.00'], ['South', '3', '4.00']], 10), p);
    expect(joinPages([...pg(1), ...pg(2)])[0].rows).toHaveLength(4);
  });
});
