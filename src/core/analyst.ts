// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { detectAnomalies, periodGrowth } from './analytics';
import { bucketAdd, bucketLabel, bucketStart, groupConstraint, lastPeriodIncomplete, type Engine } from './engine';
import { formatNumber } from './format';
import { bestGrain, correlations, pickPlan } from './insights';
import { anova, chiSquare, forecast, iqrOutliers, mannKendall, mean, quantileSorted, skewness } from './stats';
import type { Cell, Constraint, DatePart, Finding, NumberFormat } from './types';

/**
 * The AI analyst: reads the whole report on this device and writes a brief, the way an analyst would.
 * Every sentence comes from a calculation with a stated test, so nothing is guessed and no data leaves the device.
 */

export interface AnalystForecast {
  history: { label: string; value: number }[];
  labels: string[];
  values: number[];
  low: number[];
  high: number[];
  method: string;
  /** Mean absolute percentage error of a holdout backtest, or null when the history is short. */
  mape: number | null;
  text: string;
}
export interface AnalystDriver { dim: string; strength: number; level: 'strong' | 'moderate' | 'weak'; text: string; test: string }
export interface AnalystRisk { level: 'high' | 'medium' | 'low'; text: string }
export interface KeyNumber { label: string; value: string; note?: string; tone?: 'up' | 'down' | 'flat' }
export interface SegmentRow { label: string; value: number; share: number | null; growth: number | null }
export interface AnalystSegments { dim: string; rows: SegmentRow[]; text: string[]; growthLabel?: string }
export interface AnalystBrief {
  headline: string;
  summary: string[];
  metric: string;
  /** How values of the metric are written, for charts. */
  format: { format?: NumberFormat; currency?: string };
  keyNumbers: KeyNumber[];
  segments?: AnalystSegments;
  relationships: { text: string; test: string }[];
  distribution: string[];
  seasonality?: string;
  methods: string[];
  trend?: { direction: 'up' | 'down' | 'flat'; p: number; text: string };
  forecast?: AnalystForecast;
  drivers: AnalystDriver[];
  risks: AnalystRisk[];
  actions: string[];
  confidence: { level: 'high' | 'medium' | 'low'; reason: string };
}

const PART_WORD: Record<DatePart, string> = { year: 'year', quarter: 'quarter', month: 'month', week: 'week', day: 'day' };
const pct = (v: number) => `${(v * 100).toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) < 0.1 ? 1 : 0 })}%`;
const pText = (p: number) => (p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`);
const level = (x: number, strong: number, moderate: number): AnalystDriver['level'] => (x >= strong ? 'strong' : x >= moderate ? 'moderate' : 'weak');

/**
 * The most detailed date column. A month label read as a date ("JANUARY 2026") puts every row on the 1st,
 * which hides that the latest month is still in progress, so a Timestamp or date of service is preferred.
 */
function timeline(en: Engine, fallback?: string): string | undefined {
  let best = fallback;
  let bestDays = -1;
  for (const c of en.table.columns) {
    if (c.type !== 'date' || /(birth|dob|expir)/i.test(c.name)) continue;
    const xs = c.values.filter((v): v is number => typeof v === 'number').sort((a, b) => a - b);
    if (xs.length < 3) continue;
    const { lo, hi } = mainRange(xs);
    const days = new Set<number>();
    for (const v of xs) if (v >= lo && v <= hi) days.add(Math.floor(v / DAY_MS));
    if (days.size > bestDays) { best = c.name; bestDays = days.size; }
  }
  return best;
}

const DAY_MS = 86400000;
/** The middle 98% of dates, widened by a month, so typing slips such as 1937 or 2075 do not stretch the timeline. */
function mainRange(sorted: number[]) {
  return { lo: quantileSorted(sorted, 0.01) - 31 * DAY_MS, hi: quantileSorted(sorted, 0.99) + 31 * DAY_MS };
}

/** Totals per period inside the main date range, with the change from the period before. */
function series(en: Engine, metric: NonNullable<ReturnType<typeof pickPlan>['metric']>, date: string, cs: Constraint[], force?: DatePart) {
  const dates = en.numbers(date, en.rows(cs)).sort((a, b) => a - b);
  if (dates.length < 3) return null;
  const { lo, hi } = mainRange(dates);
  const inside = dates.filter((d) => d >= lo && d <= hi);
  const part = force ?? bestGrain(inside[0], inside[inside.length - 1], new Set(inside.map((d) => Math.floor(d / DAY_MS))).size);
  const [first, last] = [bucketStart(inside[0], part), bucketStart(inside[inside.length - 1], part)];
  const partial = lastPeriodIncomplete(inside, part);
  const kept = periodGrowth(en, metric, date, part, cs).filter((p) => p.key >= first && p.key <= last);
  const points = kept.map((p, i) => {
    const prev = i ? kept[i - 1].value : null;
    return { ...p, change: prev === null ? null : p.value - prev, growth: prev ? (p.value - prev) / Math.abs(prev) : null, partial: partial && i === kept.length - 1 };
  });
  return { part, points, outside: dates.length - inside.length };
}

export function analyzeReport(en: Engine, findings: Finding[], cs: Constraint[]): AnalystBrief {
  const picked = pickPlan(en);
  const plan = { ...picked, date: timeline(en, picked.date) };
  const rows = en.rows(cs);
  const n = rows.length;
  const drivers: AnalystDriver[] = [];
  const risks: AnalystRisk[] = [];
  const actions: string[] = [];
  const summary: string[] = [];
  const review = findings.filter((f) => !f.auto && f.severity !== 'info');
  const corrected = findings.filter((f) => f.auto).reduce((s, f) => s + f.count, 0);

  if (!plan.metric || n < 3) {
    return {
      headline: `${n.toLocaleString('en-US')} rows were read, but there is no number or category to analyze yet.`,
      summary: ['Add a file with a numeric column, a date, or categories such as type or location to get a full analysis.'],
      metric: 'records', format: {}, keyNumbers: [], relationships: [], distribution: [], methods: [],
      drivers, risks, actions: ['Check that the header row was found and that numbers are not stored as text.'],
      confidence: { level: 'low', reason: 'Too little data to analyze.' },
    };
  }
  const metric = plan.metric;
  const counting = metric.kind === 'col' && metric.agg === 'rows';
  const name = counting ? 'records' : metric.kind === 'col' ? metric.col : metric.name;
  const Name = name[0].toUpperCase() + name.slice(1);
  const fmt = en.valueFormat(metric);
  const f = (v: number | null) => formatNumber(v, { ...fmt, compact: true });
  const total = en.evaluate(metric, cs);
  // Key figures are written in full unless they are very large.
  const full_ = (v: number | null) => (v !== null && Math.abs(v) < 1e7 ? formatNumber(v, fmt) : f(v));
  const keyNumbers: KeyNumber[] = [{ label: counting ? 'Records' : `Total ${name}`, value: full_(total) }];
  const methods: string[] = [];
  let fullPts: { key: number; label: string; value: number; growth: number | null }[] = [];
  let timePart: DatePart = 'month';
  let seasonality: string | undefined;
  summary.push(counting
    ? `The report covers ${n.toLocaleString('en-US')} records${plan.date ? '' : '.'}`
    : `${Name} totals ${f(total)} across ${n.toLocaleString('en-US')} rows${plan.date ? '' : '.'}`);

  /* ---------- Time: trend, latest change, anomalies, forecast ---------- */
  let trend: AnalystBrief['trend'];
  let fc: AnalystForecast | undefined;
  let periods = 0;
  if (plan.date) {
    const s = series(en, metric, plan.date, cs);
    const part = s?.part ?? 'month';
    const word = PART_WORD[part];
    const points = s?.points ?? [];
    if (s?.outside) risks.push({ level: 'low', text: `${s.outside.toLocaleString('en-US')} ${s.outside === 1 ? 'row has a date' : 'rows have dates'} in ${plan.date} far outside the rest, likely typing slips in the year; ${s.outside === 1 ? 'it is' : 'they are'} left out of the trend.` });
    const full = points.filter((p) => !p.partial);
    periods = full.length;
    fullPts = full;
    timePart = part;
    if (full.length) keyNumbers.push({ label: `Average per ${word}`, value: full_(mean(full.map((p) => p.value))), note: `${full.length} complete ${word}s` });
    if (points.length) summary[0] += ` from ${points[0].label} to ${points[points.length - 1].label}.`;
    const partial = points.find((p) => p.partial);
    if (partial) risks.push({ level: 'low', text: `${partial.label} is still in progress, so its ${f(partial.value)} is not comparable with complete ${word}s yet.` });
    if (full.length >= 4) {
      const values = full.map((p) => p.value);
      const mk = mannKendall(values);
      const [first, last] = [full[0], full[full.length - 1]];
      const change = first.value ? (last.value - first.value) / Math.abs(first.value) : null;
      const direction = mk.trend === 'up' ? 'up' : mk.trend === 'down' ? 'down' : 'flat';
      const moved = change === null ? '' : ` (${change >= 0 ? '+' : '−'}${pct(Math.abs(change))})`;
      trend = {
        direction, p: mk.p,
        text: direction === 'flat'
          ? `${Name} went from ${f(first.value)} in ${first.label} to ${f(last.value)} in ${last.label}${moved}, with no steady rise or fall (Mann-Kendall ${pText(mk.p)}).`
          : `${Name} ${direction === 'up' ? 'rose' : 'fell'} steadily from ${f(first.value)} in ${first.label} to ${f(last.value)} in ${last.label}${moved}, a statistically significant ${direction}ward trend (Mann-Kendall ${pText(mk.p)}).`,
      };
      summary.push(trend.text);
      methods.push('Trend: Mann-Kendall test on complete periods (no assumption about the shape of the trend).');
      const prev = full[full.length - 2];
      keyNumbers.push({ label: `Latest ${word} (${last.label})`, value: full_(last.value), note: last.growth === null ? undefined : `${last.growth >= 0 ? 'Up' : 'Down'} ${pct(Math.abs(last.growth))} on ${prev?.label}`, tone: last.growth === null ? undefined : last.growth > 0.005 ? 'up' : last.growth < -0.005 ? 'down' : 'flat' });
      const back = part === 'month' ? 12 : part === 'quarter' ? 4 : part === 'week' ? 52 : 0;
      const yearAgo = back ? full.find((p) => p.key === bucketAdd(last.key, part, -back)) : undefined;
      if (yearAgo && yearAgo.value) {
        const yoy = (last.value - yearAgo.value) / Math.abs(yearAgo.value);
        keyNumbers.push({ label: `Same ${word} last year`, value: full_(yearAgo.value), note: `${last.label} is ${yoy >= 0 ? 'up' : 'down'} ${pct(Math.abs(yoy))} year on year`, tone: yoy > 0.005 ? 'up' : yoy < -0.005 ? 'down' : 'flat' });
        summary.push(`Compared with the same ${word} last year (${yearAgo.label}), ${last.label} is ${yoy >= 0 ? 'up' : 'down'} ${pct(Math.abs(yoy))}.`);
      }
      const best = full.reduce((a, b) => (b.value > a.value ? b : a));
      const worst = full.reduce((a, b) => (b.value < a.value ? b : a));
      keyNumbers.push({ label: `Best ${word}`, value: full_(best.value), note: best.label }, { label: `Lowest ${word}`, value: full_(worst.value), note: worst.label });
      // Seasonality is measured on months after removing the trend: each month is compared with a centred
      // 12-month moving average, so steady growth is not mistaken for a busy end of year.
      const monthly = part === 'month' ? full : (series(en, metric, plan.date, cs, 'month')?.points ?? []).filter((p) => !p.partial);
      if (monthly.length >= 24) {
        const full = monthly;
        const ratios = Array.from({ length: 12 }, () => [] as number[]);
        for (let i = 6; i + 6 < full.length; i++) {
          let s = (full[i - 6].value + full[i + 6].value) / 2;
          for (let k = i - 5; k <= i + 5; k++) s += full[k].value;
          const cma = s / 12;
          if (cma > 0) ratios[new Date(full[i].key).getUTCMonth()].push(full[i].value / cma);
        }
        const months = ratios.map((xs, m) => ({ m, v: xs.length ? mean(xs) : NaN })).filter((x) => Number.isFinite(x.v));
        if (months.length === 12) {
          const hi = months.reduce((a, b) => (b.v > a.v ? b : a));
          const lo = months.reduce((a, b) => (b.v < a.v ? b : a));
          const NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
          if (hi.v - 1 >= 0.08 && 1 - lo.v >= 0.05) {
            seasonality = `${Name} follows a yearly pattern: after allowing for the trend, it is highest in ${NAMES[hi.m]} (${pct(hi.v - 1)} above normal) and lowest in ${NAMES[lo.m]} (${pct(1 - lo.v)} below).`;
            methods.push('Seasonality: each month against a centred 12-month moving average, over at least two years.');
          }
        }
      }
      if (prev && last.growth !== null) {
        summary.push(`The latest complete ${word}, ${last.label}, ${last.growth >= 0 ? 'was up' : 'was down'} ${pct(Math.abs(last.growth))} on ${prev.label}.`);
        if (last.growth <= -0.2) actions.push(`Look into the ${pct(Math.abs(last.growth))} drop in ${name} in ${last.label} compared with ${prev.label}.`);
      }
      if (direction === 'down') actions.push(`Find out what is behind the steady decline in ${name}; compare the groups below for ${first.label} and ${last.label}.`);
      for (const a of detectAnomalies(full.map((p) => ({ label: p.label, value: p.value }))).slice(0, 3)) {
        const times = a.expected ? a.value / a.expected : null;
        risks.push({ level: 'medium', text: `Unusual ${a.direction} in ${a.label}: ${f(a.value)} against about ${f(a.expected)} expected${times && a.direction === 'spike' ? ` (${times.toFixed(1)} times the usual level)` : ''}.` });
        actions.push(`Check the records for ${a.label}; the ${a.direction} may be a real event or a data entry problem.`);
      }
      if (full.length >= 6) {
        const season = part === 'month' && full.length >= 26 ? 12 : part === 'quarter' && full.length >= 10 ? 4 : 0;
        const out = forecast(values, 3, season);
        if (out) {
          const floor = (v: number) => (counting || en.isAdditive(metric) ? Math.max(0, v) : v);
          const labels = [1, 2, 3].map((h) => bucketLabel(bucketAdd(last.key, part, h), part));
          const values3 = out.values.map(floor);
          const low = out.low.map(floor);
          const high = out.high.map(floor);
          const width = values3[0] ? (high[0] - low[0]) / 2 / Math.abs(values3[0]) : null;
          fc = {
            history: full.map((p) => ({ label: p.label, value: p.value })), labels, values: values3, low, high, method: out.method, mape: out.mape,
            text: `Forecast for ${labels[0]}: about ${f(values3[0])} (95% range ${f(low[0])} to ${f(high[0])}), then ${f(values3[1])} and ${f(values3[2])}. Method: ${out.method}${out.mape !== null ? `, backtest error about ${pct(out.mape)}` : ''}.`,
          };
          summary.push(fc.text);
          keyNumbers.push({ label: `Forecast ${labels[0]}`, value: full_(values3[0]), note: `95% range ${f(low[0])} to ${f(high[0])}` });
          methods.push(`Forecast: ${out.method} with a 95% range from past errors${out.mape !== null ? `, checked on the last ${word}s held back (backtest error ${pct(out.mape)})` : ''}.`);
          if (width !== null && width > 0.35) actions.push(`Treat the forecast as a rough guide: its range is ±${pct(width)}. More ${word}s of data will narrow it.`);
        }
      }
    } else if (full.length) {
      risks.push({ level: 'low', text: `Only ${full.length} complete ${word}${full.length === 1 ? '' : 's'} of data, too few for a trend test or forecast.` });
    }
  }

  /* ---------- Groups: what drives the numbers ---------- */
  const dims = plan.dims.filter((d) => { const c = en.column(d); return c && new Set(c.values.filter((v) => v !== null)).size <= 40; }).slice(0, 8);
  const metricCol = metric.kind === 'col' ? metric.col : null;
  for (const dim of dims) {
    const groups = [...en.groupRows(cs, { col: dim }).entries()].filter(([k]) => k !== null);
    if (groups.length < 2) continue;
    if (!counting && metricCol) {
      const samples = groups.map(([, r]) => en.numbers(metricCol, r)).filter((xs) => xs.length >= 2);
      if (samples.length < 2) continue;
      const test = anova(samples);
      const eta = test.effect ?? 0;
      if (!(test.p < 0.05) || !Number.isFinite(eta)) continue;
      const means = groups.map(([k, r]) => ({ k: String(k), m: en.aggregate(r, metricCol, 'avg') ?? 0 })).sort((a, b) => b.m - a.m);
      drivers.push({
        dim, strength: eta, level: level(eta, 0.14, 0.06),
        text: `${dim} explains ${pct(eta)} of the differences in ${name}: ${means[0].k} averages ${f(means[0].m)} against ${f(means[means.length - 1].m)} for ${means[means.length - 1].k}.`,
        test: `One-way ANOVA, F = ${test.statistic.toFixed(2)}, ${pText(test.p)}, eta squared = ${eta.toFixed(3)}`,
      });
    } else {
      const sizes = groups.map(([k, r]) => ({ k: typeof k === 'boolean' ? (k ? 'Yes' : 'No') : String(k), n: r.length })).sort((a, b) => b.n - a.n);
      const all = sizes.reduce((s, g) => s + g.n, 0);
      const top = sizes[0];
      const share = top.n / all;
      const top3 = sizes.slice(0, 3).reduce((s, g) => s + g.n, 0) / all;
      drivers.push({
        dim, strength: share, level: level(share, 0.5, 0.3),
        text: `${top.k} is the largest ${dim} group with ${pct(share)} of ${name}${sizes.length > 3 ? `; the top 3 of ${sizes.length} make up ${pct(top3)}` : ''}.`,
        test: `Share of ${all.toLocaleString('en-US')} records in ${sizes.length} groups`,
      });
      if (sizes.length >= 4 && top3 >= 0.75 && /(worker|staff|agent|branch|doctor|nurse|employee|officer|rsw|provider)/i.test(dim)) {
        risks.push({ level: 'medium', text: `Workload is concentrated: the top 3 ${dim} groups handle ${pct(top3)} of ${name}.` });
        actions.push(`Review how work is shared across ${dim}; ${top.k} alone has ${pct(share)}.`);
      }
    }
  }
  drivers.sort((a, b) => b.strength - a.strength);
  if (drivers.length) methods.push(counting ? 'Groups: share of records in each group.' : 'Drivers: one-way ANOVA; eta squared is the share of differences a group explains.');

  /* ---------- Segment performance: the groups, their share, and how they changed ---------- */
  let segments: AnalystSegments | undefined;
  const segDim = (counting ? plan.highlights : drivers.map((d) => d.dim)).concat(dims).find((d) => {
    const k = new Set(en.column(d)?.values.filter((v) => v !== null)).size;
    return k >= 3 && k <= 15;
  }) ?? drivers[0]?.dim;
  if (segDim) {
    const keyLabel = (k: Cell) => (typeof k === 'boolean' ? (k ? 'Yes' : 'No') : String(k));
    const additive = counting || en.isAdditive(metric);
    const [last, prev] = [fullPts[fullPts.length - 1], fullPts[fullPts.length - 2]];
    const field = plan.date ? { col: plan.date, part: timePart } : null;
    const rowsOut: SegmentRow[] = [...en.groupRows(cs, { col: segDim }).keys()].filter((k) => k !== null).map((k) => {
      const g = groupConstraint({ col: segDim }, k);
      const value = en.evaluate(metric, [...cs, g]) ?? 0;
      let growth: number | null = null;
      if (field && last && prev) {
        const v1 = en.evaluate(metric, [...cs, g, groupConstraint(field, last.key)]) ?? 0;
        const v0 = en.evaluate(metric, [...cs, g, groupConstraint(field, prev.key)]) ?? 0;
        growth = v0 && (!counting || v0 >= 5) ? (v1 - v0) / Math.abs(v0) : null;
      }
      return { label: keyLabel(k), value, share: additive && total ? value / total : null, growth };
    }).sort((a, b) => b.value - a.value).slice(0, 8);
    if (rowsOut.length >= 2) {
      const text: string[] = [];
      const lead = rowsOut[0];
      text.push(lead.share !== null
        ? `${lead.label} leads ${segDim} with ${f(lead.value)} (${pct(lead.share)} of ${name}); ${rowsOut[rowsOut.length - 1].label} is smallest of the top ${rowsOut.length} with ${f(rowsOut[rowsOut.length - 1].value)}.`
        : `${lead.label} has the highest ${name} in ${segDim} (${f(lead.value)}), ${rowsOut[rowsOut.length - 1].label} the lowest of the top ${rowsOut.length} (${f(rowsOut[rowsOut.length - 1].value)}).`);
      const moving = rowsOut.filter((r) => r.growth !== null && (r.share === null || r.share >= 0.03));
      const up = moving.reduce<SegmentRow | null>((a, b) => (!a || (b.growth ?? 0) > (a.growth ?? 0) ? b : a), null);
      const down = moving.reduce<SegmentRow | null>((a, b) => (!a || (b.growth ?? 0) < (a.growth ?? 0) ? b : a), null);
      if (up && (up.growth ?? 0) > 0.05) text.push(`${up.label} grew fastest: +${pct(up.growth!)} in ${last!.label} compared with ${prev!.label}.`);
      if (down && down !== up && (down.growth ?? 0) < -0.05) text.push(`${down.label} fell the most: −${pct(Math.abs(down.growth!))} over the same ${PART_WORD[timePart]}.`);
      segments = { dim: segDim, rows: rowsOut, text, growthLabel: last && prev ? `${last.label} vs ${prev.label}` : undefined };
    }
  }

  /* ---------- Relationships between numeric columns ---------- */
  // Two columns that move almost exactly together (such as Gross and Net Sales) are one finding, not many:
  // the second is noted once and left out of the other pairs, so each relationship is reported only once.
  const pairs = correlations(en.table, rows).filter((c) => c.q < 0.05 && c.n >= 10).sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  const alias = new Map<string, string>();
  for (const c of pairs) if (Math.abs(c.r) >= 0.97 && !alias.has(c.a) && !alias.has(c.b)) alias.set(c.b, c.a);
  const test = (c: typeof pairs[number]) => `Pearson r = ${c.r.toFixed(2)}, Spearman rho = ${c.rho.toFixed(2)}, ${c.q < 0.001 ? 'q < 0.001' : `q = ${c.q.toFixed(3)}`}, n = ${c.n.toLocaleString('en-US')}`;
  const relationships = [
    ...[...alias].slice(0, 2).map(([b, a]) => {
      const c = pairs.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a))!;
      return { text: `${b} moves almost exactly with ${a}, so it tells the same story; it is left out of the comparisons below.`, test: test(c) };
    }),
    ...pairs.filter((c) => Math.abs(c.r) >= 0.3 && Math.abs(c.r) < 0.97 && !alias.has(c.a) && !alias.has(c.b)).slice(0, 3).map((c) => {
      const strength = Math.abs(c.r) >= 0.7 ? 'strong' : Math.abs(c.r) >= 0.5 ? 'moderate' : 'weak';
      return {
        text: `${c.a} and ${c.b} ${c.r > 0 ? 'rise and fall together' : 'move in opposite directions'} (${strength} correlation). This shows they are linked, not that one causes the other.`,
        test: test(c),
      };
    }),
  ];
  if (relationships.length) methods.push('Relationships: Pearson and Spearman correlation, with Benjamini-Hochberg q-values to avoid chance findings.');

  /* ---------- Distribution and outliers ---------- */
  const distribution: string[] = [];
  const distCol = !counting && metricCol ? metricCol : plan.groups.age;
  if (distCol) {
    const xs = en.numbers(distCol, rows).sort((a, b) => a - b);
    if (xs.length >= 20) {
      const dfmt = (v: number) => (distCol === metricCol ? f(v) : v.toLocaleString('en-US', { maximumFractionDigits: 1 }));
      const med = quantileSorted(xs, 0.5);
      const avg = mean(xs);
      const sk = skewness(xs);
      const [q1, q3] = [quantileSorted(xs, 0.25), quantileSorted(xs, 0.75)];
      distribution.push(`Typical ${distCol} is ${dfmt(med)} (median); the middle half lies between ${dfmt(q1)} and ${dfmt(q3)}, and the average is ${dfmt(avg)}${sk > 1 ? ', pulled up by a few large values' : sk < -1 ? ', pulled down by a few small values' : ''} (skewness ${sk.toFixed(1)}).`);
      const out = iqrOutliers(xs);
      if (out.indices.length) {
        const high = xs.filter((v) => v > out.high).length;
        distribution.push(`${out.indices.length.toLocaleString('en-US')} ${out.indices.length === 1 ? 'value is' : 'values are'} unusually far from the rest (${pct(out.indices.length / xs.length)}): ${high ? `${high.toLocaleString('en-US')} above ${dfmt(out.high)}` : ''}${high && out.indices.length > high ? ' and ' : ''}${out.indices.length > high ? `${(out.indices.length - high).toLocaleString('en-US')} below ${dfmt(out.low)}` : ''}.`);
      }
      methods.push('Distribution: median and quartiles; outliers by the 1.5 × IQR rule.');
    }
  }

  // Did the mix of a group change in the latest period? A chi-square test compares it with the periods before.
  if (plan.date && periods >= 3) {
    const part = series(en, metric, plan.date, cs)?.part ?? 'month';
    const byPeriod = [...en.groupRows(cs, { col: plan.date, part }).entries()].filter(([k]) => typeof k === 'number').sort((a, b) => (a[0] as number) - (b[0] as number));
    const lastFull = byPeriod.length - (risks.some((r) => r.text.includes('still in progress')) ? 2 : 1);
    if (lastFull >= 1) {
      const latest = new Set(byPeriod[lastFull][1]);
      const earlier = new Set(byPeriod.slice(0, lastFull).flatMap(([, r]) => [...r]));
      for (const dim of dims.slice(0, 4)) {
        const col = en.column(dim)!;
        const keys = [...new Set(col.values.filter((v) => v !== null))];
        if (keys.length < 2 || keys.length > 12) continue;
        const count = (set: Set<number>) => keys.map((k) => { let c = 0; set.forEach((i) => { if (col.values[i] === k) c++; }); return c; });
        const [a, b] = [count(latest), count(earlier)];
        if (a.reduce((s, x) => s + x, 0) < 20) continue;
        const keep = keys.map((_, i) => a[i] + b[i] > 0);
        const test = chiSquare([a.filter((_, i) => keep[i]), b.filter((_, i) => keep[i])]);
        if (test.p < 0.01 && (test.effect ?? 0) >= 0.1) {
          const sa = a.reduce((s, x) => s + x, 0);
          const sb = b.reduce((s, x) => s + x, 0);
          const moves = keys.map((k, i) => ({ k: String(k), d: a[i] / sa - b[i] / sb, from: b[i] / sb, to: a[i] / sa })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
          const m = moves[0];
          risks.push({ level: 'medium', text: `The ${dim} mix changed in ${bucketLabel(byPeriod[lastFull][0] as number, part)}: ${m.k} went from ${pct(m.from)} to ${pct(m.to)} (chi-square ${pText(test.p)}, Cramér's V = ${(test.effect ?? 0).toFixed(2)}).` });
        }
      }
    }
  }

  /* ---------- Data quality ---------- */
  if (corrected) summary.push(`${corrected.toLocaleString('en-US')} ${corrected === 1 ? 'value was' : 'values were'} corrected automatically before the analysis.`);
  if (review.length) {
    risks.push({ level: review.some((x) => x.severity === 'error') ? 'high' : 'medium', text: `${review.length} data ${review.length === 1 ? 'issue needs' : 'issues need'} your review: ${review.slice(0, 2).map((x) => x.title).join('; ')}.` });
    actions.unshift(`Review the ${review.length} flagged ${review.length === 1 ? 'issue' : 'issues'} under Checks and corrections before sharing the report.`);
  }
  if (!counting && drivers[0] && drivers[0].level !== 'weak') {
    summary.push(drivers[0].text);
    actions.push(`Break ${name} down by ${drivers[0].dim} first; it is the strongest driver found.`);
  }
  if (!actions.length) actions.push(`Share the report: no anomalies or data issues were found${trend ? `, and ${name} is ${trend.direction === 'flat' ? 'stable' : `trending ${trend.direction}`}` : ''}.`);

  const reasons: string[] = [];
  if (n < 30) reasons.push(`only ${n} rows`);
  if (plan.date && periods < 6) reasons.push(`${periods} complete periods`);
  if (fc?.mape !== null && fc?.mape !== undefined && fc.mape > 0.25) reasons.push(`a forecast backtest error of ${pct(fc.mape)}`);
  if (review.some((x) => x.severity === 'error')) reasons.push('data errors that need review');
  const confidence: AnalystBrief['confidence'] = reasons.length === 0
    ? { level: 'high', reason: `Based on ${n.toLocaleString('en-US')} rows${periods ? ` and ${periods} complete periods` : ''}, with no open data errors.` }
    : { level: n < 30 || reasons.length > 1 ? 'low' : 'medium', reason: `Limited by ${reasons.join(', ')}.` };

  const headline = [
    counting ? `${n.toLocaleString('en-US')} records` : `${Name} of ${f(total)}`,
    trend ? (trend.direction === 'flat' ? 'holding steady' : `trending ${trend.direction}`) : null,
    fc ? `about ${f(fc.values[0])} expected in ${fc.labels[0]}` : null,
  ].filter(Boolean).join(', ');
  if (risks.some((r) => r.text.startsWith('Unusual'))) methods.push('Unusual periods: robust score of each period against its neighbors.');
  return {
    headline: `${headline}.`, summary, metric: name, format: fmt, keyNumbers: keyNumbers.slice(0, 7), segments, relationships, distribution, seasonality, methods,
    trend, forecast: fc, drivers: drivers.slice(0, 5), risks: risks.slice(0, 6), actions: [...new Set(actions)].slice(0, 5), confidence,
  };
}

/** The brief in headed sections, for the AI Summary sheet and slides. */
export function briefSections(b: AnalystBrief): { heading: string; lines: string[] }[] {
  return [
    { heading: b.headline, lines: b.summary },
    ...(b.keyNumbers.length ? [{ heading: 'Key numbers', lines: b.keyNumbers.map((k) => `${k.label}: ${k.value}${k.note ? ` (${k.note})` : ''}`) }] : []),
    ...(b.segments ? [{ heading: `Performance by ${b.segments.dim}`, lines: [...b.segments.text, ...b.segments.rows.map((r) => `${r.label}: ${r.value.toLocaleString('en-US', { maximumFractionDigits: 2 })}${r.share !== null ? `, ${(r.share * 100).toFixed(1)}% of total` : ''}${r.growth !== null ? `, ${r.growth >= 0 ? '+' : ''}${(r.growth * 100).toFixed(1)}% (${b.segments!.growthLabel})` : ''}`)] }] : []),
    ...(b.seasonality ? [{ heading: 'Seasonal pattern', lines: [b.seasonality] }] : []),
    ...(b.relationships.length ? [{ heading: 'Relationships', lines: b.relationships.map((r) => `${r.text} (${r.test})`) }] : []),
    ...(b.distribution.length ? [{ heading: 'Distribution and outliers', lines: b.distribution }] : []),
    ...(b.drivers.length ? [{ heading: 'What drives the numbers', lines: b.drivers.map((d) => `${d.text} (${d.test})`) }] : []),
    { heading: 'Risks and unusual results', lines: b.risks.length ? b.risks.map((r) => `${r.level === 'high' ? 'High' : r.level === 'medium' ? 'Medium' : 'Low'}: ${r.text}`) : ['No anomalies or open data issues were found.'] },
    { heading: 'Recommended actions', lines: b.actions.map((a, i) => `${i + 1}. ${a}`) },
    { heading: `Confidence: ${b.confidence.level}`, lines: [b.confidence.reason] },
    ...(b.methods.length ? [{ heading: 'How this was worked out', lines: b.methods }] : []),
  ];
}

/** The brief as plain text, for PowerPoint notes and copying. */
export function briefText(b: AnalystBrief): string {
  return briefSections(b).map((sec, i) => [i === 0 ? sec.heading : `${sec.heading}:`, ...sec.lines.map((l) => (i === 0 || /^\d+\./.test(l) ? l : `- ${l}`))].join('\n')).join('\n\n');
}
