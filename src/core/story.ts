// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { Engine, groupConstraint, lastPeriodIncomplete } from './engine';
import { formatNumber, formatPct } from './format';
import { generateInsights, pickPlan } from './insights';
import {
  activeField, queryBox, queryCategories, queryHeatmap, queryHistogram, queryKpi, queryRange, queryScatter, queryVariance,
  visualConstraints, type ReportDoc, type Visual,
} from './report';
import { mannKendall, mean } from './stats';
import type { Constraint, Finding, ValueRef } from './types';

/** Turns a report into a spoken story. Every number is calculated from the data, never written by hand. */

export type DetailLevel = 'brief' | 'standard' | 'detailed';
export type SceneKind = 'title' | 'kpis' | 'chart' | 'findings' | 'quality' | 'actions' | 'closing' | 'custom';

export interface StoryKpi { label: string; value: string; note?: string }

export interface StoryScene {
  id: string;
  kind: SceneKind;
  kicker: string;
  title: string;
  bullets: string[];
  narration: string;
  visualId?: string;
  kpis?: StoryKpi[];
}

export interface VisualStory { headline: string; bullets: string[]; sentences: string[]; takeaway: string }

const metricName = (v: ValueRef) => (v.kind === 'measure' ? v.name : v.agg === 'rows' ? 'records' : v.col);
const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

/** Explains one chart in plain language from its own numbers. */
export function describeVisual(en: Engine, v: Visual, pageCs: Constraint[]): VisualStory | null {
  const cs = visualConstraints(v, pageCs);
  const value = v.values[0];
  const field = activeField(v);
  const money = (x: number | null, val: ValueRef = value) => formatNumber(x, { ...en.valueFormat(val), compact: true });

  if (v.type === 'scatter') {
    const s = queryScatter(en, v, cs);
    if (!s || s.points.length < 3 || Number.isNaN(s.r)) return null;
    const a = Math.abs(s.r);
    const strength = a >= 0.7 ? 'strong' : a >= 0.4 ? 'moderate' : a >= 0.2 ? 'weak' : 'very weak';
    const way = s.r >= 0 ? 'rise together' : 'move in opposite directions';
    return {
      headline: `${s.xName} and ${s.yName} have a ${strength} relationship`,
      bullets: [`Correlation is ${s.r.toFixed(2)}`, `${s.points.length.toLocaleString('en-US')} points compared`, 'Association does not prove cause'],
      sentences: [
        `This chart compares ${s.xName} with ${s.yName}, where each dot is one record.`,
        `The correlation is ${s.r.toFixed(2)}, which is a ${strength} relationship, so the two values tend to ${a < 0.2 ? 'move independently' : way}.`,
        'This shows association only, so it does not prove that one causes the other.',
      ],
      takeaway: a >= 0.4 ? `The key takeaway is that ${s.xName} and ${s.yName} are meaningfully associated.` : 'The key takeaway is that these two measures show little linear association.',
    };
  }
  if (v.type === 'histogram') {
    const h = queryHistogram(en, v, cs);
    if (!h?.n) return null;
    const peak = h.bins.reduce((a, b) => (b.count > a.count ? b : a));
    const c = en.column(h.name);
    const f = (x: number | null) => formatNumber(x, { format: c?.format, currency: c?.currency, compact: true });
    const skew = (h.mean ?? 0) > (h.median ?? 0) * 1.1 ? 'a few large values pull the average up' : (h.mean ?? 0) < (h.median ?? 0) * 0.9 ? 'a few small values pull the average down' : 'values are fairly balanced around the middle';
    return {
      headline: `Most ${h.name} values fall between ${f(peak.start)} and ${f(peak.end)}`,
      bullets: [`Average ${f(h.mean)}`, `Median ${f(h.median)}`, `${formatPct(peak.count / h.n)} of rows in the largest group`],
      sentences: [
        `This chart shows how ${h.name} is spread across ${h.n.toLocaleString('en-US')} rows.`,
        `The most common range is ${f(peak.start)} to ${f(peak.end)}, which holds ${formatPct(peak.count / h.n)} of all rows.`,
        `The average is ${f(h.mean)} and the median is ${f(h.median)}, so ${skew}.`,
      ],
      takeaway: `The key takeaway is that a typical value is close to the median of ${f(h.median)}.`,
    };
  }
  if (v.type === 'box') {
    const b = queryBox(en, v, cs);
    if (!b?.stats.length) return null;
    const c = en.column(b.name);
    const f = (x: number) => formatNumber(x, { format: c?.format, currency: c?.currency, compact: true });
    let top = 0;
    b.stats.forEach((s, i) => { if (s.median > b.stats[top].median) top = i; });
    const outliers = b.stats.reduce((n, s) => n + s.outliers.length, 0);
    return {
      headline: `${b.categories[top].label} has the highest typical ${b.name}`,
      bullets: [`Median ${f(b.stats[top].median)}`, plural(outliers, 'unusual value')],
      sentences: [
        `This chart compares the typical range of ${b.name}${b.field ? ` across each ${b.field.col}` : ''}.`,
        `${b.categories[top].label} has the highest median at ${f(b.stats[top].median)}.`,
        outliers ? `There are ${plural(outliers, 'unusual value')} outside the normal range, and these are worth checking.` : 'No unusual values appear outside the normal range.',
      ],
      takeaway: `The key takeaway is that ${b.categories[top].label} has the highest typical value.`,
    };
  }
  if (!value) return null;
  const name = metricName(value);
  if (v.type === 'variance') {
    const r = queryVariance(en, v, cs);
    if (!r) return null;
    const pts = r.categories.map((c, i) => ({ label: c.label, ch: r.changes[i] })).filter((p): p is { label: string; ch: number } => p.ch !== null);
    if (!pts.length) return null;
    const last = pts[pts.length - 1];
    const best = pts.reduce((a, b) => (b.ch > a.ch ? b : a));
    const worst = pts.reduce((a, b) => (b.ch < a.ch ? b : a));
    const ups = pts.filter((p) => p.ch > 0).length;
    return {
      headline: `${name} ${last.ch >= 0 ? 'grew' : 'fell'} ${formatPct(Math.abs(last.ch))} year over year in ${last.label}`,
      bullets: [`Best: ${best.label}, ${formatPct(best.ch)}`, `Weakest: ${worst.label}, ${formatPct(worst.ch)}`, `${ups} of ${pts.length} periods improved`],
      sentences: [
        `This chart compares each period of ${name} with the same period one year earlier.`,
        `In ${last.label}, ${name} ${last.ch >= 0 ? 'rose' : 'fell'} ${formatPct(Math.abs(last.ch))} compared with the year before.`,
        `The strongest period was ${best.label} at ${formatPct(best.ch)}, and the weakest was ${worst.label} at ${formatPct(worst.ch)}.`,
        `Overall, ${ups} of ${pts.length} periods improved.${r.omitted ? ` ${r.omitted} is left out because it is not finished.` : ''}`,
      ],
      takeaway: `The key takeaway is that the latest period ${last.ch >= 0 ? 'improved' : 'declined'} compared with the same period last year.`,
    };
  }
  if (v.type === 'heatmap') {
    const h = queryHeatmap(en, v, cs);
    if (!h) return null;
    const cells = h.cells.filter((c): c is [number, number, number] => c[2] !== null);
    if (!cells.length) return null;
    const hi = cells.reduce((a, b) => (b[2] > a[2] ? b : a));
    const lo = cells.reduce((a, b) => (b[2] < a[2] ? b : a));
    const label = (c: [number, number, number]) => `${h.xs[c[0]].label} and ${h.ys[c[1]].label}`;
    return {
      headline: `${label(hi)} is the strongest combination`,
      bullets: [`Highest: ${label(hi)}, ${money(hi[2])}`, `Lowest: ${label(lo)}, ${money(lo[2])}`],
      sentences: [
        `This heatmap shows ${name} for every combination of ${h.xField.col} and ${h.yField.col}, and darker cells mean higher values.`,
        `The strongest combination is ${label(hi)} at ${money(hi[2])}.`,
        `The weakest is ${label(lo)} at ${money(lo[2])}, which may show where there is room to grow.`,
      ],
      takeaway: `The key takeaway is that results are strongest for ${label(hi)}.`,
    };
  }
  if (!field) return null;
  const col = en.column(field.col);
  if (col?.type === 'date') {
    const r = queryCategories(en, field, [value], cs);
    let pts = r.categories.map((c, i) => ({ label: c.label, y: r.series[0].data[i] })).filter((p): p is { label: string; y: number } => p.y !== null);
    const partial = field.part ? lastPeriodIncomplete(en.numbers(field.col, en.rows(cs)), field.part) : false;
    const skipped = partial ? pts[pts.length - 1]?.label : undefined;
    if (partial) pts = pts.slice(0, -1);
    if (pts.length < 2) return null;
    const [first, last] = [pts[0], pts[pts.length - 1]];
    const peak = pts.reduce((a, b) => (b.y > a.y ? b : a));
    const low = pts.reduce((a, b) => (b.y < a.y ? b : a));
    const ch = first.y !== 0 ? (last.y - first.y) / Math.abs(first.y) : null;
    const mk = pts.length >= 8 ? mannKendall(pts.map((p) => p.y)) : null;
    const trend = mk?.trend === 'up' ? 'a steady upward trend' : mk?.trend === 'down' ? 'a steady downward trend' : 'no steady long-term direction';
    // Two single periods can differ widely by chance, so a change is only claimed when the whole series supports it.
    const unsteady = mk !== null && !(ch !== null && ((mk.trend === 'up' && ch >= 0) || (mk.trend === 'down' && ch < 0)));
    return {
      headline: ch === null || unsteady ? `${name} peaked in ${peak.label} at ${money(peak.y)}` : `${name} ${ch >= 0 ? 'rose' : 'fell'} ${formatPct(Math.abs(ch))} from ${first.label} to ${last.label}`,
      bullets: [`Peak: ${peak.label}, ${money(peak.y)}`, `Lowest: ${low.label}, ${money(low.y)}`, `Latest: ${last.label}, ${money(last.y)}`],
      sentences: [
        `This chart follows ${name} over ${plural(pts.length, 'period')}, from ${first.label} to ${last.label}.`,
        unsteady
          ? `${name} moved between ${money(low.y)} and ${money(peak.y)} from period to period, without a steady rise or fall.`
          : `${name} moved from ${money(first.y)} to ${money(last.y)}${ch === null ? '' : `, a ${ch >= 0 ? 'rise' : 'fall'} of ${formatPct(Math.abs(ch))}`}.`,
        `The highest point was ${peak.label} at ${money(peak.y)}, and the lowest was ${low.label} at ${money(low.y)}.`,
        ...(mk ? [`Statistically, the data shows ${trend}.`] : []),
        ...(skipped ? [`${skipped} is not included in this comparison because the period is not finished.`] : []),
      ],
      takeaway: unsteady
        ? `The key takeaway is that ${name} changed from period to period with no steady direction, and peaked in ${peak.label}.`
        : `The key takeaway is that ${name} ended ${last.y >= first.y ? 'above' : 'below'} its starting level, with its peak in ${peak.label}.`,
    };
  }
  const r = queryCategories(en, field, [value], cs, { topN: 12 });
  // A blank means the value was never recorded, so it is reported separately and never ranked as a group.
  const pts = r.categories.map((c, i) => ({ label: c.label, y: r.series[0].data[i], other: c.isOther || c.key === null }))
    .filter((p): p is { label: string; y: number; other: boolean } => p.y !== null && !p.other).sort((a, b) => b.y - a.y);
  // One group has nothing to compare, which happens when a report is narrowed to a single area.
  if (pts.length < 2) return null;
  const top = pts[0];
  const bottom = pts[pts.length - 1];
  const whole = en.isAdditive(value) ? en.evaluate(value, cs) : null;
  const share = whole ? top.y / whole : null;
  const avg = mean(pts.map((p) => p.y));
  const twoShare = whole && pts[1] ? (top.y + pts[1].y) / whole : null;
  const ratio = bottom.y > 0 && pts.length > 1 ? top.y / bottom.y : null;
  const blank = whole && en.groupRows(cs, field).has(null) ? en.evaluate(value, [...cs, groupConstraint(field, null)]) : null;
  const blankShare = whole && blank ? blank / whole : null;
  return {
    headline: `${top.label} leads ${field.col}${share !== null ? ` with ${formatPct(share)}` : ''}`,
    bullets: [`Highest: ${top.label}, ${money(top.y)}`, ...(pts.length > 1 ? [`Lowest: ${bottom.label}, ${money(bottom.y)}`] : []), blankShare !== null ? `Not recorded: ${formatPct(blankShare)}` : twoShare !== null && pts.length > 2 ? `Top two make up ${formatPct(twoShare)}` : `Average per group: ${money(avg)}`],
    sentences: [
      `This chart compares ${name} across ${plural(pts.length, 'group')} of ${field.col}.`,
      `${top.label} is highest at ${money(top.y)}${share !== null ? `, which is ${formatPct(share)} of the total` : ''}.`,
      ...(blankShare !== null ? [`${formatPct(blankShare)} of the total has no ${field.col} recorded, so it is not ranked as a group.`] : []),
      ...(pts.length > 1 ? [`${bottom.label} is lowest at ${money(bottom.y)}${ratio !== null ? `, so ${top.label} is ${ratio.toFixed(1)} times larger` : ''}.`] : []),
      ...(twoShare !== null && pts.length > 2 ? [`Together, the top two groups make up ${formatPct(twoShare)} of the total, so results depend heavily on them.`] : []),
    ],
    takeaway: share !== null && share >= 0.5 ? `The key takeaway is that ${top.label} accounts for the majority of the total.` : `The key takeaway is that ${top.label} is the leading group in ${field.col}.`,
  };
}

export interface StoryOptions { detail: DetailLevel; filterText: string; actions?: string[] }

const OPENERS = ['To begin,', 'Next,', 'Moving on,', 'Turning to the next view,', 'Looking more closely,', 'Now,', 'In addition,', 'Taking this further,'];

const CHART_LIMIT: Record<DetailLevel, number> = { brief: 4, standard: 8, detailed: 14 };

export function buildStory(en: Engine, report: ReportDoc, findings: Finding[], cs: Constraint[], opts: StoryOptions): StoryScene[] {
  const { detail } = opts;
  const rows = en.rows(cs);
  const scenes: StoryScene[] = [];
  let n = 0;
  const add = (s: Omit<StoryScene, 'id'>) => scenes.push({ ...s, id: `scene${n++}` });
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  const take = (sentences: string[]) => (detail === 'brief' ? sentences.slice(0, 2) : detail === 'standard' ? sentences.slice(0, 3) : sentences).map(cap).join(' ');

  const { date } = pickPlan(en);
  const dates = date ? en.numbers(date, rows) : [];
  const range = dates.length ? `from ${new Date(dates.reduce((a, b) => (b < a ? b : a))).toISOString().slice(0, 10)} to ${new Date(dates.reduce((a, b) => (b > a ? b : a))).toISOString().slice(0, 10)}` : '';
  add({
    kind: 'title', kicker: 'Data report', title: report.title,
    bullets: [`${rows.length.toLocaleString('en-US')} records${range ? ` ${range}` : ''}${opts.filterText !== 'None' ? `. Showing ${opts.filterText}` : ''}`],
    narration: `Good day, and welcome to the statistical review of ${report.title}. This analysis covers ${rows.length.toLocaleString('en-US')} records${range ? ` ${range}` : ''}${opts.filterText !== 'None' ? `, filtered to ${opts.filterText}` : ''}. We will review the key figures, the main patterns, and the recommended next steps.`,
  });

  const seenKpi = new Set<string>();
  const kpis: StoryKpi[] = [];
  const kpiSentences: string[] = [];
  report.pages.flatMap((p) => p.visuals).filter((v) => v.type === 'kpi' && v.values[0]).forEach((v) => {
    if (seenKpi.has(v.title) || kpis.length >= 4) return;
    seenKpi.add(v.title);
    const first = v.values[0];
    if (v.range && first.kind === 'col') {
      const r = queryRange(en, first.col, visualConstraints(v, cs));
      if (r) {
        kpis.push({ label: v.title, value: r.label, note: r.common ? `Most common: ${r.common.label}` : undefined });
        kpiSentences.push(`Ages range from ${r.label} years.${r.common ? ` The most common age group is ${r.common.label}.` : ''}`);
      }
      return;
    }
    const k = queryKpi(en, v.values[0], visualConstraints(v, cs));
    const value = formatNumber(k.value, { format: k.format, currency: k.currency, compact: true });
    const change = k.change !== null ? `${k.change >= 0 ? 'Up' : 'Down'} ${formatPct(Math.abs(k.change))}` : undefined;
    kpis.push({ label: v.title, value, note: change });
    kpiSentences.push(`${v.title} is ${value}${change ? `, ${change.toLowerCase()} over the ${k.previousLabel}` : ''}.`);
  });
  if (kpis.length) add({ kind: 'kpis', kicker: 'At a glance', title: 'Key figures', bullets: [], kpis, narration: `Let us start with the key figures. ${kpiSentences.join(' ')}` });

  const seen = new Set<string>();
  const charts = report.pages.flatMap((p) => p.visuals).filter((v) => !['kpi', 'insights', 'table'].includes(v.type) && !seen.has(v.title) && seen.add(v.title));
  let count = 0;
  const told = new Set<string>();
  for (const v of charts) {
    if (count >= CHART_LIMIT[detail]) break;
    const d = describeVisual(en, v, cs);
    if (!d) continue;
    const message = d.headline.replace(/[\d.,%$€£₱]+[KMBT]?/g, '').toLowerCase();
    if (told.has(message)) continue;
    told.add(message);
    const opener = OPENERS[count % OPENERS.length];
    count++;
    const script = take(d.sentences);
    const linked = `${opener} ${script[0].toLowerCase()}${script.slice(1)}`;
    add({ kind: 'chart', kicker: v.title, title: cap(d.headline), bullets: d.bullets, narration: `${linked} ${cap(d.takeaway)}`, visualId: v.id });
  }

  const insights = generateInsights(en, cs, opts.filterText);
  if (insights.length) {
    const top = insights.slice(0, detail === 'brief' ? 3 : 5);
    add({ kind: 'findings', kicker: 'What stands out', title: 'Key findings', bullets: top.map((i) => i.headline), narration: `Now for the main statistical findings. ${top.map((i) => i.text).join(' ')}` });
  }

  const applied = findings.filter((f) => f.steps.length || f.changes.length);
  const fixed = applied.filter((f) => f.kind === 'wrong-calculation' || f.kind === 'impossible-age').reduce((s, f) => s + f.changes.length, 0);
  const removed = applied.flatMap((f) => f.steps).reduce((s, x) => s + (x.op === 'excludeRows' ? x.rows.length : 0), 0);
  if (fixed || removed) {
    const parts = [fixed ? plural(fixed, 'calculation') + ' corrected' : '', removed ? plural(removed, 'row') + ' removed' : ''].filter(Boolean);
    add({ kind: 'quality', kicker: 'Data accuracy', title: 'The numbers were checked first', bullets: parts, narration: `Before this analysis, the data was checked for errors. ${parts.join(' and ')} so the results are based on accurate figures.` });
  }

  if (opts.actions?.length) {
    const list = opts.actions.slice(0, 4);
    add({ kind: 'actions', kicker: 'Next steps', title: 'Recommended actions', bullets: list, narration: `Based on this analysis, here are the recommended next steps. ${list.map((a) => (/[.!?]$/.test(a) ? a : `${a}.`)).join(' ')}` });
  }

  add({ kind: 'closing', kicker: 'Summary', title: 'Thank you', bullets: insights[0] ? [insights[0].headline] : [], narration: insights[0] ? `In summary, the main point to remember is this. ${insights[0].text} Thank you for watching.` : 'In summary, this concludes the statistical review. Thank you for watching.' });
  return scenes;
}
