// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { bucketAdd, bucketLabel, defaultAgg, Engine, groupConstraint, lastPeriodIncomplete } from './engine';
import { formatNumber, formatPct } from './format';
import { generateInsights, newId, periodFor, pickPlan, profileTable } from './insights';
import { queryCategories, queryForecast, type ReportDoc, type Visual, type VisualType } from './report';
import { pearson } from './stats';
import type { Agg, Cell, Column, Constraint, DatePart, FieldRef, Finding, Measure, ValueRef } from './types';

/**
 * The report assistant. It runs entirely on this device and knows only the current report.
 * Answers are calculated by the report engine, so it cannot invent a number.
 */

export interface AssistantMemory {
  /** Words taught by the person, such as "turnover" meaning "Net Sales". */
  synonyms: Record<string, string>;
  dismissed: string[];
  asked: Record<string, number>;
}

export const emptyMemory = (): AssistantMemory => ({ synonyms: {}, dismissed: [], asked: {} });

export type AssistantAction =
  | { type: 'addChart'; label: string; visual: Visual }
  | { type: 'addMeasure'; label: string; measure: Measure }
  | { type: 'filter'; label: string; field: FieldRef; values: Cell[] }
  | { type: 'forecast'; label: string; visualId: string }
  | { type: 'openData'; label: string }
  | { type: 'remember'; label: string; word: string; column: string };

export interface AssistantReply {
  text: string;
  table?: { headers: string[]; rows: string[][] };
  actions: AssistantAction[];
  followUps: string[];
}

export interface Suggestion { id: string; title: string; why: string; priority: number; action?: AssistantAction }

export interface AssistantContext {
  en: Engine;
  report: ReportDoc;
  findings: Finding[];
  cs: Constraint[];
  memory: AssistantMemory;
}

const tokens = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s%]/gu, ' ').split(/\s+/).filter(Boolean);
const stem = (w: string) => (w.length > 3 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'for', 'by', 'to', 'is', 'are', 'was', 'were', 'what', 'which', 'who', 'how', 'me', 'my', 'and', 'or', 'with', 'per', 'each', 'do', 'does', 'did', 'it', 'this', 'that', 'show', 'give', 'tell', 'much', 'many', 'our', 'we', 'i']);

interface ColumnHit { col: Column; at: number; score: number }

/** Finds the columns a question mentions, using names, partial names, and taught words. */
export function findColumns(q: string, en: Engine, memory: AssistantMemory): Column[] {
  const lower = ` ${tokens(q).map(stem).join(' ')} `;
  const hits: ColumnHit[] = [];
  for (const [word, target] of Object.entries(memory.synonyms)) {
    const at = lower.indexOf(` ${tokens(word).map(stem).join(' ')} `);
    const col = en.column(target);
    if (at >= 0 && col) hits.push({ col, at, score: 100 });
  }
  for (const col of en.table.columns) {
    const parts = tokens(col.name).map(stem);
    const full = lower.indexOf(` ${parts.join(' ')} `);
    if (full >= 0) { hits.push({ col, at: full, score: 50 + parts.length }); continue; }
    const words = parts.filter((p) => !STOP.has(p) && p.length > 2);
    const found = words.filter((p) => lower.includes(` ${p} `));
    if (found.length) hits.push({ col, at: lower.indexOf(` ${found[0]} `), score: (10 * found.length) / words.length + (col.role === 'measure' ? 1 : 0) });
  }
  const best = new Map<string, ColumnHit>();
  hits.sort((a, b) => b.score - a.score).forEach((h) => {
    // A partial word points at its best column only: "sales" should not select every sales column.
    if (h.score < 50 && [...best.values()].some((x) => x.at === h.at)) return;
    if (!best.has(h.col.name)) best.set(h.col.name, h);
  });
  return [...best.values()].sort((a, b) => a.at - b.at).map((h) => h.col);
}

/** Finds values such as "North" or "Online" mentioned in the question. */
export function findValues(q: string, en: Engine): { col: string; value: Cell }[] {
  const lower = ` ${tokens(q).join(' ')} `;
  const out: { col: string; value: Cell }[] = [];
  for (const col of en.table.columns.filter((c) => c.type === 'category')) {
    const seen = new Set(col.values);
    if (seen.size > 300) continue;
    seen.forEach((v) => { if (typeof v === 'string' && v.length > 1 && lower.includes(` ${tokens(v).join(' ')} `)) out.push({ col: col.name, value: v }); });
  }
  return out;
}

const MONTH = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function findPeriod(q: string, en: Engine): { constraint: Constraint; label: string } | null {
  const date = en.firstDateColumn;
  if (!date) return null;
  const s = q.toLowerCase();
  const year = s.match(/\b(19|20)\d{2}\b/)?.[0];
  if (!year) return null;
  const y = Number(year);
  const quarter = s.match(/\bq([1-4])\b/)?.[1];
  if (quarter) { const key = Date.UTC(y, (Number(quarter) - 1) * 3, 1); return { constraint: groupConstraint({ col: date, part: 'quarter' }, key), label: bucketLabel(key, 'quarter') }; }
  const m = MONTH.findIndex((x) => new RegExp(`\\b${x}[a-z]*\\b`).test(s));
  if (m >= 0) { const key = Date.UTC(y, m, 1); return { constraint: groupConstraint({ col: date, part: 'month' }, key), label: bucketLabel(key, 'month') }; }
  return { constraint: groupConstraint({ col: date, part: 'year' }, Date.UTC(y, 0, 1)), label: year };
}

function askedAgg(q: string): Agg | null {
  const s = q.toLowerCase();
  if (/\b(average|avg|mean)\b/.test(s)) return 'avg';
  if (/\bmedian\b/.test(s)) return 'median';
  if (/\b(max|maximum|highest value|largest value|biggest value)\b/.test(s)) return 'max';
  if (/\b(min|minimum|smallest value|lowest value)\b/.test(s)) return 'min';
  if (/\b(total|sum|overall)\b/.test(s)) return 'sum';
  return null;
}

const asValue = (c: Column, agg: Agg | null): ValueRef => ({ kind: 'col', col: c.name, agg: agg && c.type === 'number' ? agg : defaultAgg(c) });
/** Answers keep cents, so a figure can be compared directly with the source file. */
const fmtFor = (en: Engine, v: ValueRef) => (x: number | null) => {
  const f = en.valueFormat(v);
  return f.format === 'number' && x !== null ? x.toLocaleString('en-US', { maximumFractionDigits: 2 }) : formatNumber(x, f);
};

function makeVisual(type: VisualType, title: string, axis: FieldRef[], values: ValueRef[], extra: Partial<Visual> = {}): Visual {
  return { id: newId(), type, title, axis, values, tooltips: [], ...extra };
}

const dateAxis = (col: string, part: DatePart): { axis: FieldRef[]; drillLevel: number } => {
  const parts: DatePart[] = ['year', 'quarter', 'month', 'day'];
  return { axis: parts.map((p) => ({ col, part: p })), drillLevel: Math.max(0, parts.indexOf(part === 'week' ? 'day' : part)) };
};

/** Compares the last two complete periods and finds which groups caused the change. */
export function explainChange(ctx: AssistantContext, value: ValueRef): AssistantReply | null {
  const { en, cs } = ctx;
  const { date, dims } = pickPlan(en);
  if (!date) return null;
  let part = periodFor(en, date, cs);
  if (part === 'year') part = 'quarter';
  const field: FieldRef = { col: date, part };
  const keys = [...en.groupRows(cs, field).keys()].filter((k): k is number => typeof k === 'number').sort((a, b) => a - b);
  const usable = lastPeriodIncomplete(en.numbers(date, en.rows(cs)), part) ? keys.slice(0, -1) : keys;
  if (usable.length < 2) return null;
  const cur = usable[usable.length - 1];
  const prev = bucketAdd(cur, part, -1);
  if (!usable.includes(prev)) return null;
  const f = fmtFor(en, value);
  const at = (k: number, extra: Constraint[] = []) => en.evaluate(value, [...cs, ...extra, groupConstraint(field, k)]) ?? 0;
  const [a, b] = [at(cur), at(prev)];
  const delta = a - b;
  const name = en.valueLabel(value);
  const rows: string[][] = [];
  let lead = '';
  for (const dim of dims.slice(0, 3)) {
    const groups = [...en.groupRows(cs, { col: dim }).keys()].filter((k) => k !== null);
    const parts = groups.map((g) => { const e = [groupConstraint({ col: dim }, g)]; return { g, d: at(cur, e) - at(prev, e) }; }).sort((x, y) => (delta >= 0 ? y.d - x.d : x.d - y.d));
    const main = parts[0];
    if (!main || Math.sign(main.d) !== Math.sign(delta) || delta === 0) continue;
    rows.push([dim, String(main.g), f(main.d), formatPct(main.d / delta, 0)]);
    if (!lead) lead = ` The largest contribution came from ${main.g} in ${dim}, which accounts for ${formatPct(main.d / delta, 0)} of the change.`;
  }
  const direction = delta >= 0 ? 'rose' : 'fell';
  return {
    text: `${name} ${direction} by ${f(Math.abs(delta))} from ${bucketLabel(prev, part)} to ${bucketLabel(cur, part)}, moving from ${f(b)} to ${f(a)}${b ? ` (${formatPct(Math.abs(delta / b))})` : ''}.${lead}`,
    table: rows.length ? { headers: ['Field', 'Main driver', 'Change', 'Share of change'], rows } : undefined,
    actions: [], followUps: ['What should I improve?', 'Show the trend'],
  };
}

/** Practical improvements for this report, ranked by importance. */
export function suggestImprovements(ctx: AssistantContext): Suggestion[] {
  const { en, report, findings, cs, memory } = ctx;
  const out: Suggestion[] = [];
  const t = en.table;
  const { metric, date, dims } = pickPlan(en);
  const visuals = report.pages.flatMap((p) => p.visuals);
  const add = (s: Suggestion) => { if (!memory.dismissed.includes(s.id)) out.push(s); };

  const review = findings.filter((f) => !f.auto && f.severity !== 'info');
  if (review.length) add({ id: 'review', priority: 95, title: `Review ${review.length} data ${review.length === 1 ? 'issue' : 'issues'}`, why: `${review[0].title}. These could not be corrected safely without your decision.`, action: { type: 'openData', label: 'Open data checks' } });
  for (const p of profileTable(t).filter((x) => x.missingPct >= 0.1 && x.missingPct < 1).slice(0, 2)) {
    add({ id: `missing:${p.name}`, priority: 85, title: `Complete the blanks in ${p.name}`, why: `${formatPct(p.missingPct, 0)} of this column is blank, so results using it are less reliable.`, action: { type: 'openData', label: 'Open data' } });
  }
  if (metric && dims[0]) {
    const whole = en.evaluate(metric, cs);
    for (const dim of dims.slice(0, 3)) {
      if (!whole || !en.isAdditive(metric)) break;
      const top = queryCategories(en, { col: dim }, [metric], cs, { topN: 50 });
      const i = top.series[0]?.data.findIndex((x) => x !== null) ?? -1;
      const lead = i >= 0 ? top.series[0].data[i]! / whole : 0;
      if (lead >= 0.5 && top.categories.length > 2) add({ id: `concentration:${dim}`, priority: 75, title: `Reduce reliance on ${top.categories[i].label}`, why: `${top.categories[i].label} makes up ${formatPct(lead)} of ${en.valueLabel(metric)}, so a drop there would affect the whole result.` });
    }
  }
  if (metric && date) {
    const change = explainChange(ctx, metric);
    if (change?.table && /\bfell\b/.test(change.text)) add({ id: 'decline', priority: 90, title: `Investigate the drop in ${en.valueLabel(metric)}`, why: change.text });
    const trend = visuals.find((v) => v.type === 'line' && !v.legend && !v.forecast);
    const months = new Set(en.keys({ col: date, part: 'month' }) as ArrayLike<Cell> as Cell[]).size;
    if (trend && months >= 12) add({ id: 'forecast', priority: 55, title: 'Add a forecast to the trend', why: `There are ${months} months of history, which is enough to project the next periods.`, action: { type: 'forecast', label: 'Add forecast', visualId: trend.id } });
    if (!report.measures.some((m) => /PREVIOUSYEAR/i.test(m.expr)) && metric.kind === 'col') {
      const col = metric.col;
      add({ id: 'yoy', priority: 50, title: 'Track year-over-year growth', why: 'A growth measure shows whether results are improving like for like.', action: { type: 'addMeasure', label: 'Add measure', measure: { name: `${col} YoY %`, expr: `DIVIDE(SUM([${col}]) - PREVIOUSYEAR(SUM([${col}])), PREVIOUSYEAR(SUM([${col}])))`, format: 'percent' } } });
    }
  }
  const revenue = t.columns.find((c) => c.type === 'number' && /(net sales|revenue|sales|income)/i.test(c.name));
  const cost = t.columns.find((c) => c.type === 'number' && /(cost|expense|cogs)/i.test(c.name));
  if (revenue && cost && !report.measures.some((m) => /margin/i.test(m.name))) {
    add({ id: 'margin', priority: 65, title: 'Add a profit margin measure', why: `${revenue.name} and ${cost.name} are both available, so margin can be tracked.`, action: { type: 'addMeasure', label: 'Add measure', measure: { name: 'Profit margin', expr: `DIVIDE(SUM([${revenue.name}]) - SUM([${cost.name}]), SUM([${revenue.name}]))`, format: 'percent' } } });
  }
  if (metric && !t.columns.some((c) => /(target|budget|plan|goal|quota)/i.test(c.name))) add({ id: 'target', priority: 45, title: 'Add a target or budget column', why: 'Results can then be compared with goals, not only with the past.' });
  const crowded = report.pages.find((p) => p.visuals.length > 10);
  if (crowded) add({ id: `crowded:${crowded.id}`, priority: 40, title: `Simplify the ${crowded.name} page`, why: `It has ${crowded.visuals.length} visuals. Moving some to another page makes the message clearer.` });
  if (dims[1] && metric && !visuals.some((v) => v.type === 'heatmap')) add({ id: 'heatmap', priority: 35, title: `Compare ${dims[0]} with ${dims[1]}`, why: 'A heatmap reveals strong and weak combinations.', action: { type: 'addChart', label: 'Add heatmap', visual: makeVisual('heatmap', `${en.valueLabel(metric)}: ${dims[0]} × ${dims[1]}`, [{ col: dims[0] }], [metric], { legend: { col: dims[1] } }) } });
  return out.sort((a, b) => b.priority - a.priority);
}

interface Doc { text: string; words: Map<string, number> }

function knowledge(ctx: AssistantContext): Doc[] {
  const { en, report, findings, cs } = ctx;
  const texts = [
    ...generateInsights(en, cs).map((i) => `${i.headline}. ${i.text}`),
    ...findings.map((f) => `${f.title}. ${f.detail}`),
    ...profileTable(en.table).map((p) => `${p.name} is a ${p.type} column with ${p.count.toLocaleString('en-US')} values, ${p.missing.toLocaleString('en-US')} blank, and ${p.distinct.toLocaleString('en-US')} distinct values.${p.mean !== undefined ? ` Its average is ${formatNumber(p.mean)}, its lowest value is ${formatNumber(p.min)}, and its highest value is ${formatNumber(p.max)}.` : ''}`),
    ...report.pages.map((p) => `The ${p.name} page contains ${p.visuals.map((v) => v.title).join(', ')}.`),
    ...report.measures.map((m) => `The measure ${m.name} is calculated as ${m.expr}.`),
  ];
  return texts.map((text) => { const words = new Map<string, number>(); tokens(text).map(stem).filter((w) => !STOP.has(w)).forEach((w) => words.set(w, (words.get(w) ?? 0) + 1)); return { text, words }; });
}

/** Finds the facts in this report closest to a question (TF-IDF cosine similarity). */
export function searchReport(question: string, ctx: AssistantContext): { text: string; score: number }[] {
  const docs = knowledge(ctx);
  const df = new Map<string, number>();
  docs.forEach((d) => d.words.forEach((_, w) => df.set(w, (df.get(w) ?? 0) + 1)));
  const idf = (w: string) => Math.log(1 + docs.length / (1 + (df.get(w) ?? 0)));
  const q = new Map<string, number>();
  tokens(question).map(stem).filter((w) => !STOP.has(w)).forEach((w) => q.set(w, (q.get(w) ?? 0) + 1));
  const qNorm = Math.sqrt([...q].reduce((s, [w, c]) => s + (c * idf(w)) ** 2, 0)) || 1;
  return docs.map((d) => {
    let dot = 0;
    let norm = 0;
    d.words.forEach((c, w) => { const x = c * idf(w); norm += x * x; if (q.has(w)) dot += x * q.get(w)! * idf(w); });
    return { text: d.text, score: dot / (Math.sqrt(norm) * qNorm || 1) };
  }).filter((d) => d.score > 0.12).sort((a, b) => b.score - a.score).slice(0, 3);
}

const STARTERS = ['Summarize this report', 'What should I improve?', 'Why did sales change?', 'Show the top 5 by category'];

/** Answers one question about the current report. */
export function askAssistant(question: string, ctx: AssistantContext): AssistantReply {
  const { en, memory } = ctx;
  const q = question.trim();
  const s = q.toLowerCase();
  const plan = pickPlan(en);
  const reply = (text: string, extra: Partial<AssistantReply> = {}): AssistantReply => ({ text, actions: [], followUps: [], ...extra });

  const teach = q.match(/^(?:please\s+)?(?:remember|learn|note)(?: that)?\s+["']?(.+?)["']?\s+(?:means|is|=|refers to)\s+["']?(.+?)["']?\.?$/i);
  if (teach) {
    const target = findColumns(teach[2], en, memory)[0];
    if (!target) return reply(`I could not find a column called "${teach[2]}" in this report.`);
    return reply(`Understood. In this report, "${teach[1]}" now means ${target.name}.`, { actions: [{ type: 'remember', label: 'Saved', word: teach[1].toLowerCase(), column: target.name }] });
  }
  if (!q || /^(hi|hello|hey|help|what can you do)\b/.test(s)) {
    return reply('I can answer questions about this report, explain changes, create charts, apply filters, and suggest improvements. I only use the data in this report.', { followUps: STARTERS });
  }
  if (/\b(improve|improvement|suggest|suggestion|recommend|next step|what should|better)\b/.test(s)) {
    const list = suggestImprovements(ctx).slice(0, 5);
    if (!list.length) return reply('This report is in good shape. I have no further suggestions right now.');
    return reply('Here is what I recommend, starting with the most important:', { table: { headers: ['Suggestion', 'Why it matters'], rows: list.map((x) => [x.title, x.why]) }, actions: list.flatMap((x) => (x.action ? [x.action] : [])) });
  }
  if (/\b(error|errors|mistake|correct|corrected|corrections|quality|wrong|fixed|clean)\b/.test(s)) {
    if (!ctx.findings.length) return reply('Every data check passed, and no corrections were needed.');
    return reply(`The data checks found ${ctx.findings.length} ${ctx.findings.length === 1 ? 'item' : 'items'}:`, { table: { headers: ['Check', 'Affected'], rows: ctx.findings.slice(0, 8).map((f) => [f.title, f.count.toLocaleString('en-US')]) }, actions: [{ type: 'openData', label: 'Open data checks' }] });
  }
  if (/\b(summar|summary|overview|about this report|explain (the|this) report)/.test(s)) {
    const top = generateInsights(en, ctx.cs).slice(0, 4);
    return reply(top.length ? top.map((i) => i.text).join(' ') : `This report contains ${en.rows(ctx.cs).length.toLocaleString('en-US')} rows.`, { followUps: ['What should I improve?', 'Why did it change?'] });
  }

  const cols = findColumns(q, en, memory);
  const nums = cols.filter((c) => c.type === 'number');
  const groups = cols.filter((c) => c.type === 'category' || c.type === 'boolean');
  const agg = askedAgg(q);
  const value: ValueRef | undefined = nums[0] ? asValue(nums[0], agg) : plan.metric;
  const values = findValues(q, en).filter((v) => !cols.some((c) => c.name === v.col && tokens(v.col).join(' ') === tokens(String(v.value)).join(' ')));
  const period = findPeriod(q, en);
  const scope: Constraint[] = [...ctx.cs, ...values.map((v) => groupConstraint({ col: v.col }, v.value)), ...(period ? [period.constraint] : [])];
  const scopeText = [...values.map((v) => String(v.value)), ...(period ? [period.label] : [])].join(', ');
  const within = scopeText ? ` for ${scopeText}` : '';

  if (/\b(why|reason|cause|caused|driver|drivers)\b/.test(s) && value) {
    return explainChange({ ...ctx, cs: scope }, value) ?? reply('I need at least two complete time periods to explain a change.');
  }
  if (/\b(forecast|predict|projection|future|next (month|quarter|year))\b/.test(s) && value) {
    const date = plan.date;
    if (!date) return reply('A forecast needs a date column.');
    const r = queryCategories(en, { col: date, part: 'month' }, [value], scope);
    const fc = queryForecast(en, r);
    if (!fc) return reply('At least six periods of history are needed for a forecast.');
    const f = fmtFor(en, value);
    const line = [...ctx.report.pages.flatMap((p) => p.visuals)].find((v) => v.type === 'line' && !v.legend);
    return reply(`The forecast for ${en.valueLabel(value)}${within} uses ${fc.fc.method}.${fc.fc.mape !== null ? ` In a backtest its average error was ${formatPct(fc.fc.mape)}.` : ''}`, {
      table: { headers: ['Period', 'Forecast', '95% range'], rows: fc.labels.map((l, i) => [l, f(fc.fc.values[i]), `${f(fc.fc.low[i])} to ${f(fc.fc.high[i])}`]) },
      actions: line ? [{ type: 'forecast', label: 'Show on the chart', visualId: line.id }] : [],
    });
  }
  if (/\b(correlat|relationship|related|relate)/.test(s)) {
    if (nums.length < 2) return reply('Name two numeric columns, for example: is Quantity related to Discount?');
    const [a, b] = [nums[0], nums[1]];
    const rows = en.rows(scope);
    const [xs, ys]: number[][] = [[], []];
    rows.forEach((r) => { const [x, y] = [a.values[r], b.values[r]]; if (typeof x === 'number' && typeof y === 'number') { xs.push(x); ys.push(y); } });
    const c = pearson(xs, ys);
    if (Number.isNaN(c.r)) return reply('There is not enough variation in those columns to measure a relationship.');
    const size = Math.abs(c.r) >= 0.7 ? 'strong' : Math.abs(c.r) >= 0.4 ? 'moderate' : Math.abs(c.r) >= 0.2 ? 'weak' : 'very weak';
    return reply(`${a.name} and ${b.name} have a ${size} ${c.r >= 0 ? 'positive' : 'negative'} correlation of ${c.r.toFixed(2)} across ${c.n.toLocaleString('en-US')} rows${c.p < 0.05 ? '' : ', which is not statistically significant'}. This does not prove that one causes the other.`, {
      actions: [{ type: 'addChart', label: 'Add scatter chart', visual: makeVisual('scatter', `${a.name} vs ${b.name}`, [], [asValue(a, 'sum'), asValue(b, 'sum')]) }],
    });
  }
  if (/^(filter|only show|focus on|limit to)\b/.test(s) && values.length) {
    const v = values[0];
    return reply(`I can filter the report to ${v.value}.`, { actions: [{ type: 'filter', label: `Filter to ${v.value}`, field: { col: v.col }, values: values.filter((x) => x.col === v.col).map((x) => x.value) }] });
  }

  const wantsChart = /\b(chart|graph|plot|visual|diagram|create|make|build|add)\b/.test(s);
  const typeAsked: VisualType | null = /\b(pie|donut)\b/.test(s) ? 'donut' : /\bline\b/.test(s) ? 'line' : /\barea\b/.test(s) ? 'area' : /\bheatmap\b/.test(s) ? 'heatmap' : /\btreemap\b/.test(s) ? 'treemap' : /\bpareto\b/.test(s) ? 'pareto' : /\bhistogram\b/.test(s) ? 'histogram' : /\bcolumn\b/.test(s) ? 'column' : /\bbar\b/.test(s) ? 'bar' : null;
  const wantsTrend = /\b(trend|over time|monthly|quarterly|yearly|by month|by quarter|by year|growth)\b/.test(s);

  if (wantsTrend && value && plan.date) {
    const part: DatePart = /quarter/.test(s) ? 'quarter' : /year/.test(s) ? 'year' : /month/.test(s) ? 'month' : periodFor(en, plan.date, scope);
    const r = queryCategories(en, { col: plan.date, part }, [value], scope);
    const pts = r.categories.map((c, i) => ({ l: c.label, y: r.series[0].data[i] })).filter((p): p is { l: string; y: number } => p.y !== null);
    if (pts.length < 2) return reply(`There is not enough data to show a trend${within}.`);
    const f = fmtFor(en, value);
    const ch = pts[0].y ? (pts[pts.length - 1].y - pts[0].y) / Math.abs(pts[0].y) : null;
    const peak = pts.reduce((a, b) => (b.y > a.y ? b : a));
    return reply(`${en.valueLabel(value)}${within} went from ${f(pts[0].y)} in ${pts[0].l} to ${f(pts[pts.length - 1].y)} in ${pts[pts.length - 1].l}${ch !== null ? `, a ${ch >= 0 ? 'rise' : 'fall'} of ${formatPct(Math.abs(ch))}` : ''}. The peak was ${f(peak.y)} in ${peak.l}.`, {
      table: { headers: ['Period', en.valueLabel(value)], rows: pts.slice(-8).map((p) => [p.l, f(p.y)]) },
      actions: [{ type: 'addChart', label: 'Add this chart', visual: makeVisual(typeAsked === 'area' ? 'area' : 'line', `${en.valueLabel(value)} over time`, dateAxis(plan.date, part).axis, [value], { drillLevel: dateAxis(plan.date, part).drillLevel }) }],
    });
  }

  if (/\b(compare|versus|vs)\b/.test(s) && values.length >= 2 && value) {
    const f = fmtFor(en, value);
    const list = values.slice(0, 6).map((v) => ({ v, y: en.evaluate(value, [...ctx.cs, ...(period ? [period.constraint] : []), groupConstraint({ col: v.col }, v.value)]) ?? 0 })).sort((a, b) => b.y - a.y);
    const gap = list[0].y - list[1].y;
    return reply(`${list[0].v.value} is ahead of ${list[1].v.value} by ${f(gap)}${list[1].y ? ` (${formatPct(gap / Math.abs(list[1].y))})` : ''}.`, { table: { headers: [list[0].v.col, en.valueLabel(value)], rows: list.map((x) => [String(x.v.value), f(x.y)]) } });
  }

  const dim = groups.find((g) => !values.some((v) => v.col === g.name)) ?? groups[0];
  const ranking = /\b(top|best|highest|largest|biggest|most|leading|bottom|worst|lowest|smallest|least|rank|ranking)\b/.test(s);
  const wantsShare = /(\bshare\b|percent|%|proportion)/.test(s);
  const group = dim ?? (ranking || wantsChart || wantsShare ? en.column(plan.dims[0] ?? '') : undefined);
  if ((ranking || wantsChart || wantsShare || /\bby\b/.test(s)) && group && value) {
    const n = Number(s.match(/\b(?:top|bottom|best|worst)\s+(\d{1,2})\b/)?.[1] ?? 5);
    const lowest = /\b(bottom|worst|lowest|smallest|least)\b/.test(s);
    const r = queryCategories(en, { col: group.name }, [value], scope, { topN: 200 });
    const all = r.categories.map((c, i) => ({ l: c.label, y: r.series[0].data[i] })).filter((p): p is { l: string; y: number } => p.y !== null).sort((a, b) => (lowest ? a.y - b.y : b.y - a.y));
    if (!all.length) return reply(`There is no data for that question${within}.`);
    const f = fmtFor(en, value);
    const whole = en.isAdditive(value) ? en.evaluate(value, scope) : null;
    const list = all.slice(0, n);
    const lead = list[0];
    return reply(`${lead.l} has the ${lowest ? 'lowest' : 'highest'} ${en.valueLabel(value)}${within} at ${f(lead.y)}${whole ? `, or ${formatPct(lead.y / whole)} of the total` : ''}.`, {
      table: { headers: [group.name, en.valueLabel(value), ...(whole ? ['% of total'] : [])], rows: list.map((p) => [p.l, f(p.y), ...(whole ? [formatPct(p.y / whole)] : [])]) },
      actions: [{ type: 'addChart', label: 'Add this chart', visual: makeVisual(typeAsked ?? (all.length <= 6 && wantsShare ? 'donut' : 'bar'), `${en.valueLabel(value)} by ${group.name}`, [{ col: group.name }], [value], typeAsked === 'heatmap' && groups[1] ? { legend: { col: groups[1].name } } : {}) }],
    });
  }

  if (/\b(how many|count|number of|records|rows)\b/.test(s) && !nums.length) {
    return reply(`There are ${en.rows(scope).length.toLocaleString('en-US')} rows${within}.`);
  }
  if ((agg || nums.length || values.length || period) && value) {
    const v = nums[0] ? asValue(nums[0], agg) : value;
    const result = en.evaluate(v, scope);
    if (result === null) return reply(`There is no data for that question${within}.`);
    return reply(`${en.valueLabel(v)}${within} is ${fmtFor(en, v)(result)}, based on ${en.rows(scope).length.toLocaleString('en-US')} rows.`, { followUps: ['Show the trend', 'What should I improve?'] });
  }

  const facts = searchReport(q, ctx);
  if (facts.length) return reply(facts[0].text, { followUps: STARTERS.slice(0, 2) });
  const word = tokens(q).find((w) => !STOP.has(w) && w.length > 3);
  return reply(`I could not find that in this report.${word ? ` If "${word}" is another name for a column, tell me: remember that ${word} means [column name].` : ''}`, { followUps: STARTERS });
}

/** Questions this person asks most often appear first. */
export function suggestedQuestions(memory: AssistantMemory): string[] {
  const learned = Object.entries(memory.asked).sort((a, b) => b[1] - a[1]).map(([q]) => q).slice(0, 2);
  return [...new Set([...learned, ...STARTERS])].slice(0, 4);
}
