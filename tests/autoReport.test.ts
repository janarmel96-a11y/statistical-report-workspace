import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runAudit } from '../src/core/audit';
import { chooseTables, summarizeAuto } from '../src/core/autoReport';
import { inferTable } from '../src/core/parse';
import type { RawTable } from '../src/core/types';
import { readCsv } from '../src/ingest/readers';

/** Rows hold different values in each table, so two tables never look like copies of each other by accident. */
const table = (name: string, headers: string[], rows: number, confidence?: number, offset = name.length * 1000 + name.charCodeAt(0)): RawTable => ({
  name, source: 's', headers, rows: Array.from({ length: rows }, (_, i) => headers.map(() => offset + i)), confidence,
});

describe('automatic table choice', () => {
  it('uses a single table as it is', () => {
    const pick = chooseTables([table('Sales', ['A', 'B'], 5)]);
    expect(pick).toMatchObject({ combine: { mode: 'single' }, skipped: [] });
    expect(pick.tables.map((t) => t.name)).toEqual(['Sales']);
  });
  it('uses the main data and skips a small lookup sheet', () => {
    const pick = chooseTables([table('Targets', ['Branch', 'Target'], 3), table('Sales', ['Date', 'Branch', 'Amount'], 90)]);
    expect(pick.tables.map((t) => t.name)).toEqual(['Sales']);
    expect(pick.skipped).toEqual(['Targets']);
  });
  it('stacks sheets that share the same columns, in any order', () => {
    const pick = chooseTables([table('Jan', ['Date', 'Amount'], 30), table('Feb', ['amount', 'date'], 28), table('Notes', ['Text', 'By'], 2)]);
    expect(pick.combine.mode).toBe('append');
    expect(pick.tables.map((t) => t.name)).toEqual(['Jan', 'Feb']);
    expect(pick.skipped).toEqual(['Notes']);
  });
  it('leaves out monthly sheets whose rows are already in the master sheet', () => {
    const stamp = (m: number, i: number) => ({ date: Date.UTC(2026, m, 1 + (i % 27), 9, i % 60, i % 59) + i });
    const sheet = (name: string, months: number[]): RawTable => ({
      name, source: 's', headers: ['Timestamp', 'Worker', 'Date and Time'],
      rows: months.flatMap((m) => Array.from({ length: 40 }, (_, i) => [stamp(m, i), `W${i % 4}`, null])),
    });
    const jan = sheet('JANUARY', [0]);
    // The monthly copy had its "Date and Time" filled in afterwards, so no row is an exact copy any more.
    jan.rows = jan.rows.map((r) => [r[0], r[1], r[0]]);
    const pick = chooseTables([sheet('MASTER DATA', [0, 1]), jan, sheet('FEBRUARY', [1])]);
    expect(pick.tables.map((t) => t.name)).toEqual(['MASTER DATA']);
    expect(pick.repeated).toEqual(['JANUARY (already inside MASTER DATA)', 'FEBRUARY (already inside MASTER DATA)']);
  });
  it('prefers a clearly read table over a slightly larger unreliable one', () => {
    const pick = chooseTables([table('Blurry', ['A', 'B'], 20, 0.4), table('Clear', ['C', 'D'], 15, 0.98)]);
    expect(pick.tables[0].name).toBe('Clear');
  });
});

describe('automatic summary', () => {
  it('reports exactly what was changed in the retail sample', () => {
    const [raw] = readCsv(readFileSync('public/samples/retail-sales.csv', 'utf8'), 'retail-sales.csv');
    const { table: t, inferred } = inferTable(raw);
    const findings = runAudit(t, inferred);
    const disabled = findings.filter((f) => !f.auto).map((f) => f.id);
    const s = summarizeAuto(chooseTables([raw]), findings, disabled, 1500);
    expect(s).toMatchObject({ used: 'retail-sales', rows: 1500, corrected: 4, removedRows: 3, labelsFixed: 16 });
    expect(s.review).toBe(0);
  });
  it('does not count corrections the person switched off', () => {
    const [raw] = readCsv(readFileSync('public/samples/retail-sales.csv', 'utf8'), 'retail-sales.csv');
    const { table: t, inferred } = inferTable(raw);
    const findings = runAudit(t, inferred);
    expect(summarizeAuto(chooseTables([raw]), findings, findings.map((f) => f.id), 1500)).toMatchObject({ corrected: 0, removedRows: 0, labelsFixed: 0 });
  });
});
