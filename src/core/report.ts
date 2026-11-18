// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { bucketLabel, defaultAgg, Engine, groupConstraint, lastPeriodIncomplete, shiftYears } from './engine';
import { boxStats, type BoxStats, forecast, type Forecast, histogram, type HistogramBin, pearson, linearFit } from './stats';
import type { AssistantMemory } from './assistant';
import { formatDate } from './format';
import type { Cell, Constraint, DatePart, FieldRef, Measure, NumberFormat, Parameter, Step, ValueRef } from './types';

export type VisualType =
  | 'kpi' | 'column' | 'bar' | 'stacked' | 'line' | 'area' | 'donut' | 'scatter' | 'heatmap'
  | 'histogram' | 'box' | 'pareto' | 'treemap' | 'variance' | 'table' | 'insights';

export interface Visual {
  id: string;
  type: VisualType;
  title: string;
  axis: FieldRef[];          // hierarchy levels, first is the top level
  values: ValueRef[];
  legend?: FieldRef;
  tooltips: ValueRef[];
  multiples?: FieldRef;
  topN?: number;
  forecast?: boolean;
  /** Current drill position */
  drillLevel?: number;
  drillPath?: { field: FieldRef; value: Cell; label: string }[];
}

export interface GridPos { i: string; x: number; y: number; w: number; h: number }
export interface Page { id: string; name: string; visuals: Visual[]; layout: GridPos[] }
export interface Hierarchy { name: string; levels: string[] }

export interface Selection { visualId: string; field: FieldRef; values: Cell[]; label: string }
export interface Slicer { col: string; part?: DatePart; values: Cell[] }
export interface Bookmark { name: string; pageId: string; slicers: Slicer[]; selection: Selection | null }

export interface ReportDoc {
  title: string;
  pages: Page[];
  measures: Measure[];
  hierarchies: Hierarchy[];
  parameters: Parameter[];
  bookmarks: Bookmark[];
  slicerFields: FieldRef[];
  recipe: Step[];
  /** What the report assistant has learned. It stays inside this report. */
  assistant?: AssistantMemory;
}

export const fieldLabel = (f: FieldRef) => (f.part ? `${f.col} (${f.part})` : f.col);

export function keyLabel(en: Engine, field: FieldRef, k: Cell): string {
  if (k === null) return '(Blank)';
  const c = en.column(field.col);
  if (c?.type === 'date' && typeof k === 'number') return field.part ? bucketLabel(k, field.part) : formatDate(k);
  if (typeof k === 'boolean') return k ? 'Yes' : 'No';
  if (typeof k === 'number') return k.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 6 });
  return String(k);
}

export const OTHER = '__other__';

export interface Category { key: Cell; label: string; isOther?: boolean }
export interface Series { name: string; key: Cell; value: ValueRef; data: (number | null)[]; }
export interface CategoryResult {
  field: FieldRef; categories: Category[]; series: Series[]; chronological: boolean;
  /** Overall value for each ValueRef in the same filter context, computed from rows not by adding groups. */
  totals: (number | null)[];
  truncated: number;
}

export const activeField = (v: Visual): FieldRef | undefined => v.axis[Math.min(v.drillLevel ?? 0, v.axis.length - 1)];

/** Filters a visual sees: page context plus its own drill path. */
export function visualConstraints(v: Visual, cs: Constraint[]): Constraint[] {
  return [...cs, ...(v.drillPath ?? []).map((d) => ({ col: d.field.col, kind: 'in' as const, part: d.field.part, values: [d.value] }))];
}

export function queryCategories(en: Engine, field: FieldRef, values: ValueRef[], cs: Constraint[], opts: { legend?: FieldRef; topN?: number } = {}): CategoryResult {
  const col = en.column(field.col);
  const chronological = col?.type === 'date' || col?.type === 'number';
  const groups = en.groupRows(cs, field);
  let keys = [...groups.keys()];
  const first = values[0];
  const metric = new Map<Cell, number>();
  if (first) keys.forEach((k) => metric.set(k, en.evaluate(first, [...cs, groupConstraint(field, k)]) ?? -Infinity));
  keys.sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    if (chronological) return (a as number) - (b as number);
    return (metric.get(b) ?? 0) - (metric.get(a) ?? 0) || String(a).localeCompare(String(b));
  });
  const limit = chronological ? 400 : opts.topN ?? 12;
  const truncated = Math.max(0, keys.length - limit);
  let categories: Category[];
  let otherCs: Constraint[] | null = null;
  if (truncated > 0 && !chronological) {
    const kept = keys.slice(0, limit - 1);
    otherCs = [...cs, { col: field.col, kind: 'notIn', part: field.part, values: kept, group: true }];
    categories = kept.map((k) => ({ key: k, label: keyLabel(en, field, k) }));
    categories.push({ key: OTHER, label: `Other (${keys.length - kept.length})`, isOther: true });
  } else {
    if (truncated > 0) keys = keys.slice(-limit);
    categories = keys.map((k) => ({ key: k, label: keyLabel(en, field, k) }));
  }
  const ctxOf = (c: Category) => (c.isOther ? otherCs! : [...cs, groupConstraint(field, c.key)]);

  let series: Series[];
  if (opts.legend && values[0]) {
    const lg = opts.legend;
    const lgGroups = [...en.groupRows(cs, lg).keys()];
    const lgCol = en.column(lg.col);
    const totals = new Map(lgGroups.map((k) => [k, en.evaluate(values[0], [...cs, groupConstraint(lg, k)]) ?? -Infinity]));
    lgGroups.sort((a, b) => (lgCol?.type === 'date' ? (a as number) - (b as number) : (totals.get(b)! - totals.get(a)!)));
    const kept = lgGroups.slice(0, lgGroups.length > 8 ? 7 : 8);
    series = kept.map((k) => ({
      name: keyLabel(en, lg, k), key: k, value: values[0],
      data: categories.map((c) => en.evaluate(values[0], [...ctxOf(c), groupConstraint(lg, k)])),
    }));
    if (lgGroups.length > 8) {
      const not: Constraint = { col: lg.col, kind: 'notIn', part: lg.part, values: kept, group: true };
      series.push({ name: `Other (${lgGroups.length - kept.length})`, key: OTHER, value: values[0], data: categories.map((c) => en.evaluate(values[0], [...ctxOf(c), not])) });
    }
  } else {
    series = values.map((v) => ({ name: en.valueLabel(v), key: en.valueLabel(v), value: v, data: categories.map((c) => en.evaluate(v, ctxOf(c))) }));
  }
  return { field, categories, series, chronological, totals: values.map((v) => en.evaluate(v, cs)), truncated };
}

export interface TooltipStats {
  label: string; value: number | null; count: number; share: number | null; varianceFromAvg: number | null;
  spark: number[]; extras: { label: string; value: number | null; format: NumberFormat; currency?: string }[];
}

/** Numbers behind the rich tooltip. Calculated on demand from the same filter context as the chart. */
export function tooltipStats(en: Engine, v: Visual, field: FieldRef, key: Cell, value: ValueRef, cs: Constraint[], siblings: (number | null)[]): TooltipStats {
  const ctx = [...cs, groupConstraint(field, key)];
  const val = en.evaluate(value, ctx);
  const whole = en.isAdditive(value) ? en.evaluate(value, cs) : null;
  const present = siblings.filter((x): x is number => x !== null);
  const avg = present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
  const date = en.firstDateColumn;
  let spark: number[] = [];
  if (date && date !== field.col) {
    const months = [...en.groupRows(ctx, { col: date, part: 'month' }).keys()].filter((k): k is number => typeof k === 'number').sort((a, b) => a - b).slice(-24);
    spark = months.map((m) => en.evaluate(value, [...ctx, groupConstraint({ col: date, part: 'month' }, m)]) ?? 0);
  }
  return {
    label: keyLabel(en, field, key), value: val, count: en.rows(ctx).length,
    share: whole && val !== null ? val / whole : null,
    varianceFromAvg: avg && val !== null ? (val - avg) / Math.abs(avg) : null,
    spark,
    extras: v.tooltips.map((t) => ({ label: en.valueLabel(t), value: en.evaluate(t, ctx), ...en.valueFormat(t) })),
  };
}

export interface KpiResult {
  value: number | null; previous: number | null; change: number | null; previousLabel: string | null;
  spark: number[]; format: NumberFormat; currency?: string; n: number;
}

/** KPI compared like for like: same dates in the prior year when available, else the prior month. */
export function queryKpi(en: Engine, value: ValueRef, cs: Constraint[]): KpiResult {
  const value0 = en.evaluate(value, cs);
  const fmt = en.valueFormat(value);
  const n = en.rows(cs).length;
  const date = en.firstDateColumn;
  const out: KpiResult = { value: value0, previous: null, change: null, previousLabel: null, spark: [], ...fmt, n };
  if (!date) return out;
  const field: FieldRef = { col: date, part: 'month' };
  const months = [...en.groupRows(cs, field).keys()].filter((k): k is number => typeof k === 'number').sort((a, b) => a - b);
  out.spark = months.slice(-24).map((m) => en.evaluate(value, [...cs, groupConstraint(field, m)]) ?? 0);
  const xs = en.numbers(date, en.rows(cs));
  if (!xs.length) return out;
  const lo = xs.reduce((a, b) => (b < a ? b : a));
  const hi = xs.reduce((a, b) => (b > a ? b : a));
  const base = cs.filter((c) => c.col !== date);
  const windowValue = (min: number, max: number) => {
    const ctx: Constraint[] = [...base, { col: date, kind: 'range', min, max }];
    const covered = en.numbers(date, en.rows(ctx));
    if (covered.length < 5) return null;
    // The earlier window must really be covered, otherwise the comparison is not like for like.
    const margin = 31 * 86400000;
    const first = covered.reduce((a, b) => (b < a ? b : a));
    const last = covered.reduce((a, b) => (b > a ? b : a));
    return first <= min + margin && last >= max - margin ? en.evaluate(value, ctx) : null;
  };
  const end = Math.floor(hi / 86400000) * 86400000 + 86400000; // midnight after the last date
  const oneYear = hi - lo <= 366 * 86400000;
  // Up to a year of data: compare the same dates last year. Longer: compare the latest 12 months with the 12 before.
  const curStart = oneYear ? lo : shiftYears(end, -1);
  const current = oneYear ? value0 : en.evaluate(value, [...base, { col: date, kind: 'range', min: curStart, max: end }]);
  const prev = windowValue(shiftYears(curStart, -1), shiftYears(end, -1));
  if (prev !== null && current !== null) {
    out.previous = prev;
    out.previousLabel = oneYear ? 'vs same period last year' : 'last 12 months vs prior 12';
    out.change = prev !== 0 ? (current - prev) / Math.abs(prev) : null;
  }
  return out;
}

export interface ScatterResult { x: ValueRef; y: ValueRef; points: { x: number; y: number; label: string; key: Cell }[]; r: number; p: number; fit: { slope: number; intercept: number } | null; xName: string; yName: string; }

export function queryScatter(en: Engine, v: Visual, cs: Constraint[]): ScatterResult | null {
  const [x, y] = v.values;
  if (!x || !y) return null;
  const field = activeField(v);
  const points: ScatterResult['points'] = [];
  if (field) {
    const r = queryCategories(en, field, [x, y], cs, { topN: 300 });
    r.categories.forEach((c, i) => {
      const [a, b] = [r.series[0].data[i], r.series[1].data[i]];
      if (a !== null && b !== null && !c.isOther) points.push({ x: a, y: b, label: c.label, key: c.key });
    });
  } else if (x.kind === 'col' && y.kind === 'col') {
    const rows = en.rows(cs);
    const [xs, ys] = [en.column(x.col)?.values ?? [], en.column(y.col)?.values ?? []];
    const step = Math.max(1, Math.floor(rows.length / 3000));
    for (let i = 0; i < rows.length; i += step) {
      const [a, b] = [xs[rows[i]], ys[rows[i]]];
      if (typeof a === 'number' && typeof b === 'number') points.push({ x: a, y: b, label: `Row ${en.table.rowIds[rows[i]] + 2}`, key: null });
    }
  }
  const px = points.map((p) => p.x);
  const py = points.map((p) => p.y);
  const c = pearson(px, py);
  const fit = points.length > 2 ? linearFit(px, py) : null;
  const name = (r: ValueRef) => (field ? en.valueLabel(r) : r.kind === 'col' ? r.col : r.name);
  return { x, y, points, r: c.r, p: c.p, fit, xName: name(x), yName: name(y) };
}

export interface HeatmapResult { xs: Category[]; ys: Category[]; cells: [number, number, number | null][]; min: number; max: number; value: ValueRef; xField: FieldRef; yField: FieldRef }

export function queryHeatmap(en: Engine, v: Visual, cs: Constraint[]): HeatmapResult | null {
  const x = activeField(v);
  const y = v.legend;
  const value = v.values[0];
  if (!x || !y || !value) return null;
  const xr = queryCategories(en, x, [value], cs, { topN: 16 });
  const yr = queryCategories(en, y, [value], cs, { topN: 12 });
  const xs = xr.categories.filter((c) => !c.isOther);
  const ys = yr.categories.filter((c) => !c.isOther);
  const cells: HeatmapResult['cells'] = [];
  let min = Infinity;
  let max = -Infinity;
  xs.forEach((a, i) => ys.forEach((b, j) => {
    const val = en.evaluate(value, [...cs, groupConstraint(x, a.key), groupConstraint(y, b.key)]);
    if (val !== null) { min = Math.min(min, val); max = Math.max(max, val); }
    cells.push([i, j, val]);
  }));
  return { xs, ys, cells, min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 1, value, xField: x, yField: y };
}

export interface HistogramResult { bins: HistogramBin[]; n: number; name: string; mean: number | null; median: number | null; }

export function queryHistogram(en: Engine, v: Visual, cs: Constraint[]): HistogramResult | null {
  const val = v.values[0];
  if (!val || val.kind !== 'col') return null;
  const xs = en.numbers(val.col, en.rows(cs));
  return { bins: histogram(xs), n: xs.length, name: val.col, mean: en.aggregate(en.rows(cs), val.col, 'avg'), median: en.aggregate(en.rows(cs), val.col, 'median') };
}

export interface BoxResult { categories: Category[]; stats: BoxStats[]; name: string; field?: FieldRef }

export function queryBox(en: Engine, v: Visual, cs: Constraint[]): BoxResult | null {
  const val = v.values[0];
  if (!val || val.kind !== 'col') return null;
  const field = activeField(v);
  if (!field) {
    const xs = en.numbers(val.col, en.rows(cs));
    return xs.length ? { categories: [{ key: 'All', label: 'All rows' }], stats: [boxStats(xs)], name: val.col } : null;
  }
  const r = queryCategories(en, field, [{ kind: 'col', col: val.col, agg: 'median' }], cs, { topN: 12 });
  const categories: Category[] = [];
  const stats: BoxStats[] = [];
  for (const c of r.categories) {
    if (c.isOther) continue;
    const xs = en.numbers(val.col, en.rows([...cs, groupConstraint(field, c.key)]));
    if (xs.length) { categories.push(c); stats.push(boxStats(xs)); }
  }
  return { categories, stats, name: val.col, field };
}

export interface VarianceResult { categories: Category[]; changes: (number | null)[]; current: (number | null)[]; previous: (number | null)[]; name: string; field: FieldRef; omitted: string | null }

/** Year-over-year % change for each period. Blank when the earlier period has no data. */
export function queryVariance(en: Engine, v: Visual, cs: Constraint[]): VarianceResult | null {
  const value = v.values[0];
  const field = activeField(v);
  if (!value || !field?.part) return null;
  const full = queryCategories(en, field, [value], cs);
  const partial = lastPeriodIncomplete(en.numbers(field.col, en.rows(cs)), field.part);
  const omitted = partial ? full.categories[full.categories.length - 1]?.label ?? null : null;
  const r = partial ? { ...full, categories: full.categories.slice(0, -1), series: full.series.map((s) => ({ ...s, data: s.data.slice(0, -1) })) } : full;
  const base = cs.filter((c) => c.col !== field.col);
  const previous = r.categories.map((c) => {
    if (typeof c.key !== 'number') return null;
    const d = new Date(c.key);
    const key = Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate());
    return en.rows([...base, groupConstraint(field, key)]).length ? en.evaluate(value, [...base, groupConstraint(field, key)]) : null;
  });
  const current = r.series[0].data;
  const changes = current.map((x, i) => { const p = previous[i]; return x === null || p === null || p === 0 ? null : (x - p) / Math.abs(p); });
  const first = changes.findIndex((c) => c !== null);
  const at = first < 0 ? 0 : first;
  return { categories: r.categories.slice(at), changes: changes.slice(at), current: current.slice(at), previous: previous.slice(at), name: en.valueLabel(value), field, omitted };
}

export function queryForecast(en: Engine, r: CategoryResult): { fc: Forecast; labels: string[] } | null {
  const part = r.field.part;
  if (!part || r.series.length !== 1) return null;
  const y = r.series[0].data.filter((v): v is number => v !== null);
  const season = part === 'month' ? 12 : part === 'quarter' ? 4 : 0;
  const horizon = part === 'month' ? 6 : part === 'quarter' ? 4 : part === 'year' ? 2 : 8;
  const fc = forecast(y, horizon, season);
  if (!fc) return null;
  const last = r.categories[r.categories.length - 1].key as number;
  const add = (n: number) => {
    const d = new Date(last);
    if (part === 'year') return Date.UTC(d.getUTCFullYear() + n, 0, 1);
    if (part === 'quarter') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3 * n, 1);
    if (part === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1);
    return last + (part === 'week' ? 7 : 1) * n * 86400000;
  };
  void en;
  return { fc, labels: fc.values.map((_, i) => bucketLabel(add(i + 1), part)) };
}

/** A tabular view of any visual: powers table view, Excel, Google Sheets, and CSV output. */
export interface VisualTable {
  title: string; headers: string[]; rows: (Cell)[][];
  formats: ({ format?: NumberFormat; currency?: string } | undefined)[];
  /** Columns that can be totalled with a live SUM formula. */
  additive: boolean[];
  overall?: (Cell)[];
}

export function visualTable(en: Engine, v: Visual, base: Constraint[]): VisualTable | null {
  const cs = visualConstraints(v, base);
  const empty = { title: v.title };
  const field = activeField(v);
  switch (v.type) {
    case 'insights': return null;
    case 'kpi': {
      const value = v.values[0];
      if (!value) return null;
      const k = queryKpi(en, value, cs);
      return { ...empty, headers: ['Measure', 'Value', 'Previous', 'Change'], rows: [[en.valueLabel(value), k.value, k.previous, k.change]],
        formats: [undefined, { format: k.format, currency: k.currency }, { format: k.format, currency: k.currency }, { format: 'percent' }], additive: [false, false, false, false] };
    }
    case 'scatter': {
      const s = queryScatter(en, v, cs);
      if (!s) return null;
      const f = [en.valueFormat(s.x), en.valueFormat(s.y)];
      return { ...empty, headers: ['Point', s.xName, s.yName], rows: s.points.map((p) => [p.label, p.x, p.y]), formats: [undefined, f[0], f[1]], additive: [false, false, false] };
    }
    case 'heatmap': {
      const h = queryHeatmap(en, v, cs);
      if (!h) return null;
      const f = en.valueFormat(h.value);
      const rows = h.ys.map((y, j) => [y.label, ...h.xs.map((_, i) => h.cells[i * h.ys.length + j][2])]);
      return { ...empty, headers: [h.yField.col, ...h.xs.map((x) => x.label)], rows, formats: [undefined, ...h.xs.map(() => f)], additive: [false, ...h.xs.map(() => false)] };
    }
    case 'histogram': {
      const h = queryHistogram(en, v, cs);
      if (!h) return null;
      return { ...empty, headers: [`${h.name} from`, `${h.name} to`, 'Rows'], rows: h.bins.map((b) => [b.start, b.end, b.count]), formats: [undefined, undefined, { format: 'integer' }], additive: [false, false, true] };
    }
    case 'box': {
      const b = queryBox(en, v, cs);
      if (!b) return null;
      return { ...empty, headers: [b.field?.col ?? 'Group', 'Minimum', 'Q1', 'Median', 'Q3', 'Maximum', 'Outliers'],
        rows: b.categories.map((c, i) => [c.label, b.stats[i].min, b.stats[i].q1, b.stats[i].median, b.stats[i].q3, b.stats[i].max, b.stats[i].outliers.length]),
        formats: [undefined, {}, {}, {}, {}, {}, { format: 'integer' }], additive: Array(7).fill(false) };
    }
    case 'variance': {
      const r = queryVariance(en, v, cs);
      if (!r) return null;
      const f = v.values[0] ? en.valueFormat(v.values[0]) : {};
      return { ...empty, headers: [r.field.col, 'Current', 'Previous year', 'Change %'], rows: r.categories.map((c, i) => [c.label, r.current[i], r.previous[i], r.changes[i]]),
        formats: [undefined, f, f, { format: 'percent' }], additive: [false, false, false, false] };
    }
    case 'table': {
      if (!field && !v.values.length) return null;
      if (!field) return null;
      const r = queryCategories(en, field, v.values, cs, { topN: 500 });
      return catTable(en, v, r);
    }
    default: {
      if (!field || !v.values.length) return null;
      const r = queryCategories(en, field, v.values, cs, { legend: v.legend, topN: v.topN });
      return catTable(en, v, r);
    }
  }
}

function catTable(en: Engine, v: Visual, r: CategoryResult): VisualTable {
  return {
    title: v.title,
    headers: [r.field.part ? `${r.field.col} (${r.field.part})` : r.field.col, ...r.series.map((s) => s.name)],
    rows: r.categories.map((c, i) => [c.label, ...r.series.map((s) => s.data[i])]),
    formats: [undefined, ...r.series.map((s) => en.valueFormat(s.value))],
    additive: [false, ...r.series.map((s) => en.isAdditive(s.value))],
    overall: !v.legend ? ['Overall', ...r.totals] : undefined,
  };
}

export const defaultValueFor = (en: Engine, col: string): ValueRef => {
  const c = en.column(col)!;
  return { kind: 'col', col, agg: defaultAgg(c) };
};
