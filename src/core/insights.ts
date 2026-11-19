// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { bucketAdd, bucketLabel, Engine, groupConstraint, lastPeriodIncomplete } from './engine';
import { formatNumber, formatPct } from './format';
import { AGE_NAME } from './parse';
import { fieldLabel, keyLabel, queryCategories, queryRange, type Page, type ReportDoc, type Visual, type GridPos } from './report';
import {
  benjaminiHochberg, histogram, iqrOutliers, kurtosis, mannKendall, mean, meanCI, median, modifiedZOutliers, pearson,
  quantile, skewness, spearman, stdev,
} from './stats';
import { detectRules } from './audit';
import type { Cell, Column, Constraint, DatePart, DataTable, FieldRef, ValueRef } from './types';

/* ---------- column profiling ---------- */

export interface ColumnProfile {
  name: string; type: string; role: string; count: number; missing: number; missingPct: number; distinct: number;
  mean?: number; median?: number; stdev?: number; min?: number; max?: number; q1?: number; q3?: number;
  skew?: number; kurt?: number; ciLow?: number; ciHigh?: number; outliersIqr?: number; outliersMad?: number;
  sum?: number; top?: { value: string; count: number }[]; hist?: number[]; firstDate?: number; lastDate?: number;
}

export function profileColumn(c: Column, rows: number): ColumnProfile {
  const present = c.values.filter((v) => v !== null);
  const p: ColumnProfile = {
    name: c.name, type: c.type, role: c.role, count: present.length, missing: rows - present.length,
    missingPct: rows ? (rows - present.length) / rows : 0, distinct: new Set(present).size,
  };
  if (c.type === 'number') {
    const xs = present as number[];
    if (xs.length) {
      const ci = meanCI(xs);
      Object.assign(p, {
        mean: mean(xs), median: median(xs), stdev: xs.length > 1 ? stdev(xs) : undefined,
        min: xs.reduce((a, b) => (b < a ? b : a)), max: xs.reduce((a, b) => (b > a ? b : a)),
        q1: quantile(xs, 0.25), q3: quantile(xs, 0.75), skew: skewness(xs), kurt: kurtosis(xs),
        ciLow: ci?.low, ciHigh: ci?.high, outliersIqr: iqrOutliers(xs).indices.length,
        outliersMad: modifiedZOutliers(xs).length, hist: histogram(xs, 16).map((b) => b.count),
        sum: c.role === 'measure' ? xs.reduce((a, b) => a + b, 0) : undefined,
      });
    }
  } else if (c.type === 'date') {
    const xs = present as number[];
    if (xs.length) { p.firstDate = xs.reduce((a, b) => (b < a ? b : a)); p.lastDate = xs.reduce((a, b) => (b > a ? b : a)); }
  } else {
    const counts = new Map<string, number>();
    present.forEach((v) => counts.set(String(v), (counts.get(String(v)) ?? 0) + 1));
    p.top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([value, count]) => ({ value, count }));
  }
  return p;
}

export const profileTable = (t: DataTable) => t.columns.map((c) => profileColumn(c, t.rowCount));

const relatedCache = new WeakMap<DataTable, Set<string>>();

/** Column pairs linked by arithmetic, such as Amount = Quantity x Price. Their correlation says nothing new. */
function relatedColumns(t: DataTable): Set<string> {
  let out = relatedCache.get(t);
  if (!out) {
    out = new Set();
    for (const r of detectRules(t, t.rowIds.map((_, i) => i))) {
      const cols = [r.target, ...r.inputs];
      for (const a of cols) for (const b of cols) if (a !== b) out.add(`${a}|${b}`);
    }
    relatedCache.set(t, out);
  }
  return out;
}

export interface CorrelationPair { a: string; b: string; r: number; rho: number; p: number; q: number; n: number }

/** Pearson and Spearman for every metric pair, with false-discovery-rate adjusted p-values. */
export function correlations(t: DataTable, rows?: Uint32Array): CorrelationPair[] {
  const cols = t.columns.filter((c) => c.type === 'number' && (c.role === 'measure' || c.role === 'ratio')).slice(0, 20);
  const idx = rows ?? Uint32Array.from({ length: t.rowCount }, (_, i) => i);
  const pairs: Omit<CorrelationPair, 'q'>[] = [];
  for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const r of idx) {
      const [a, b] = [cols[i].values[r], cols[j].values[r]];
      if (typeof a === 'number' && typeof b === 'number') { xs.push(a); ys.push(b); }
    }
    if (xs.length < 3) continue;
    const c = pearson(xs, ys);
    if (Number.isNaN(c.r)) continue;
    pairs.push({ a: cols[i].name, b: cols[j].name, r: c.r, rho: spearman(xs, ys).r, p: c.p, n: xs.length });
  }
  const qs = benjaminiHochberg(pairs.map((p) => p.p));
  return pairs.map((p, i) => ({ ...p, q: qs[i] }));
}

/* ---------- period helpers ---------- */

export function bestGrain(min: number, max: number, distinctDays: number): DatePart {
  const days = (max - min) / 86400000;
  if (days > 365 * 6) return 'year';
  if (days > 365 * 2.5) return 'quarter';
  if (days > 62) return 'month';
  if (days > 21 && distinctDays > 21) return 'week';
  return 'day';
}

/* ---------- narrative insights ---------- */

export interface Insight {
  id: string;
  kind: 'share' | 'change' | 'trend' | 'pareto' | 'correlation' | 'outlier' | 'seasonal' | 'simpson' | 'caution' | 'quality';
  headline: string;
  text: string;
  /** How the numbers were produced, shown in the audit view. */
  audit: { formula: string; n: number; periods?: string; filters: string; test?: string };
  priority: number;
}

export interface DimGroups { sex?: string; ageGroup?: string; age?: string; people: string[]; location: string[]; other: string[] }
export interface InsightPlan {
  metric?: ValueRef; date?: string; dims: string[];
  /** True for lists of people or cases, where the right statistic is how many records fall in each group. */
  caseMode: boolean;
  groups: DimGroups;
  highlights: string[];
}

const VALUE_NAME = /(sales|revenue|amount|income|profit|cost|expense|price|budget|balance|\bfee|salary|wage|quantity|\bqty\b|\bunits?\b|hours?|minutes?|volume|weight|spend|\bvalue|\btotal)/i;
/** Counts of mistakes, scores, and codes are not the value a report adds up, even when named "Total". */
const NOT_A_VALUE = /(error|flag|score|index|rank|\bcode\b|\bno\.?$|number$)/i;
const NOT_A_GROUP = /(source file|\bname\b|worker|\bstaff\b|encoder|remark|\bnotes?\b|comment|\bothers?\b|specify)/i;
const LOCATION_ORDER = [/\bcountry\b/i, /\bregion\b/i, /\bstate\b/i, /\bprovince\b/i, /(municipal|\bcity\b|\btown\b)/i, /(barangay|\bbrgy\b|district|village|suburb)/i];
const PEOPLE_NAME = /(patient status|civil status|marital|sector|education|occupation|employment status|religion|ethnic|nationality|classification|type of patient|patient type)/i;

function groupColumns(t: DataTable): DimGroups {
  const groups: DimGroups = { people: [], location: [], other: [] };
  groups.age = t.columns.find((c) => c.type === 'number' && AGE_NAME.test(c.name.trim()))?.name;
  for (const c of t.columns) {
    if ((c.type !== 'category' && c.type !== 'boolean') || c.role !== 'dimension' || NOT_A_GROUP.test(c.name)) continue;
    const filled = c.values.filter((v) => v !== null);
    const distinct = new Set(filled).size;
    if (filled.length < t.rowCount * 0.5 || distinct < 2) continue;
    const place = LOCATION_ORDER.findIndex((r) => r.test(c.name));
    if (/^(sex|gender)$/i.test(c.name.trim())) groups.sex ??= c.name;
    else if (c.order) groups.ageGroup = c.name;
    else if (place >= 0) groups.location.push(c.name);
    else if (distinct > 60) continue;
    else if (PEOPLE_NAME.test(c.name)) groups.people.push(c.name);
    else groups.other.push(c.name);
  }
  const rank = (n: string) => LOCATION_ORDER.findIndex((r) => r.test(n));
  groups.location.sort((a, b) => rank(a) - rank(b));
  return groups;
}

export function pickPlan(en: Engine): InsightPlan {
  const t = en.table;
  const score = (c: Column) => (/(revenue|sales|amount|total|net|income|profit|value|spend)/i.test(c.name) ? 2 : 0) + (c.values.some((v) => v !== null) ? 1 : 0);
  const measures = t.columns.filter((c) => c.type === 'number' && c.role === 'measure').sort((a, b) => score(b) - score(a));
  const ratios = t.columns.filter((c) => c.type === 'number' && c.role === 'ratio');
  const varied = (c: Column) => new Set(c.values.filter((v) => v !== null)).size > 1;
  const realMeasures = measures.filter(varied).filter((c) => c.values.filter((v) => v !== null).length >= t.rowCount * 0.5);
  const groups = groupColumns(t);
  const groupCount = [groups.sex, groups.ageGroup, ...groups.people, ...groups.location, ...groups.other].filter(Boolean).length;
  const caseMode = t.rowCount > 0 && (groupCount > 0 || realMeasures.length === 0) && (!realMeasures.length || (groupCount >= 6 && !realMeasures.some((c) => VALUE_NAME.test(c.name) && !NOT_A_VALUE.test(c.name))));
  const date = en.firstDateColumn;
  if (caseMode) {
    const dims = [groups.sex, groups.ageGroup, ...groups.people, ...groups.location, ...groups.other].filter((x): x is string => Boolean(x));
    const town = groups.location.find((n) => /(municipal|\bcity\b|\btown\b)/i.test(n)) ?? groups.location[0];
    const highlights = [groups.sex, groups.ageGroup, town, groups.people[0]].filter((x): x is string => Boolean(x));
    return { metric: { kind: 'col', col: t.columns[0]?.name ?? '', agg: 'rows' }, date, dims, caseMode, groups, highlights };
  }
  const metric: ValueRef | undefined = realMeasures[0] ? { kind: 'col', col: realMeasures[0].name, agg: 'sum' }
    : ratios.filter(varied)[0] ? { kind: 'col', col: ratios.filter(varied)[0].name, agg: 'avg' } : undefined;
  const dims = t.columns.filter((c) => (c.type === 'category' || c.type === 'boolean') && c.role === 'dimension' && !NOT_A_GROUP.test(c.name))
    .map((c) => ({ c, d: new Set(c.values.filter((v) => v !== null)).size }))
    .filter((x) => x.d >= 2 && x.d <= 200)
    .sort((a, b) => (a.d > 30 ? 1 : 0) - (b.d > 30 ? 1 : 0) || a.d - b.d).map((x) => x.c.name);
  return { metric, date, dims, caseMode, groups, highlights: dims };
}

export function periodFor(en: Engine, date: string, cs: Constraint[]): DatePart {
  const xs = en.numbers(date, en.rows(cs));
  if (!xs.length) return 'month';
  const days = new Set(xs.map((d) => Math.floor(d / 86400000))).size;
  return bestGrain(xs.reduce((a, b) => (b < a ? b : a)), xs.reduce((a, b) => (b > a ? b : a)), days);
}

/** Every insight is computed from the filtered data and only appears when its checks pass. */
export function generateInsights(en: Engine, cs: Constraint[], filterText = 'None'): Insight[] {
  const out: Insight[] = [];
  const plan = pickPlan(en);
  const { metric, date } = plan;
  const dims = plan.highlights;
  const rows = en.rows(cs);
  if (!metric || rows.length < 3) return out;
  const fmt = en.valueFormat(metric);
  const f = (v: number | null) => formatNumber(v, { ...fmt, compact: true });
  const counting = metric.kind === 'col' && metric.agg === 'rows';
  const mName = counting ? 'records' : metric.kind === 'col' ? metric.col : metric.name;
  const MName = mName[0].toUpperCase() + mName.slice(1);
  const additive = en.isAdditive(metric);
  const total = en.evaluate(metric, cs);
  const n = rows.length;
  const add = (i: Omit<Insight, 'id' | 'audit'> & { audit: Omit<Insight['audit'], 'filters'> }) =>
    out.push({ ...i, id: `${i.kind}-${out.length}`, audit: { ...i.audit, filters: filterText } });

  /* Period comparison, on complete periods only */
  let curr: number | null = null;
  let prevKey: number | null = null;
  let part: DatePart = 'month';
  if (date) {
    part = periodFor(en, date, cs);
    if (part === 'year') part = 'quarter';
    const field: FieldRef = { col: date, part };
    const dates = en.numbers(date, rows);
    const keys = [...en.groupRows(cs, field).keys()].filter((k): k is number => typeof k === 'number').sort((a, b) => a - b);
    const incomplete = lastPeriodIncomplete(dates, part);
    const usable = incomplete ? keys.slice(0, -1) : keys;
    if (incomplete && keys.length) {
      add({
        kind: 'caution', priority: 40, headline: `${bucketLabel(keys[keys.length - 1], part)} is incomplete`,
        text: `The latest ${part} has only partial data, so it is left out of period comparisons to avoid showing a false decline.`,
        audit: { formula: 'Latest date in the period compared with earlier periods', n: dates.length },
      });
    }
    if (usable.length >= 2) {
      curr = usable[usable.length - 1];
      prevKey = usable[usable.length - 2];
      if (prevKey === bucketAdd(curr, part, -1) && part !== 'day') {
        const [a, b] = [en.evaluate(metric, [...cs, groupConstraint(field, curr)]), en.evaluate(metric, [...cs, groupConstraint(field, prevKey)])];
        const na = en.rows([...cs, groupConstraint(field, curr)]).length;
        const nb = en.rows([...cs, groupConstraint(field, prevKey)]).length;
        if (a !== null && b !== null && b !== 0 && Math.min(na, nb) >= 5) {
          const ch = (a - b) / Math.abs(b);
          add({
            kind: 'change', priority: 90, headline: `${MName} ${ch >= 0 ? 'rose' : 'fell'} ${formatPct(Math.abs(ch))}`,
            text: `${MName} ${counting ? 'were' : 'was'} ${f(a)} in ${bucketLabel(curr, part)}, ${ch >= 0 ? 'up' : 'down'} ${formatPct(Math.abs(ch))} from ${f(b)} in ${bucketLabel(prevKey, part)}.`,
            audit: { formula: `(${f(a)} − ${f(b)}) ÷ |${f(b)}|`, n: na + nb, periods: `${bucketLabel(prevKey, part)} → ${bucketLabel(curr, part)}` },
          });
        }
      }
    }
    /* Trend test */
    if (usable.length >= 8) {
      const ys = usable.map((k) => en.evaluate(metric, [...cs, groupConstraint(field, k)]) ?? 0);
      const mk = mannKendall(ys);
      if (mk.trend !== 'none') {
        add({
          kind: 'trend', priority: 70, headline: `${MName} show${counting ? '' : 's'} a steady ${mk.trend === 'up' ? 'upward' : 'downward'} trend`,
          text: `Across ${usable.length} ${part}s the movement is ${mk.trend === 'up' ? 'upward' : 'downward'} and statistically significant (p ${mk.p < 0.001 ? '< 0.001' : `= ${mk.p.toFixed(3)}`}).`,
          audit: { formula: 'Mann-Kendall trend test', n: usable.length, periods: `${bucketLabel(usable[0], part)} → ${bucketLabel(usable[usable.length - 1], part)}`, test: `τ = ${mk.tau.toFixed(3)}, z = ${mk.z.toFixed(2)}` },
        });
      }
    }
    /* Seasonality needs at least two full years */
    const monthKeys = [...en.groupRows(cs, { col: date, part: 'month' }).keys()].filter((k): k is number => typeof k === 'number');
    if (monthKeys.length >= 24 && additive) {
      const byMonth: number[][] = Array.from({ length: 12 }, () => []);
      monthKeys.forEach((k) => byMonth[new Date(k).getUTCMonth()].push(en.evaluate(metric, [...cs, groupConstraint({ col: date, part: 'month' }, k)]) ?? 0));
      const avgs = byMonth.map((x) => (x.length ? mean(x) : NaN));
      const overall = mean(avgs.filter((x) => !Number.isNaN(x)));
      const top = avgs.indexOf(Math.max(...avgs.filter((x) => !Number.isNaN(x))));
      const lift = (avgs[top] - overall) / Math.abs(overall);
      if (lift > 0.15) {
        const name = new Date(Date.UTC(2000, top, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
        add({
          kind: 'seasonal', priority: 45, headline: `${name} is the seasonal peak`,
          text: `${name} averages ${formatPct(lift)} above a typical month for ${mName}.`,
          audit: { formula: 'Average for the month ÷ average of all months − 1', n: monthKeys.length, periods: `${monthKeys.length} months` },
        });
      }
    }
  }

  /* Share of total with its change between the same two periods */
  if (additive && total && total > 0) {
    for (const dim of dims.slice(0, plan.caseMode ? 4 : 2)) {
      const field: FieldRef = { col: dim };
      const label = (k: Cell) => keyLabel(en, field, k);
      const groups = [...en.groupRows(cs, field).keys()].filter((k) => k !== null);
      if (groups.length < 2) continue;
      const vals = groups.map((k) => ({ k, v: en.evaluate(metric, [...cs, groupConstraint(field, k)]) ?? 0 })).sort((a, b) => b.v - a.v);
      const top = vals[0];
      if (top.v <= 0 || vals.some((x) => x.v < 0)) continue;
      const share = top.v / total;
      let tail = '.';
      let periods: string | undefined;
      if (date && curr !== null && prevKey !== null && part !== 'day') {
        const pf: FieldRef = { col: date, part };
        const [a, b] = [en.evaluate(metric, [...cs, groupConstraint(field, top.k), groupConstraint(pf, curr)]), en.evaluate(metric, [...cs, groupConstraint(field, top.k), groupConstraint(pf, prevKey)])];
        if (a !== null && b && en.rows([...cs, groupConstraint(field, top.k), groupConstraint(pf, curr)]).length >= 5) {
          const ch = (a - b) / Math.abs(b);
          tail = `, ${ch >= 0 ? 'up' : 'down'} ${formatPct(Math.abs(ch))} from ${bucketLabel(prevKey, part)} to ${bucketLabel(curr, part)}.`;
          periods = `${bucketLabel(prevKey, part)} → ${bucketLabel(curr, part)}`;
        }
      }
      add({
        kind: 'share', priority: 85 - out.length, headline: `${label(top.k)} leads ${dim}`,
        text: `${label(top.k)} accounts for ${formatPct(share)} of ${counting ? 'all records' : `total ${mName}`}${tail}`,
        audit: { formula: `${f(top.v)} ÷ ${f(total)}`, n: en.rows([...cs, groupConstraint(field, top.k)]).length, periods },
      });
      if (groups.length >= 5) {
        const k = Math.max(1, Math.ceil(groups.length * 0.2));
        const cum = vals.slice(0, k).reduce((s, x) => s + x.v, 0) / total;
        if (cum >= 0.5) {
          add({
            kind: 'pareto', priority: 55, headline: `Top ${k} of ${groups.length} ${dim} values drive ${formatPct(cum, 0)}`,
            text: `${vals.slice(0, Math.min(k, 3)).map((x) => label(x.k)).join(', ')} contribute${k === 1 ? 's' : ''} ${formatPct(cum)} of ${mName}.`,
            audit: { formula: `Sum of top ${k} ÷ total`, n },
          });
        }
      }
    }
  }

  /* Correlation, adjusted for testing many pairs */
  if (n >= 30) {
    const related = relatedColumns(en.table);
    const used = new Set<string>();
    const strong = correlations(en.table, rows).filter((c) => c.q < 0.05 && Math.abs(c.r) >= 0.5 && Math.abs(c.r) < 0.995 && !related.has(`${c.a}|${c.b}`))
      .sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
      .filter((c) => { if (used.has(c.a) || used.has(c.b)) return false; used.add(c.a); used.add(c.b); return true; }).slice(0, 2);
    for (const c of strong) {
      add({
        kind: 'correlation', priority: 50, headline: `${c.a} and ${c.b} move ${c.r > 0 ? 'together' : 'in opposite directions'}`,
        text: `${c.a} and ${c.b} have a correlation of ${c.r.toFixed(2)} across ${c.n.toLocaleString()} rows. This shows association, not proof that one causes the other.`,
        audit: { formula: 'Pearson r, with Benjamini-Hochberg adjustment', n: c.n, test: `r = ${c.r.toFixed(3)}, Spearman ρ = ${c.rho.toFixed(3)}, adjusted p ${c.q < 0.001 ? '< 0.001' : `= ${c.q.toFixed(3)}`}` },
      });
    }
  }

  /* Outliers */
  if (plan.groups.age && plan.caseMode) {
    const range = queryRange(en, plan.groups.age, cs);
    if (range && range.n >= 10) {
      add({
        kind: 'share', priority: 72, headline: `Ages range from ${range.label} years`,
        text: `Valid ages run from ${range.label} years across ${range.n.toLocaleString('en-US')} records.${range.common ? ` The most common age group is ${range.common.label}, at ${(range.common.share * 100).toFixed(1)}% of records.` : ''}`,
        audit: { formula: 'Lowest and highest valid age, from 0 to 120', n: range.n },
      });
    }
  }

  if (metric.kind === 'col' && !counting) {
    const xs = en.numbers(metric.col, rows);
    if (xs.length >= 20) {
      const o = iqrOutliers(xs);
      const pct = o.indices.length / xs.length;
      if (o.indices.length && pct <= 0.1) {
        add({
          kind: 'outlier', priority: 35, headline: `${o.indices.length.toLocaleString()} unusual ${mName} value${o.indices.length > 1 ? 's' : ''}`,
          text: `${formatPct(pct)} of rows fall outside the expected range of ${f(o.low)} to ${f(o.high)}.`,
          audit: { formula: 'Q1 − 1.5 × IQR and Q3 + 1.5 × IQR', n: xs.length },
        });
      }
    }
  }

  /* Simpson's paradox: the overall direction reverses inside every subgroup */
  if (date && additive && curr !== null && prevKey !== null) {
    const pf: FieldRef = { col: date, part };
    for (const dim of dims.slice(0, 3)) {
      const field: FieldRef = { col: dim };
      const rate = (k: number, extra: Constraint[] = []) => {
        const c = [...cs, ...extra, groupConstraint(pf, k)];
        const count = en.rows(c).length;
        return count >= 5 ? (en.evaluate(metric, c) ?? 0) / count : null;
      };
      const [oa, ob] = [rate(curr), rate(prevKey)];
      if (oa === null || ob === null || oa === ob) continue;
      const groups = [...en.groupRows(cs, field).keys()].filter((k) => k !== null).slice(0, 12);
      const signs = groups.map((g) => {
        const e = [groupConstraint(field, g)];
        const [a, b] = [rate(curr!, e), rate(prevKey!, e)];
        return a === null || b === null || a === b ? 0 : Math.sign(a - b);
      }).filter(Boolean);
      if (signs.length >= 2 && signs.every((s) => s === -Math.sign(oa - ob))) {
        add({
          kind: 'simpson', priority: 80, headline: `The overall ${mName} per record trend hides a reversal`,
          text: `Overall it ${oa > ob ? 'rose' : 'fell'}, but it ${oa > ob ? 'fell' : 'rose'} inside every ${dim} group. A change in mix is driving the headline number.`,
          audit: { formula: `${mName} ÷ records, overall and within each ${dim}`, n, periods: `${bucketLabel(prevKey, part)} → ${bucketLabel(curr, part)}`, test: "Simpson's paradox check" },
        });
        break;
      }
    }
  }

  if (n < 30) {
    add({
      kind: 'caution', priority: 95, headline: 'Small sample',
      text: `Only ${n} rows match the current filters, so percentages can swing widely.`,
      audit: { formula: 'Row count under 30', n },
    });
  }
  return out.sort((a, b) => b.priority - a.priority);
}

/* ---------- dashboard recommendation ---------- */

let vid = 0;
export const newId = (p = 'v') => `${p}${Date.now().toString(36)}${(vid++).toString(36)}`;

const mk = (type: Visual['type'], title: string, axis: FieldRef[], values: ValueRef[], extra: Partial<Visual> = {}): Visual => ({
  id: newId(), type, title, axis, values, tooltips: [], ...extra,
});

export interface Template { id: string; name: string; description: string; reason: string; build: () => Page; }

function pack(visuals: { v: Visual; w: number; h: number }[]): { visuals: Visual[]; layout: GridPos[] } {
  const layout: GridPos[] = [];
  let x = 0;
  let y = 0;
  let row = 0;
  for (const { v, w, h } of visuals) {
    if (x + w > 12) { x = 0; y += row; row = 0; }
    layout.push({ i: v.id, x, y, w, h });
    x += w;
    row = Math.max(row, h);
  }
  return { visuals: visuals.map((a) => a.v), layout };
}

const dateAxis = (date: string): FieldRef[] => (['year', 'quarter', 'month', 'day'] as DatePart[]).map((part) => ({ col: date, part }));

const shortName = (s: string) => { const c = s.replace(/^[^\p{L}\p{N}]+/u, '').replace(/^\d+\.\s*/, '').replace(/\s+/g, ' ').trim(); return c.length > 46 ? `${c.slice(0, 45).trimEnd()}…` : c; };

/** Reports for lists of people or cases: how many records fall in each group. */
function recordTemplates(en: Engine, plan: InsightPlan): Template[] {
  const count = plan.metric!;
  const { date, groups } = plan;
  type Item = { v: Visual; w: number; h: number };
  const chart = (dim: string, w = 6): Item => {
    const col = en.column(dim)!;
    const distinct = new Set(col.values.filter((v) => v !== null)).size;
    const place = groups.location.includes(dim);
    const type: Visual['type'] = col.order ? 'column' : distinct <= 5 && !place ? 'donut' : 'bar';
    const ranked = type === 'bar' && distinct > 10;
    return { v: mk(type, `${ranked ? 'Top 10 by' : 'Records by'} ${shortName(dim)}`, [{ col: dim }], [count], type === 'bar' ? { topN: 11, hideOther: true } : {}), w, h: 8 };
  };
  const part = date ? periodFor(en, date, []) : 'month';
  const level = Math.max(0, ['year', 'quarter', 'month', 'day'].indexOf(part === 'week' ? 'day' : part));
  const kpis = (): Item[] => {
    const list: Visual[] = [mk('kpi', 'Total records', [], [count])];
    if (groups.sex) {
      const sex = groups.sex;
      queryCategories(en, { col: sex }, [count], [], { topN: 8 }).categories.filter((c) => c.key !== null && !c.isOther).slice(0, 2)
        .forEach((c) => list.push(mk('kpi', c.label, [], [count], { drillPath: [{ field: { col: sex }, value: c.key, label: c.label }] })));
    }
    if (groups.age) list.push(mk('kpi', 'Age range (years)', [], [{ kind: 'col', col: groups.age, agg: 'avg' }], { range: true }));
    return list.slice(0, 4).map((v, _, all) => ({ v, w: Math.floor(12 / all.length), h: 4 }));
  };
  const town = plan.highlights.find((d) => groups.location.includes(d));
  const out: Template[] = [{
    id: 'overview', name: 'Executive overview', description: 'Total records, sex, age, location, and written findings.', reason: 'This file lists individual records',
    build: () => {
      const items: Item[] = kpis();
      if (date) items.push({ v: mk('line', 'Records over time', dateAxis(date), [count], { drillLevel: level }), w: 8, h: 8 });
      items.push({ v: mk('insights', 'Key findings', [], []), w: 4, h: 16 });
      [groups.sex, groups.ageGroup, town, groups.people[0]].filter((d): d is string => Boolean(d)).forEach((d) => items.push(chart(d, 4)));
      return { id: newId('p'), name: 'Overview', ...pack(items) };
    },
  }];
  if (groups.sex || groups.ageGroup || groups.people.length) {
    out.push({
      id: 'demographics', name: 'Demographics', description: 'Sex, age groups, and other characteristics.', reason: 'Sex, age, or personal characteristics were found',
      build: () => {
        const items: Item[] = [];
        if (groups.sex) items.push(chart(groups.sex));
        if (groups.ageGroup) items.push(chart(groups.ageGroup));
        if (groups.sex && groups.ageGroup) items.push({ v: mk('stacked', 'Age group by sex', [{ col: groups.ageGroup }], [count], { legend: { col: groups.sex } }), w: 6, h: 8 });
        if (groups.age) items.push({ v: mk('histogram', 'Age distribution', [], [{ kind: 'col', col: groups.age, agg: 'avg' }]), w: 6, h: 8 });
        groups.people.slice(0, 6).forEach((d) => items.push(chart(d)));
        return { id: newId('p'), name: 'Demographics', ...pack(items) };
      },
    });
  }
  if (groups.location.length) {
    out.push({
      id: 'location', name: 'Location', description: 'Where records come from, at every address level.', reason: 'Address fields were found',
      build: () => {
        const items: Item[] = groups.location.slice(0, 4).map((d) => ({ ...chart(d), h: 9 }));
        if (town && groups.sex) items.push({ v: mk('stacked', `Sex by ${shortName(town)}`, [{ col: town }], [count], { legend: { col: groups.sex }, topN: 8 }), w: 12, h: 9 });
        return { id: newId('p'), name: 'Location', ...pack(items) };
      },
    });
  }
  if (groups.other.length) {
    out.push({
      id: 'services', name: 'Categories', description: 'Counts for the other categories in this file.', reason: `${groups.other.length} more categories were found`,
      build: () => ({ id: newId('p'), name: 'Categories', ...pack(groups.other.slice(0, 10).map((d) => chart(d))) }),
    });
  }
  return out;
}

export function recommendTemplates(en: Engine): Template[] {
  const plan = pickPlan(en);
  if (plan.caseMode) return recordTemplates(en, plan);
  const { metric, date, dims } = plan;
  const t = en.table;
  const measures = t.columns.filter((c) => c.type === 'number' && (c.role === 'measure' || c.role === 'ratio'));
  const out: Template[] = [];
  const count: ValueRef = { kind: 'col', col: t.columns[0]?.name ?? '', agg: 'rows' };
  const main = metric ?? count;
  const mName = metric ? (metric.kind === 'col' ? metric.col : metric.name) : 'Records';
  const level = date ? Math.max(0, ['year', 'quarter', 'month', 'day'].indexOf(periodFor(en, date, []) === 'week' ? 'day' : periodFor(en, date, []))) : 0;

  const kpis = (): { v: Visual; w: number; h: number }[] => {
    const list: ValueRef[] = [main];
    measures.filter((c) => !(metric?.kind === 'col' && c.name === metric.col)).slice(0, 2)
      .forEach((c) => list.push({ kind: 'col', col: c.name, agg: c.role === 'ratio' ? 'avg' : 'sum' }));
    if (metric) list.push(count);
    const w = Math.floor(12 / list.length);
    return list.slice(0, 4).map((value) => ({ v: mk('kpi', en.valueLabel(value), [], [value]), w, h: 4 }));
  };

  out.push({
    id: 'overview', name: 'Executive overview', description: 'KPIs, trend, top categories, and written findings on one page.',
    reason: date && metric ? `Found ${date} and ${mName}` : `Found ${t.columns.length} fields`,
    build: () => {
      const items = kpis();
      if (date) items.push({ v: mk('line', `${mName} over time`, dateAxis(date), [main], { drillLevel: level, forecast: false }), w: 8, h: 8 });
      else if (dims[0]) items.push({ v: mk('bar', `${mName} by ${dims[0]}`, [{ col: dims[0] }], [main]), w: 8, h: 8 });
      items.push({ v: mk('insights', 'Key findings', [], []), w: 4, h: dims[0] ? 16 : 8 });
      if (date && dims[0]) items.push({ v: mk('bar', `${mName} by ${dims[0]}`, [{ col: dims[0] }], [main]), w: dims[1] ? 4 : 8, h: 8 });
      if (dims[1]) {
        const d = new Set(en.column(dims[1])!.values).size;
        items.push({ v: mk(d <= 6 ? 'donut' : 'bar', `${mName} by ${dims[1]}`, [{ col: dims[1] }], [main]), w: date && dims[0] ? 4 : 8, h: 8 });
      }
      return { id: newId('p'), name: 'Overview', ...pack(items) };
    },
  });

  if (date && metric) {
    out.push({
      id: 'trend', name: 'Trend analysis', description: 'Line chart, year-over-year variance, and a split by category.',
      reason: `${date} and ${mName} support time comparison`,
      build: () => {
        const items = [
          { v: mk('line', `${mName} over time`, dateAxis(date), [main], { drillLevel: level }), w: 12, h: 8 },
          { v: mk('variance', 'Year-over-year change', dateAxis(date), [main], { drillLevel: Math.min(level, 2) }), w: dims[0] ? 6 : 12, h: 7 },
        ];
        if (dims[0]) items.push({ v: mk('area', `${mName} by ${dims[0]}`, dateAxis(date), [main], { legend: { col: dims[0] }, drillLevel: Math.min(level, 2) }), w: 6, h: 7 });
        return { id: newId('p'), name: 'Trend', ...pack(items) };
      },
    });
  }
  // Ranking charts work best on the field with the most groups that can still be read.
  const ranked = [...dims].sort((a, b) => {
    const count = (n: string) => new Set(en.column(n)!.values).size;
    return (count(a) > 20 ? 1 : 0) - (count(b) > 20 ? 1 : 0) || count(b) - count(a);
  });
  if (dims[0] && metric) {
    out.push({
      id: 'breakdown', name: 'Category breakdown', description: 'Pareto ranking, treemap, and a heatmap across two dimensions.',
      reason: `${dims.length} categorical field${dims.length > 1 ? 's' : ''} found`,
      build: () => {
        const items: { v: Visual; w: number; h: number }[] = [
          { v: mk('pareto', `Pareto of ${mName} by ${ranked[0]}`, [{ col: ranked[0] }], [main]), w: 7, h: 8 },
          { v: mk('treemap', `${mName} share by ${ranked[0]}`, [{ col: ranked[0] }], [main]), w: 5, h: 8 },
        ];
        if (dims[1]) items.push({ v: mk('heatmap', `${mName}: ${ranked[0]} × ${ranked[1]}`, [{ col: ranked[0] }], [main], { legend: { col: ranked[1] } }), w: 7, h: 8 });
        items.push({ v: mk('table', `${mName} detail`, [{ col: dims[1] ?? dims[0] }], [main, count]), w: dims[1] ? 5 : 12, h: 8 });
        return { id: newId('p'), name: 'Breakdown', ...pack(items) };
      },
    });
  }
  if (measures.length) {
    const m0 = (metric?.kind === 'col' && measures.find((c) => c.name === metric.col)) || measures[0];
    // Compare the strongest pair of continuous metrics. Identical copies of a number are not useful.
    const continuous = (n: string) => new Set(en.column(n)!.values).size > 12;
    const related = relatedColumns(t);
    const pair = correlations(t).filter((c) => continuous(c.a) && continuous(c.b) && !related.has(`${c.a}|${c.b}`) && Math.abs(c.r) < 0.995).sort((a, b) => Math.abs(b.r) - Math.abs(a.r))[0];
    const [px, py] = pair ? [pair.a, pair.b] : measures[1] ? [measures[0].name, measures[1].name] : [null, null];
    out.push({
      id: 'distribution', name: 'Distribution and relationships', description: 'Histogram, box plot, and scatter chart with a trend line.',
      reason: measures.length > 1 ? `${measures.length} numeric metrics can be compared` : `${m0.name} has a measurable spread`,
      build: () => {
        const items: { v: Visual; w: number; h: number }[] = [
          { v: mk('histogram', `Distribution of ${m0.name}`, [], [{ kind: 'col', col: m0.name, agg: 'sum' }]), w: 6, h: 8 },
          { v: mk('box', `${m0.name} spread${dims[0] ? ` by ${dims[0]}` : ''}`, dims[0] ? [{ col: dims[0] }] : [], [{ kind: 'col', col: m0.name, agg: 'sum' }]), w: 6, h: 8 },
        ];
        if (px && py) items.push({ v: mk('scatter', `${px} vs ${py}`, [], [{ kind: 'col', col: px, agg: 'sum' }, { kind: 'col', col: py, agg: 'sum' }]), w: 12, h: 8 });
        return { id: newId('p'), name: 'Distribution', ...pack(items) };
      },
    });
  }
  return out;
}

export function newReport(en: Engine, title: string): ReportDoc {
  const templates = recommendTemplates(en);
  const pages = templates.map((t) => t.build());
  const plan = pickPlan(en);
  const { date } = plan;
  const slicerFields: FieldRef[] = [];
  if (date) slicerFields.push({ col: date, part: periodFor(en, date, []) === 'year' || periodFor(en, date, []) === 'quarter' ? 'year' : 'month' });
  (plan.caseMode ? plan.highlights : plan.dims).slice(0, 3).forEach((d) => slicerFields.push({ col: d }));
  return { title, pages, measures: [], hierarchies: [], parameters: [], bookmarks: [], slicerFields, recipe: [] };
}

export { fieldLabel };
