// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { canMerge, checkCombined, combineSources, headersLookAlike, matchColumns, mergeColumns, separateColumn, type CombineOptions, type CombineSource } from '../src/core/combine';
import type { RawCell } from '../src/core/types';
import { buildCombinedCsv, buildCombinedWorkbook, verifyCombinedWorkbook } from '../src/export/combined';
import { readWorkbook } from '../src/ingest/readers';

/** Invented records that follow the kinds of differences seen in real form exports. */
const day = (y: number, m: number, d: number, h = 0): RawCell => ({ date: Date.UTC(y, m, d, h) });
const first: CombineSource = {
  name: 'Old cases',
  headers: ['Timestamp', 'Case No.', 'Contact Number', 'Insurance status', 'If for PDL/PAT TOOL', 'Others (1. Reason)', 'Sex', 'Ward'],
  rows: [
    [day(2026, 10, 1, 8), 'A-100', 9171234567, 'Member', 'Yes', null, 'F', 'East'],
    [day(2026, 10, 2, 9), 12345678, 9181234567, 'None', 'No', 'Note', 'M', 'West'],
  ],
};
const second: CombineSource = {
  name: 'New cases',
  headers: ['Timestamp', 'Case No.', 'Gender', 'Contact Number', 'Insurance Status', 'If PDL/ PAT', 'Others (2. Reason)', 'Sex', 'Ward', 'Type of Ward'],
  rows: [
    [day(2026, 10, 3, 10), 'B-200', 'Woman', 9191234567, 'Member', 'No', 'Other', 'F', 'North', 'Open'],
    [day(2026, 10, 4), 'B-201', 'Man', '0917-555-0100', 'None', 'Yes', null, 'M', '  ', 'Closed'],
    [day(2026, 10, 5), '=SUM(A1)', 'Man', 9201234567, 'None', 'Yes', null, 'M', 'South', 'Open'],
  ],
};
const sources = [first, second];
const opts: CombineOptions = { addSource: true, sourceHeader: 'Source File', removeDuplicates: false };

describe('matching headers', () => {
  const columns = matchColumns(sources);
  const named = (n: string) => columns.find((c) => c.name === n)!;
  it('matches exact headers even when the order differs', () => {
    expect(named('Contact Number').map).toEqual([2, 3]);
    expect(named('Sex').map).toEqual([6, 7]);
  });
  it('treats capitalization as the same header without asking', () => {
    expect(named('Insurance status')).toMatchObject({ map: [3, 4], similar: false });
  });
  it('matches filler-word differences and flags them for review', () => {
    expect(named('If for PDL/PAT TOOL')).toMatchObject({ map: [4, 5], similar: true });
  });
  it('never matches numbered questions that differ', () => {
    expect(headersLookAlike('Others (1. Reason)', 'Others (2. Reason)')).toBe(false);
    expect(named('Others (1. Reason)').map).toEqual([5, null]);
    expect(named('Others (2. Reason)').map).toEqual([null, 6]);
  });
  it('keeps columns found in one file next to their neighbors', () => {
    const names = columns.map((c) => c.name);
    expect(names.indexOf('Gender')).toBe(names.indexOf('Case No.') + 1);
    expect(names.indexOf('Type of Ward')).toBe(names.indexOf('Ward') + 1);
  });
  it('does not treat different concepts as the same', () => {
    expect(named('Gender').map).toEqual([null, 2]);
    expect(headersLookAlike('Case No.', 'Ticket No.')).toBe(false);
  });
  it('can undo a match or add one by hand', () => {
    const at = columns.findIndex((c) => c.similar);
    const apart = separateColumn(columns, at, sources);
    expect(apart).toHaveLength(columns.length + 1);
    expect(apart[at].map).toEqual([4, null]);
    expect(apart[at + 1].map).toEqual([null, 5]);
    expect(canMerge(apart[at], apart[at + 1])).toBe(true);
    expect(mergeColumns(apart, at, at + 1)[at].map).toEqual([4, 5]);
    expect(canMerge(columns[0], columns[1])).toBe(false);
  });
});

describe('combining rows', () => {
  const columns = matchColumns(sources);
  const r = combineSources(sources, columns, opts);
  const col = (n: string) => r.headers.indexOf(n);
  it('stacks every row and records its source', () => {
    expect(r.rows).toHaveLength(5);
    expect(r.rowsPerSource).toEqual([2, 3]);
    expect(r.rows.map((x) => x[0])).toEqual(['Old cases', 'Old cases', 'New cases', 'New cases', 'New cases']);
  });
  it('puts each value under the right header', () => {
    expect(r.rows[2][col('Contact Number')]).toBe(9191234567);
    expect(r.rows[2][col('Gender')]).toBe('Woman');
    expect(r.rows[0][col('Gender')]).toBeNull();
    expect(r.rows[2][col('Insurance status')]).toBe('Member');
    expect(r.rows[3][col('Ward')]).toBeNull();
  });
  it('passes the completeness check', () => {
    expect(checkCombined(sources, columns, r, opts)).toBeNull();
  });
  it('detects a lost value or column', () => {
    const broken = { ...r, rows: r.rows.map((x, i) => (i === 0 ? x.map((v, c) => (c === col('Sex') ? null : v)) : x)) };
    expect(checkCombined(sources, columns, broken, opts)).toContain('Sex');
    expect(checkCombined(sources, columns.slice(1), combineSources(sources, columns.slice(1), opts), opts)).toContain('left out');
  });
  it('removes exact duplicates only when asked', () => {
    const dup: CombineSource = { ...first, name: 'Copy' };
    const all = [first, dup];
    const m = matchColumns(all);
    expect(combineSources(all, m, opts).rows).toHaveLength(4);
    const d = combineSources(all, m, { ...opts, removeDuplicates: true });
    expect(d.rows).toHaveLength(2);
    expect(d.duplicatesRemoved).toBe(2);
  });
});

describe('combined files', () => {
  const columns = matchColumns(sources);
  const r = combineSources(sources, columns, opts);
  it('keeps types exactly in Excel', async () => {
    const buf = await buildCombinedWorkbook(sources, columns, r);
    verifyCombinedWorkbook(buf, r);
    const ws = XLSX.read(new Uint8Array(buf), { type: 'array', cellFormula: true, cellNF: true }).Sheets.Combined;
    const at = (row: number, name: string) => ws[XLSX.utils.encode_cell({ r: row, c: r.headers.indexOf(name) })];
    expect(at(1, 'Contact Number')).toMatchObject({ t: 'n', v: 9171234567 });
    expect(at(1, 'Contact Number').z).toBe('0');
    expect(at(4, 'Contact Number')).toMatchObject({ t: 's', v: '0917-555-0100' });
    expect(at(5, 'Case No.')).toMatchObject({ t: 's', v: '=SUM(A1)' });
    expect(at(5, 'Case No.').f).toBeUndefined();
    expect(at(1, 'Timestamp').t).toBe('n');
    expect(at(1, 'Timestamp').z).toContain('yyyy');
  });
  it('can be imported again with the same rows', async () => {
    const tables = readWorkbook(await buildCombinedWorkbook(sources, columns, r), 'combined.xlsx');
    const t = tables.find((x) => x.name === 'Combined')!;
    expect(t.rows).toHaveLength(5);
    expect(t.headers).toEqual(r.headers);
  });
  it('rejects a workbook that does not match', async () => {
    const buf = await buildCombinedWorkbook(sources, columns, r);
    const changed = { ...r, rows: r.rows.map((x, i) => (i === 1 ? x.map((v) => (v === 9181234567 ? 1 : v)) : x)) };
    expect(() => verifyCombinedWorkbook(buf, changed)).toThrow('safety check');
  });
  it('protects CSV from formula injection', () => {
    const csv = buildCombinedCsv(r);
    expect(csv).toContain("'=SUM(A1)");
    expect(csv).toContain('2026-11-01 08:00:00');
  });
});
