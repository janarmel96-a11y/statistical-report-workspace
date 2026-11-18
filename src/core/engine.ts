// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { evaluateMeasure, parseMeasure, type Node } from './measures';
import { mean, median, stdev, sum } from './stats';
import type { Agg, Cell, Column, Constraint, DataTable, DatePart, FieldRef, Measure, NumberFormat, Parameter, ValueRef } from './types';

const DAY = 86400000;

export function bucketStart(ms: number, part: DatePart): number {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  switch (part) {
    case 'year': return Date.UTC(y, 0, 1);
    case 'quarter': return Date.UTC(y, Math.floor(d.getUTCMonth() / 3) * 3, 1);
    case 'month': return Date.UTC(y, d.getUTCMonth(), 1);
    case 'week': { const day = Math.floor(ms / DAY) * DAY; return day - ((d.getUTCDay() + 6) % 7) * DAY; }
    case 'day': return Math.floor(ms / DAY) * DAY;
  }
}

export function bucketAdd(start: number, part: DatePart, n: number): number {
  const d = new Date(start);
  const [y, m] = [d.getUTCFullYear(), d.getUTCMonth()];
  switch (part) {
    case 'year': return Date.UTC(y + n, m, 1);
    case 'quarter': return Date.UTC(y, m + 3 * n, 1);
    case 'month': return Date.UTC(y, m + n, 1);
    case 'week': return start + 7 * n * DAY;
    case 'day': return start + n * DAY;
  }
}

/** Same calendar date in another year. Feb 29 falls back to Feb 28. */
export function shiftYears(ms: number, n: number): number {
  const d = new Date(ms);
  const y = d.getUTCFullYear() + n;
  const last = new Date(Date.UTC(y, d.getUTCMonth() + 1, 0)).getUTCDate();
  return Date.UTC(y, d.getUTCMonth(), Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function bucketLabel(start: number, part: DatePart): string {
  const d = new Date(start);
  const y = d.getUTCFullYear();
  switch (part) {
    case 'year': return String(y);
    case 'quarter': return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${y}`;
    case 'month': return `${MONTHS[d.getUTCMonth()]} ${y}`;
    default: return d.toISOString().slice(0, 10);
  }
}

/** True when the final period holds noticeably less of its calendar than earlier periods did. */
export function lastPeriodIncomplete(dates: number[], part: DatePart): boolean {
  if (dates.length < 2) return false;
  const latest = new Map<number, number>();
  for (const d of dates) { const b = bucketStart(d, part); latest.set(b, Math.max(latest.get(b) ?? 0, d)); }
  const buckets = [...latest.keys()].sort((a, b) => a - b);
  if (buckets.length < 2) return false;
  const coverage = (b: number) => (latest.get(b)! - b) / (bucketAdd(b, part, 1) - b);
  const typical = median(buckets.slice(0, -1).map(coverage));
  return coverage(buckets[buckets.length - 1]) < typical * 0.85;
}

export const PART_ORDER: DatePart[] = ['day', 'week', 'month', 'quarter', 'year'];

function constraintKey(c: Constraint): string {
  if (c.kind === 'pred') return `${c.col}|p|${c.key}`;
  if (c.kind === 'range') return `${c.col}|r|${c.min}|${c.max}`;
  return `${c.col}|${c.kind}|${c.part ?? ''}|${JSON.stringify([...c.values].sort())}`;
}

export const contextKey = (cs: Constraint[]) => cs.map(constraintKey).sort().join('&');

export class Engine {
  readonly table: DataTable;
  private cols = new Map<string, Column>();
  private rowMemo = new Map<string, Uint32Array>();
  private evalMemo = new Map<string, Cell>();
  private keyCache = new Map<string, ArrayLike<Cell>>();
  private parsed = new Map<string, { node: Node; measure: Measure }>();
  private params = new Map<string, number>();
  readonly allRows: Uint32Array;

  constructor(table: DataTable, measures: Measure[] = [], params: Parameter[] = []) {
    this.table = table;
    table.columns.forEach((c) => this.cols.set(c.name, c));
    this.allRows = Uint32Array.from({ length: table.rowCount }, (_, i) => i);
    this.setMeasures(measures);
    this.setParams(params);
  }

  column(name: string) { return this.cols.get(name); }

  setMeasures(measures: Measure[]) {
    this.parsed.clear();
    this.evalMemo.clear();
    for (const m of measures) {
      try { this.parsed.set(m.name, { node: parseMeasure(m.expr), measure: m }); } catch { /* reported by the editor */ }
    }
  }

  setParams(params: Parameter[]) {
    this.params = new Map(params.map((p) => [p.name, p.value]));
    this.evalMemo.clear();
  }

  param(name: string) { return this.params.get(name) ?? null; }
  measure(name: string) { return this.parsed.get(name); }
  hasMeasure(name: string) { return this.parsed.has(name); }
  get firstDateColumn() { return this.table.columns.find((c) => c.type === 'date')?.name; }

  /** Value of a field for every row, with date parts resolved to bucket starts. */
  keys(field: FieldRef): ArrayLike<Cell> {
    const col = this.cols.get(field.col);
    if (!col) return [];
    if (!field.part || col.type !== 'date') return col.values;
    const k = `${field.col}|${field.part}`;
    let arr = this.keyCache.get(k);
    if (!arr) {
      arr = col.values.map((v) => (typeof v === 'number' ? bucketStart(v, field.part!) : null));
      this.keyCache.set(k, arr);
    }
    return arr;
  }

  private test(c: Constraint): (row: number) => boolean {
    if (c.kind === 'pred') return c.test;
    if (c.kind === 'range') {
      const vals = this.cols.get(c.col)?.values ?? [];
      return (i) => { const v = vals[i]; return typeof v === 'number' && v >= c.min && v < c.max; };
    }
    const keys = this.keys({ col: c.col, part: c.part });
    const set = new Set(c.values);
    return c.kind === 'in' ? (i) => set.has(keys[i]) : (i) => !set.has(keys[i]);
  }

  /** Rows matching every constraint. Results are memoized by prefix so filters stay fast. */
  rows(cs: Constraint[]): Uint32Array {
    if (!cs.length) return this.allRows;
    const sorted = [...cs].sort((a, b) => (constraintKey(a) < constraintKey(b) ? -1 : 1));
    const key = sorted.map(constraintKey).join('&');
    const hit = this.rowMemo.get(key);
    if (hit) return hit;
    const base = this.rows(sorted.slice(0, -1));
    const t = this.test(sorted[sorted.length - 1]);
    const out = new Uint32Array(base.length);
    let n = 0;
    for (let i = 0; i < base.length; i++) if (t(base[i])) out[n++] = base[i];
    const res = out.slice(0, n);
    if (this.rowMemo.size > 4000) this.rowMemo.clear();
    this.rowMemo.set(key, res);
    return res;
  }

  /** Splits the current rows by a field. */
  groupRows(cs: Constraint[], field: FieldRef): Map<Cell, Uint32Array> {
    const rows = this.rows(cs);
    const keys = this.keys(field);
    const lists = new Map<Cell, number[]>();
    for (let i = 0; i < rows.length; i++) {
      const k = keys[rows[i]];
      const l = lists.get(k);
      if (l) l.push(rows[i]); else lists.set(k, [rows[i]]);
    }
    const out = new Map<Cell, Uint32Array>();
    lists.forEach((l, k) => {
      const arr = Uint32Array.from(l);
      out.set(k, arr);
      const key = [...cs, groupConstraint(field, k)].sort((a, b) => (constraintKey(a) < constraintKey(b) ? -1 : 1)).map(constraintKey).join('&');
      this.rowMemo.set(key, arr);
    });
    return out;
  }

  numbers(col: string, rows: Uint32Array): number[] {
    const vals = this.cols.get(col)?.values ?? [];
    const out: number[] = [];
    for (let i = 0; i < rows.length; i++) { const v = vals[rows[i]]; if (typeof v === 'number') out.push(v); }
    return out;
  }

  aggregate(rows: Uint32Array, col: string, agg: Agg): number | null {
    if (agg === 'rows') return rows.length;
    const c = this.cols.get(col);
    if (!c) return null;
    if (agg === 'count') { let n = 0; for (let i = 0; i < rows.length; i++) if (c.values[rows[i]] !== null) n++; return n; }
    if (agg === 'distinct') { const s = new Set<Cell>(); for (let i = 0; i < rows.length; i++) { const v = c.values[rows[i]]; if (v !== null) s.add(v); } return s.size; }
    const xs = this.numbers(col, rows);
    if (!xs.length) return null;
    switch (agg) {
      case 'sum': return sum(xs);
      case 'avg': return mean(xs);
      case 'median': return median(xs);
      case 'min': return xs.reduce((a, b) => (b < a ? b : a));
      case 'max': return xs.reduce((a, b) => (b > a ? b : a));
      case 'stdev': return xs.length > 1 ? stdev(xs) : null;
    }
  }

  /** Evaluates a value in a filter context. */
  evaluate(v: ValueRef, cs: Constraint[]): number | null {
    const key = `${v.kind === 'col' ? `${v.col}:${v.agg}` : `m:${v.name}`}@${contextKey(cs)}`;
    if (this.evalMemo.has(key)) return this.evalMemo.get(key) as number | null;
    let out: Cell;
    if (v.kind === 'col') out = this.aggregate(this.rows(cs), v.col, v.agg);
    else {
      const m = this.parsed.get(v.name);
      out = m ? evaluateMeasure(m.node, this, cs, new Set([v.name])) : null;
    }
    const n = typeof out === 'number' && Number.isFinite(out) ? out : typeof out === 'boolean' ? (out ? 1 : 0) : null;
    if (this.evalMemo.size > 50000) this.evalMemo.clear();
    this.evalMemo.set(key, n);
    return n;
  }

  valueFormat(v: ValueRef): { format: NumberFormat; currency?: string } {
    if (v.kind === 'measure') return { format: this.parsed.get(v.name)?.measure.format ?? 'number' };
    if (['count', 'distinct', 'rows'].includes(v.agg)) return { format: 'integer' };
    const c = this.cols.get(v.col);
    const f = c?.format ?? 'number';
    return { format: f === 'integer' && ['avg', 'median', 'stdev'].includes(v.agg) ? 'number' : f, currency: c?.currency };
  }

  valueLabel(v: ValueRef): string {
    if (v.kind === 'measure') return v.name;
    if (v.agg === 'rows') return 'Records';
    const names: Record<Agg, string> = { sum: 'Total', avg: 'Average', median: 'Median', min: 'Minimum', max: 'Maximum', count: 'Count of', distinct: 'Distinct', stdev: 'Std dev of', rows: '' };
    return `${names[v.agg]} ${v.col}`;
  }

  /** True when values can be added across groups, so a grand total and % of total are meaningful. */
  isAdditive(v: ValueRef): boolean {
    return v.kind === 'col' && (v.agg === 'sum' || v.agg === 'count' || v.agg === 'rows');
  }
}

export function groupConstraint(field: FieldRef, value: Cell): Constraint {
  return { col: field.col, kind: 'in', part: field.part, values: [value], group: true };
}

/** Safe default aggregation: never sums IDs, rates, or averages. */
export function defaultAgg(c: Column): Agg {
  if (c.type !== 'number') return 'count';
  return c.role === 'measure' ? 'sum' : c.role === 'ratio' ? 'avg' : c.role === 'id' ? 'distinct' : 'count';
}

export function aggWarning(c: Column | undefined, agg: Agg): string | null {
  if (!c || agg !== 'sum') return null;
  if (c.role === 'id') return `${c.name} is an identifier. Adding IDs produces a meaningless number.`;
  if (c.role === 'ratio') return `${c.name} is a rate or average. Adding these overstates the result, so use Average.`;
  return null;
}

export const AGG_OPTIONS: { value: Agg; label: string; numeric: boolean }[] = [
  { value: 'sum', label: 'Sum', numeric: true },
  { value: 'avg', label: 'Average', numeric: true },
  { value: 'median', label: 'Median', numeric: true },
  { value: 'min', label: 'Minimum', numeric: true },
  { value: 'max', label: 'Maximum', numeric: true },
  { value: 'stdev', label: 'Std deviation', numeric: true },
  { value: 'count', label: 'Count', numeric: false },
  { value: 'distinct', label: 'Distinct count', numeric: false },
];
