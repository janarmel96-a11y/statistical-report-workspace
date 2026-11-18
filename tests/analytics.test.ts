// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import golden from './golden/golden.json';
import { abTest, describeNumbers, detectAnomalies, linearRegression, measureKind, periodGrowth, segmentTable } from '../src/core/analytics';
import { Engine } from '../src/core/engine';
import { inferTable } from '../src/core/parse';
import { applyStep, auditTrail, outlierLimits, ruleViolations } from '../src/core/recipe';
import type { ReportDoc } from '../src/core/report';
import type { DataTable, Finding } from '../src/core/types';
import { buildProtectedFile, openProtectedFile, sensitiveColumns, viewerProject, type ProtectedProject } from '../src/export/protectedFile';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const G = golden as any;
const close = (a: number, b: number, digits = 7) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(Math.max(Math.abs(b) * 10 ** -digits, 1e-9));
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

describe('inferential statistics match NumPy and SciPy', () => {
  it('multiple regression', () => {
    const r = linearRegression(G.rows.Sales, [G.rows.Units, G.rows.Price], ['Units', 'Price'])!;
    const e = G.regression;
    r.terms.forEach((t, i) => { close(t.coefficient, e.coef[i]); close(t.stdError, e.se[i]); close(t.t, e.t[i]); close(t.p, e.p[i], 5); });
    close(r.r2, e.r2); close(r.adjustedR2, e.adjR2); close(r.f, e.f); expect(r.n).toBe(e.n);
  });
  it('A/B test', () => {
    const e = G.ab;
    const r = abTest(e.successA, e.totalA, e.successB, e.totalB)!;
    close(r.z, e.z); close(r.p, e.p, 6); close(r.low, e.low); close(r.high, e.high);
  });
  it('regression refuses inputs that duplicate each other', () => {
    const x = [1, 2, 3, 4, 5, 6];
    expect(linearRegression([2, 4, 5, 8, 9, 13], [x, x.map((v) => v * 2)], ['a', 'b'])).toBeNull();
  });
  it('A/B test handles identical outcomes', () => {
    expect(abTest(0, 10, 0, 12)).toBeNull();
  });
});

describe('segments, growth, and anomalies', () => {
  const rows = Array.from({ length: 240 }, (_, i) => [new Date(Date.UTC(2025, Math.floor(i / 20), 2 + (i % 20))).toISOString().slice(0, 10), i % 3 ? 'North' : 'South', 100 + (i % 7)]);
  const t = inferTable({ name: 'x', source: 'x', headers: ['Date', 'Region', 'Sales'], rows }).table;
  const en = new Engine(t);
  it('calculates period growth', () => {
    const g = periodGrowth(en, { kind: 'col', col: 'Sales', agg: 'sum' }, 'Date', 'month', []);
    expect(g).toHaveLength(12);
    expect(g[0].growth).toBeNull();
    expect(g[1].change).toBeCloseTo(g[1].value - g[0].value, 8);
    expect(g[1].growth).toBeCloseTo((g[1].value - g[0].value) / g[0].value, 10);
  });
  it('segments add up to every record', () => {
    const s = segmentTable(en, { col: 'Region' }, 'Sales', [], String);
    expect(s.reduce((n, r) => n + r.records, 0)).toBe(240);
    expect(s.reduce((n, r) => n + r.share, 0)).toBeCloseTo(1, 10);
    expect(s[0].label).toBe('North');
  });
  it('finds a spike and a drop', () => {
    const v = [100, 102, 99, 101, 500, 100, 98, 103, 101, 5, 99, 102, 100, 101].map((value, i) => ({ label: `P${i}`, value }));
    const a = detectAnomalies(v);
    expect(a.map((x) => [x.label, x.direction])).toEqual([['P4', 'spike'], ['P9', 'drop']]);
  });
  it('does not flag steady or gently rising data', () => {
    expect(detectAnomalies(Array.from({ length: 24 }, (_, i) => ({ label: `P${i}`, value: 100 + i * 2 + (i % 3) })))).toEqual([]);
  });
  it('summarizes numbers', () => {
    const d = describeNumbers([1, 2, 3, 4, 100], 6)!;
    expect(d).toMatchObject({ n: 5, missing: 1, total: 110, median: 3, min: 1, max: 100 });
  });
  it('separates counts from amounts', () => {
    const c = inferTable({ name: 'x', source: 'x', headers: ['Visits', 'Revenue', 'Rate', 'Order ID'], rows: [[3, 10.5, 0.2, 'A'], [4, 12.25, 0.3, 'B'], [5, 9.75, 0.1, 'C']] }).table.columns;
    expect(c.map(measureKind)).toEqual(['Discrete count', 'Continuous amount', 'Rate or average', 'Identifier']);
  });
});

describe('cleaning and audit trail', () => {
  const t = inferTable({ name: 'x', source: 'x', headers: ['Item', 'Amount', 'Status'], rows: [['A', 10, 'Open'], ['B', 12, 'Closed'], ['C', 11, 'Open'], ['D', 13, 'Bad'], ['E', 12, 'Open'], ['F', 500, 'Open'], ['G', null, 'Closed']] }).table;
  const amount = (x: DataTable) => x.columns[1].values;
  it('removes outliers', () => {
    expect(amount(applyStep(t, { op: 'outliers', col: 'Amount', method: 'remove' }))).toEqual([10, 12, 11, 13, 12, null]);
  });
  it('caps outliers at the expected limit', () => {
    const { high } = outlierLimits(t.columns[1])!;
    const out = applyStep(t, { op: 'outliers', col: 'Amount', method: 'cap' });
    expect(out.rowCount).toBe(7);
    expect(amount(out)[5]).toBeCloseTo(high, 8);
  });
  it('validation rules find and remove violations', () => {
    expect(ruleViolations(t.columns[1], { min: 0, max: 100, required: true })).toEqual([5, 6]);
    expect(ruleViolations(t.columns[2], { allowed: ['Open', 'Closed'] })).toEqual([3]);
    expect(applyStep(t, { op: 'rule', col: 'Status', rule: { allowed: ['Open', 'Closed'] }, action: 'exclude' }).rowCount).toBe(6);
    expect(applyStep(t, { op: 'rule', col: 'Amount', rule: { max: 100 }, action: 'blank' }).columns[1].values[5]).toBeNull();
  });
  it('records every correction and manual change', () => {
    const f: Finding = { id: 'a', kind: 'wrong-calculation', severity: 'error', title: '2 wrong calculations', detail: 'Fixed', count: 2, steps: [], auto: true, changes: [] };
    const log = auditTrail([f], [], [{ op: 'outliers', col: 'Amount', method: 'cap' }, { op: 'rename', col: 'A', name: 'B' }]);
    expect(log.map((x) => x.source)).toEqual(['Automatic check', 'Manual change', 'Manual change']);
    expect(log[1].action).toContain('Amount');
  });
});

describe('role-protected files', () => {
  const raw = { name: 'Cases', source: 'c', headers: ['Timestamp', 'Hospital No.', 'Patient First Name', 'Contact Number', 'Birthday', 'Barangay', 'Sex', 'Town'], rows: Array.from({ length: 12 }, (_, i) => [{ date: Date.UTC(2026, 10, i + 1) }, `H-${i}`, `Person${i}`, 9170000000 + i, { date: Date.UTC(1990, 1, i + 1) }, `Brgy ${i % 3}`, i % 2 ? 'Female' : 'Male', `Town ${i % 2}`]) };
  const table = inferTable(raw).table;
  const report = { title: 'R', pages: [{ id: 'p', name: 'P', layout: [{ i: 'a', x: 0, y: 0, w: 6, h: 8 }, { i: 'b', x: 6, y: 0, w: 6, h: 8 }], visuals: [
    { id: 'a', type: 'bar', title: 'By sex', axis: [{ col: 'Sex' }], values: [{ kind: 'col', col: 'Timestamp', agg: 'rows' }], tooltips: [] },
    { id: 'b', type: 'bar', title: 'By barangay', axis: [{ col: 'Barangay' }], values: [{ kind: 'col', col: 'Timestamp', agg: 'rows' }], tooltips: [] },
  ] }], measures: [], hierarchies: [], parameters: [], bookmarks: [], slicerFields: [{ col: 'Sex' }, { col: 'Barangay' }], recipe: [] } as unknown as ReportDoc;
  const locale = { dateOrder: 'auto', numberLocale: 'auto' } as const;
  const viewer = viewerProject(table, report, locale);
  const owner: ProtectedProject = { role: 'owner', raws: [raw], combine: { mode: 'single' }, locale, steps: [], disabledFindings: [], report };

  it('physically removes personal columns from the viewer copy', () => {
    expect(sensitiveColumns(table).sort()).toEqual(['Barangay', 'Birthday', 'Contact Number', 'Hospital No.', 'Patient First Name'].sort());
    expect(viewer.raws[0].headers).toEqual(['Timestamp', 'Sex', 'Town']);
    expect(JSON.stringify(viewer)).not.toMatch(/Person1|H-1"|917000|Brgy/);
  });
  it('drops charts and filters that depended on removed columns', () => {
    expect(viewer.report.pages[0].visuals.map((v) => v.id)).toEqual(['a']);
    expect(viewer.report.pages[0].layout.map((l) => l.i)).toEqual(['a']);
    expect(viewer.report.slicerFields).toEqual([{ col: 'Sex' }]);
  });
  it('each passcode opens only its own copy', async () => {
    const file = await buildProtectedFile(owner, 'owner-test-code', viewer, 'viewer-test-code');
    expect(file).not.toMatch(/Person1|Cases|Female/);
    expect((await openProtectedFile(file, 'owner-test-code'))?.role).toBe('owner');
    const opened = await openProtectedFile(file, 'viewer-test-code');
    expect(opened?.role).toBe('viewer');
    expect(JSON.stringify(opened)).not.toContain('Person1');
    expect(await openProtectedFile(file, 'wrong-test-code')).toBeNull();
  }, 30000);
});
