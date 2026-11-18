// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { bucketLabel, Engine, groupConstraint, lastPeriodIncomplete } from './engine';
import { fUpper, mean, meanCI, median, normalTwoSided, quantile, stdev, sum, tTwoSided } from './stats';
import type { Cell, Column, Constraint, DatePart, FieldRef, ValueRef } from './types';

/** Descriptive, inferential, segmentation, and anomaly analysis. Free of browser APIs so it can be tested. */

export type MeasureKind = 'Discrete count' | 'Continuous amount' | 'Rate or average' | 'Identifier' | 'Category' | 'Date' | 'Text';

/** Counts are whole things that can be tallied. Amounts can take any value on a scale. */
export function measureKind(c: Column): MeasureKind {
  if (c.role === 'id') return 'Identifier';
  if (c.type === 'date') return 'Date';
  if (c.type === 'text') return 'Text';
  if (c.type !== 'number') return 'Category';
  if (c.role === 'ratio') return 'Rate or average';
  const whole = c.values.every((v) => v === null || Number.isInteger(v));
  return whole && c.format !== 'currency' ? 'Discrete count' : 'Continuous amount';
}

export interface Descriptive { n: number; missing: number; total: number; mean: number; median: number; stdev: number | null; min: number; max: number; q1: number; q3: number; ciLow: number | null; ciHigh: number | null }

export function describeNumbers(xs: number[], rows: number): Descriptive | null {
  if (!xs.length) return null;
  const ci = meanCI(xs);
  return {
    n: xs.length, missing: rows - xs.length, total: sum(xs), mean: mean(xs), median: median(xs), stdev: xs.length > 1 ? stdev(xs) : null,
    min: xs.reduce((a, b) => (b < a ? b : a)), max: xs.reduce((a, b) => (b > a ? b : a)), q1: quantile(xs, 0.25), q3: quantile(xs, 0.75), ciLow: ci?.low ?? null, ciHigh: ci?.high ?? null,
  };
}

export interface PeriodPoint { key: number; label: string; value: number; change: number | null; growth: number | null; partial: boolean }

/** Period-over-period change. An unfinished last period is marked so it is not read as a decline. */
export function periodGrowth(en: Engine, value: ValueRef, date: string, part: DatePart, cs: Constraint[]): PeriodPoint[] {
  const field: FieldRef = { col: date, part };
  const keys = [...en.groupRows(cs, field).keys()].filter((k): k is number => typeof k === 'number').sort((a, b) => a - b);
  const partial = lastPeriodIncomplete(en.numbers(date, en.rows(cs)), part);
  let prev: number | null = null;
  return keys.map((key, i) => {
    const v = en.evaluate(value, [...cs, groupConstraint(field, key)]) ?? 0;
    const change = prev === null ? null : v - prev;
    const growth = prev ? (v - prev) / Math.abs(prev) : null;
    prev = v;
    return { key, label: bucketLabel(key, part), value: v, change, growth, partial: partial && i === keys.length - 1 };
  });
}

export interface Anomaly { label: string; value: number; expected: number; score: number; direction: 'spike' | 'drop' }

/** Flags periods far from their neighbors, using a robust score that a single spike cannot distort. */
export function detectAnomalies(points: { label: string; value: number }[], threshold = 3.5, window = 3): Anomaly[] {
  if (points.length < 7) return [];
  const expected = points.map((_, i) => median(points.filter((__, k) => k !== i && Math.abs(k - i) <= window).map((p) => p.value)));
  const residuals = points.map((p, i) => p.value - expected[i]);
  const center = median(residuals);
  const mad = median(residuals.map((r) => Math.abs(r - center)));
  const scale = mad > 0 ? mad / 0.6745 : mean(residuals.map((r) => Math.abs(r - center))) * 1.2533;
  if (!(scale > 0)) return [];
  return points.flatMap((p, i) => {
    const score = (residuals[i] - center) / scale;
    return Math.abs(score) > threshold ? [{ label: p.label, value: p.value, expected: expected[i], score, direction: score > 0 ? 'spike' as const : 'drop' as const }] : [];
  });
}

export interface SegmentRow { key: Cell; label: string; records: number; share: number; total: number | null; average: number | null; median: number | null }

export function segmentTable(en: Engine, field: FieldRef, metric: string | null, cs: Constraint[], label: (k: Cell) => string): SegmentRow[] {
  const all = en.rows(cs).length || 1;
  return [...en.groupRows(cs, field).entries()].map(([key, rows]) => {
    const xs = metric ? en.numbers(metric, rows) : [];
    return { key, label: label(key), records: rows.length, share: rows.length / all, total: xs.length ? sum(xs) : null, average: xs.length ? mean(xs) : null, median: xs.length ? median(xs) : null };
  }).sort((a, b) => b.records - a.records);
}

export interface ABResult { rateA: number; rateB: number; difference: number; lift: number | null; z: number; p: number; low: number; high: number; significant: boolean }

/** Two-proportion z-test with a pooled standard error, and a 95% range for the difference. */
export function abTest(successA: number, totalA: number, successB: number, totalB: number): ABResult | null {
  if (totalA < 1 || totalB < 1) return null;
  const [rateA, rateB] = [successA / totalA, successB / totalB];
  const pooled = (successA + successB) / (totalA + totalB);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / totalA + 1 / totalB));
  if (!(se > 0)) return null;
  const difference = rateB - rateA;
  const z = difference / se;
  const seDiff = Math.sqrt((rateA * (1 - rateA)) / totalA + (rateB * (1 - rateB)) / totalB);
  const p = normalTwoSided(z);
  return { rateA, rateB, difference, lift: rateA ? difference / rateA : null, z, p, low: difference - 1.959964 * seDiff, high: difference + 1.959964 * seDiff, significant: p < 0.05 };
}

export interface RegressionTerm { name: string; coefficient: number; stdError: number; t: number; p: number }
export interface RegressionResult { terms: RegressionTerm[]; n: number; r2: number; adjustedR2: number; f: number; fP: number; residualError: number }

function invert(m: number[][]): number[][] | null {
  const n = m.length;
  const a = m.map((r, i) => [...r, ...r.map((_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    if (Math.abs(a[pivot][c]) < 1e-10) return null;
    [a[c], a[pivot]] = [a[pivot], a[c]];
    const d = a[c][c];
    a[c] = a[c].map((v) => v / d);
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c];
      if (f) a[r] = a[r].map((v, j) => v - f * a[c][j]);
    }
  }
  return a.map((r) => r.slice(n));
}

/** Ordinary least squares with an intercept. Columns are scaled first so large numbers stay accurate. */
export function linearRegression(y: number[], xs: number[][], names: string[]): RegressionResult | null {
  const n = y.length;
  const k = xs.length;
  if (n <= k + 1 || k < 1) return null;
  const scales = xs.map((col) => Math.max(...col.map(Math.abs)) || 1);
  const design = y.map((_, i) => [1, ...xs.map((col, c) => col[i] / scales[c])]);
  const p = k + 1;
  const xtx = Array.from({ length: p }, (_, a) => Array.from({ length: p }, (__, b) => sum(design.map((r) => r[a] * r[b]))));
  const inv = invert(xtx);
  if (!inv) return null;
  const xty = Array.from({ length: p }, (_, a) => sum(design.map((r, i) => r[a] * y[i])));
  const beta = inv.map((r) => sum(r.map((v, j) => v * xty[j])));
  const fitted = design.map((r) => sum(r.map((v, j) => v * beta[j])));
  const sse = sum(y.map((v, i) => (v - fitted[i]) ** 2));
  const my = mean(y);
  const sst = sum(y.map((v) => (v - my) ** 2));
  if (!(sst > 0)) return null;
  const df = n - p;
  const s2 = sse / df;
  const unscale = [1, ...scales];
  const terms = beta.map((b, j) => {
    const coefficient = b / unscale[j];
    const stdError = Math.sqrt(s2 * inv[j][j]) / unscale[j];
    const t = stdError > 0 ? coefficient / stdError : 0;
    return { name: j === 0 ? 'Intercept' : names[j - 1], coefficient, stdError, t, p: stdError > 0 ? tTwoSided(t, df) : 0 };
  });
  const r2 = 1 - sse / sst;
  const f = ((sst - sse) / k) / s2;
  return { terms, n, r2, adjustedR2: 1 - ((1 - r2) * (n - 1)) / df, f, fP: fUpper(f, k, df), residualError: Math.sqrt(s2) };
}

/** Collects complete rows for a regression. */
export function regressionData(en: Engine, target: string, inputs: string[], cs: Constraint[]): { y: number[]; xs: number[][] } {
  const rows = en.rows(cs);
  const yc = en.column(target)?.values ?? [];
  const xc = inputs.map((n) => en.column(n)?.values ?? []);
  const y: number[] = [];
  const xs: number[][] = inputs.map(() => []);
  rows.forEach((r) => {
    const a = yc[r];
    const b = xc.map((c) => c[r]);
    if (typeof a !== 'number' || b.some((v) => typeof v !== 'number')) return;
    y.push(a);
    b.forEach((v, i) => xs[i].push(v as number));
  });
  return { y, xs };
}
