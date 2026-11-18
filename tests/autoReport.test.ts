import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runAudit } from '../src/core/audit';
import { chooseTables, summarizeAuto } from '../src/core/autoReport';
import { inferTable } from '../src/core/parse';
import type { RawTable } from '../src/core/types';
import { readCsv } from '../src/ingest/readers';

const table = (name: string, headers: string[], rows: number, confidence?: number): RawTable => ({
  name, source: 's', headers, rows: Array.from({ length: rows }, (_, i) => headers.map(() => i)), confidence,
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
