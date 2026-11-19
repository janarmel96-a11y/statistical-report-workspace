// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { detectAnomalies, periodGrowth } from './analytics';
import { bucketAdd, bucketLabel, bucketStart, lastPeriodIncomplete, type Engine } from './engine';
import { formatNumber } from './format';
import { bestGrain, pickPlan } from './insights';
import { anova, chiSquare, forecast, mannKendall, quantileSorted } from './stats';
import type { Constraint, DatePart, Finding } from './types';

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
export interface AnalystBrief {
  headline: string;
  summary: string[];
  metric: string;
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
function series(en: Engine, metric: NonNullable<ReturnType<typeof pickPlan>['metric']>, date: string, cs: Constraint[]) {
  const dates = en.numbers(date, en.rows(cs)).sort((a, b) => a - b);
  if (dates.length < 3) return null;
  const { lo, hi } = mainRange(dates);
  const inside = dates.filter((d) => d >= lo && d <= hi);
  const part = bestGrain(inside[0], inside[inside.length - 1], new Set(inside.map((d) => Math.floor(d / DAY_MS))).size);
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
      metric: 'records', drivers, risks, actions: ['Check that the header row was found and that numbers are not stored as text.'],
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
      const prev = full[full.length - 2];
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
  return { headline: `${headline}.`, summary, metric: name, trend, forecast: fc, drivers: drivers.slice(0, 5), risks: risks.slice(0, 6), actions: [...new Set(actions)].slice(0, 5), confidence };
}

/** The brief in headed sections, for the AI Summary sheet and slides. */
export function briefSections(b: AnalystBrief): { heading: string; lines: string[] }[] {
  return [
    { heading: b.headline, lines: b.summary },
    ...(b.drivers.length ? [{ heading: 'What drives the numbers', lines: b.drivers.map((d) => `${d.text} (${d.test})`) }] : []),
    { heading: 'Risks and unusual results', lines: b.risks.length ? b.risks.map((r) => `${r.level === 'high' ? 'High' : r.level === 'medium' ? 'Medium' : 'Low'}: ${r.text}`) : ['No anomalies or open data issues were found.'] },
    { heading: 'Recommended actions', lines: b.actions.map((a, i) => `${i + 1}. ${a}`) },
    { heading: `Confidence: ${b.confidence.level}`, lines: [b.confidence.reason] },
  ];
}

/** The brief as plain text, for Excel, PowerPoint notes, and copying. */
export function briefText(b: AnalystBrief): string {
  return [
    b.headline, '', ...b.summary, '',
    ...(b.drivers.length ? ['What drives the numbers:', ...b.drivers.map((d) => `- ${d.text}`), ''] : []),
    ...(b.risks.length ? ['Risks and unusual results:', ...b.risks.map((r) => `- ${r.text}`), ''] : []),
    'Recommended actions:', ...b.actions.map((a, i) => `${i + 1}. ${a}`), '',
    `Confidence: ${b.confidence.level}. ${b.confidence.reason}`,
  ].join('\n');
}
