// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import type { EChartsCoreOption } from 'echarts/core';
import { Engine, lastPeriodIncomplete } from '../core/engine';
import { escapeHtml, formatNumber, formatPct } from '../core/format';
import {
  activeField, OTHER, queryBox, queryCategories, queryForecast, queryHeatmap, queryHistogram, queryScatter, queryVariance,
  tooltipStats, visualConstraints, type CategoryResult, type Selection, type Visual,
} from '../core/report';
import type { Cell, Constraint, FieldRef, ValueRef } from '../core/types';

export interface VizTheme {
  dark: boolean; surface: string; ink: string; secondary: string; muted: string; grid: string; axis: string;
  series: string[]; neutral: string; up: string; down: string; seq: string[];
}

const SERIES = {
  standard: {
    light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
    dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'],
  },
  // Same validated hues in a warm-first order for reports that want a different look.
  bright: {
    light: ['#eb6834', '#2a78d6', '#eda100', '#1baf7a', '#6250d6', '#e87ba4', '#008300', '#e34948'],
    dark: ['#d95926', '#3987e5', '#c98500', '#199e70', '#9085e9', '#d55181', '#0ca30c', '#e66767'],
  },
};

export function vizTheme(dark: boolean, palette: keyof typeof SERIES): VizTheme {
  return dark
    ? { dark, surface: '#1a1a19', ink: '#f0efec', secondary: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', axis: '#383835', series: SERIES[palette].dark, neutral: '#5b5a55', up: '#3987e5', down: '#e66767', seq: ['#16263c', '#184f95', '#3987e5', '#9ec5f4'] }
    : { dark, surface: '#fcfcfb', ink: '#0b0b0b', secondary: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', series: SERIES[palette].light, neutral: '#c3c2b7', up: '#2a78d6', down: '#e34948', seq: ['#cde2fb', '#86b6ef', '#2a78d6', '#0d366b'] };
}

/* Color follows the entity, so filtering never repaints the survivors. */
const colorOrder = new WeakMap<Engine, Map<string, Map<Cell, number>>>();

function entityColor(en: Engine, field: FieldRef, key: Cell, t: VizTheme): string {
  if (key === OTHER) return t.neutral;
  let byField = colorOrder.get(en);
  if (!byField) { byField = new Map(); colorOrder.set(en, byField); }
  const id = `${field.col}|${field.part ?? ''}`;
  let order = byField.get(id);
  if (!order) {
    const counts = [...en.groupRows([], field).entries()].map(([k, r]) => [k, r.length] as const).sort((a, b) => b[1] - a[1]);
    order = new Map(counts.map(([k], i) => [k, i]));
    byField.set(id, order);
  }
  const i = order.get(key) ?? 0;
  return i < 8 ? t.series[i] : t.neutral;
}

function axisBase(t: VizTheme) {
  return {
    axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false },
    axisLabel: { color: t.secondary, fontSize: 11, hideOverlap: true },
    splitLine: { lineStyle: { color: t.grid, type: 'solid' as const } },
    nameTextStyle: { color: t.muted, fontSize: 11 },
  };
}

const tipBase = (t: VizTheme) => ({
  backgroundColor: t.surface, borderColor: t.axis, borderWidth: 1, padding: 0, confine: true,
  textStyle: { color: t.ink, fontSize: 12 }, extraCssText: 'border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);',
});

function sparkSvg(points: number[], color: string): string {
  if (points.length < 2) return '';
  const [w, h] = [188, 30];
  const min = Math.min(...points);
  const max = Math.max(...points);
  const path = points.map((p, i) => `${(i / (points.length - 1)) * w},${h - 3 - ((p - min) / (max - min || 1)) * (h - 6)}`).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" points="${path}"/></svg>`;
}

function row(label: string, value: string, t: VizTheme) {
  return `<div style="display:flex;justify-content:space-between;gap:20px;padding:2px 0"><span style="color:${t.secondary}">${escapeHtml(label)}</span><b style="font-variant-numeric:tabular-nums;color:${t.ink}">${escapeHtml(value)}</b></div>`;
}

/** Exact value, record count, share of total, variance from average, and sparkline. */
function richTip(en: Engine, v: Visual, field: FieldRef, key: Cell, value: ValueRef, cs: Constraint[], siblings: (number | null)[], t: VizTheme): string {
  const s = tooltipStats(en, v, field, key, value, cs, siblings);
  const f = en.valueFormat(value);
  let html = `<div style="padding:10px 12px;min-width:212px"><div style="font-weight:600;margin-bottom:6px;color:${t.ink}">${escapeHtml(s.label)}</div>`;
  html += row(en.valueLabel(value), formatNumber(s.value, f), t);
  html += row('Records', s.count.toLocaleString('en-US'), t);
  if (s.share !== null) html += row('% of total', formatPct(s.share), t);
  if (s.varianceFromAvg !== null) html += row('vs average', `${s.varianceFromAvg >= 0 ? '+' : ''}${formatPct(s.varianceFromAvg)}`, t);
  s.extras.forEach((x) => { html += row(x.label, formatNumber(x.value, x), t); });
  if (s.spark.length > 1) html += `<div style="margin-top:6px;color:${t.muted};font-size:11px">Monthly trend</div>${sparkSvg(s.spark, t.series[0])}`;
  return `${html}</div>`;
}

export interface ChartMeta {
  field?: FieldRef;
  keys?: Cell[];
  labels?: string[];
  note?: string;
  empty?: boolean;
}

export interface ChartBuild { option: EChartsCoreOption; meta: ChartMeta }

const empty = (note = 'No data for the current filters'): ChartBuild => ({ option: {}, meta: { empty: true, note } });

const hasData = (r: CategoryResult) => r.categories.length > 0 && r.series.some((s) => s.data.some((d) => d !== null));

function legendOf(names: string[], t: VizTheme) {
  return names.length > 1 ? { type: 'scroll', top: 0, left: 0, itemWidth: 10, itemHeight: 10, icon: 'roundRect', textStyle: { color: t.secondary, fontSize: 11 }, pageTextStyle: { color: t.secondary }, data: names } : { show: false };
}

function barLike(en: Engine, v: Visual, cs: Constraint[], t: VizTheme, sel: Selection | null, highlight: Constraint[] | null): ChartBuild {
  const field = activeField(v);
  const value = v.values[0];
  if (!field || !value) return empty('Add a field to Axis and Values');
  const horizontal = v.type === 'bar';
  const stacked = v.type === 'stacked' || (v.type === 'area' && Boolean(v.legend));
  const isLine = v.type === 'line' || v.type === 'area';
  const r = queryCategories(en, field, v.values, cs, { legend: v.legend, topN: v.topN ?? (horizontal ? 10 : 14) });
  if (!hasData(r)) return empty();
  const fmt = en.valueFormat(value);
  const labels = r.categories.map((c) => c.label);
  const keys = r.categories.map((c) => c.key);
  const selected = sel && sel.visualId === v.id ? new Set(sel.values) : null;
  const multi = r.series.length > 1;

  const series: Record<string, unknown>[] = r.series.map((s, i) => {
    const color = v.legend ? entityColor(en, v.legend, s.key, t) : t.series[i % 8];
    const data = s.data.map((d, k) => ({
      value: d,
      itemStyle: selected && !selected.has(keys[k]) ? { opacity: 0.28 } : r.categories[k].isOther ? { color: t.neutral } : undefined,
    }));
    if (isLine) {
      return {
        type: 'line', name: s.name, data, smooth: false, showSymbol: labels.length <= 24, symbol: 'circle', symbolSize: 8, connectNulls: false,
        stack: stacked ? 'total' : undefined, lineStyle: { width: 2, color }, itemStyle: { color, borderColor: t.surface, borderWidth: 2 },
        areaStyle: v.type === 'area' ? { color, opacity: stacked ? 0.55 : 0.16 } : undefined, emphasis: { focus: multi ? 'series' : 'none' },
      };
    }
    return {
      type: 'bar', name: s.name, data, stack: stacked ? 'total' : undefined, barMaxWidth: 28, barCategoryGap: '32%',
      itemStyle: { color, borderRadius: stacked ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0], borderColor: stacked ? t.surface : undefined, borderWidth: stacked ? 1 : 0 },
    };
  });

  let note: string | undefined;
  if (highlight && !multi && !isLine) {
    const h = queryCategories(en, field, v.values, highlight, { topN: 1000 });
    const map = new Map(h.categories.map((c, i) => [c.key, h.series[0].data[i]]));
    series[0] = { ...series[0], z: 1, itemStyle: { color: t.neutral, borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] }, data: r.series[0].data };
    series.push({ type: 'bar', name: 'Selection', z: 2, barGap: '-100%', barMaxWidth: 28, data: keys.map((k) => map.get(k) ?? null), itemStyle: { color: t.series[0], borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] } });
  }

  let finalLabels = labels;
  if (v.forecast && v.type === 'line' && !v.legend) {
    const fc = queryForecast(en, r);
    if (fc) {
      finalLabels = [...labels, ...fc.labels];
      const pad = labels.map(() => null);
      const last = r.series[0].data[labels.length - 1];
      const color = t.series[0];
      series.push(
        { type: 'line', name: 'Forecast', data: [...pad.slice(1), last, ...fc.fc.values], showSymbol: false, lineStyle: { width: 2, type: 'dashed', color }, itemStyle: { color } },
        { type: 'line', name: 'Band low', data: [...pad, ...fc.fc.low], stack: 'band', showSymbol: false, lineStyle: { opacity: 0 }, silent: true, tooltip: { show: false } },
        { type: 'line', name: '95% range', data: [...pad, ...fc.fc.high.map((h, i) => h - fc.fc.low[i])], stack: 'band', showSymbol: false, lineStyle: { opacity: 0 }, areaStyle: { color, opacity: 0.14 }, silent: true, tooltip: { show: false } },
      );
      note = `${fc.fc.method}, shaded area is a 95% range.${fc.fc.mape !== null ? ` Backtest error ${formatPct(fc.fc.mape)}.` : ''}`;
    } else note = 'At least 6 periods are needed for a forecast.';
  }

  const catAxis = { ...axisBase(t), type: 'category', data: finalLabels, inverse: horizontal, boundaryGap: !isLine, splitLine: { show: false },
    axisLabel: { ...axisBase(t).axisLabel, width: horizontal ? 104 : 96, overflow: 'truncate', interval: horizontal ? 0 : 'auto' } };
  const valAxis = { ...axisBase(t), type: 'value', axisLine: { show: false }, axisLabel: { ...axisBase(t).axisLabel, formatter: (x: number) => formatNumber(x, { ...fmt, compact: true }) } };

  const option: EChartsCoreOption = {
    animationDuration: 220, animationDurationUpdate: 220,
    grid: { left: 8, right: 16, top: multi ? 34 : 12, bottom: 4, containLabel: true },
    legend: legendOf(r.series.map((s) => s.name), t),
    xAxis: horizontal ? valAxis : catAxis,
    yAxis: horizontal ? catAxis : valAxis,
    tooltip: {
      ...tipBase(t), trigger: isLine ? 'axis' : 'item',
      axisPointer: { type: 'line', lineStyle: { color: t.axis } },
      formatter: (p: unknown) => {
        const list = (Array.isArray(p) ? p : [p]) as { dataIndex: number; seriesName: string; value: unknown; data: { value: number | null } | number | null; color: string }[];
        const idx = list[0]?.dataIndex;
        const key = keys[idx];
        if (idx === undefined || idx >= keys.length) {
          const f = list.find((x) => x.seriesName === 'Forecast');
          return f ? `<div style="padding:10px 12px"><b>${escapeHtml(finalLabels[idx])}</b>${row('Forecast', formatNumber(f.value as number, fmt), t)}</div>` : '';
        }
        if (multi || key === OTHER) {
          const items = list.map((x) => row(x.seriesName, formatNumber(typeof x.data === 'object' && x.data ? x.data.value : (x.data as number | null), fmt), t)).join('');
          return `<div style="padding:10px 12px;min-width:200px"><div style="font-weight:600;margin-bottom:6px">${escapeHtml(labels[idx])}</div>${items}</div>`;
        }
        return richTip(en, v, field, key, value, cs, r.series[0].data, t);
      },
    },
    series,
  };
  if (r.truncated > 0 && !note) note = r.chronological ? `Showing the latest ${labels.length} periods` : undefined;
  if (!note && field.part && lastPeriodIncomplete(en.numbers(field.col, en.rows(cs)), field.part)) note = `${labels[labels.length - 1]} is incomplete, so it may look lower than a full period.`;
  return { option, meta: { field, keys, labels, note } };
}

function smallMultiples(en: Engine, v: Visual, cs: Constraint[], t: VizTheme): ChartBuild {
  const field = activeField(v);
  const value = v.values[0];
  const m = v.multiples!;
  if (!field || !value) return empty('Add a field to Axis and Values');
  const panels = queryCategories(en, m, [value], cs, { topN: 7 }).categories.filter((c) => !c.isOther).slice(0, 6);
  if (!panels.length) return empty();
  const cols = panels.length <= 2 ? panels.length : 3;
  const rows = Math.ceil(panels.length / cols);
  const results = panels.map((p) => queryCategories(en, field, [value], [...cs, { col: m.col, kind: 'in', part: m.part, values: [p.key], group: true }], { topN: 8 }));
  const shared = queryCategories(en, field, [value], cs, { topN: 8 });
  const labels = shared.categories.filter((c) => !c.isOther).map((c) => c.label);
  const max = Math.max(...results.flatMap((r) => r.series[0].data.map((d) => d ?? 0)));
  const min = Math.min(0, ...results.flatMap((r) => r.series[0].data.map((d) => d ?? 0)));
  const fmt = en.valueFormat(value);
  const isLine = v.type === 'line' || v.type === 'area';
  const pct = (n: number) => `${n}%`;
  return {
    meta: { note: 'Panels share one scale so they can be compared directly' },
    option: {
      animationDuration: 200,
      title: panels.map((p, i) => ({ text: p.label, textStyle: { fontSize: 12, fontWeight: 600, color: t.ink }, left: pct((i % cols) * (100 / cols) + 1), top: pct(Math.floor(i / cols) * (100 / rows)) })),
      grid: panels.map((_, i) => ({ left: pct((i % cols) * (100 / cols) + 7), width: pct(100 / cols - 10), top: pct(Math.floor(i / cols) * (100 / rows) + 10), height: pct(100 / rows - 22) })),
      xAxis: panels.map((_, i) => ({ ...axisBase(t), gridIndex: i, type: 'category', data: labels, splitLine: { show: false }, axisLabel: { ...axisBase(t).axisLabel, fontSize: 10, width: 60, overflow: 'truncate' } })),
      yAxis: panels.map((_, i) => ({ ...axisBase(t), gridIndex: i, type: 'value', min, max, axisLine: { show: false }, axisLabel: { ...axisBase(t).axisLabel, fontSize: 10, formatter: (x: number) => formatNumber(x, { ...fmt, compact: true }) } })),
      tooltip: { ...tipBase(t), trigger: 'item', formatter: (p: { name: string; value: number; seriesName: string }) => `<div style="padding:10px 12px"><b>${escapeHtml(p.seriesName)}: ${escapeHtml(p.name)}</b>${row(en.valueLabel(value), formatNumber(p.value, fmt), t)}</div>` },
      series: panels.map((p, i) => {
        const map = new Map(results[i].categories.map((c, k) => [c.label, results[i].series[0].data[k]]));
        return { type: isLine ? 'line' : 'bar', name: p.label, xAxisIndex: i, yAxisIndex: i, data: labels.map((l) => map.get(l) ?? null), barMaxWidth: 18, symbolSize: 8, itemStyle: { color: t.series[0], borderRadius: isLine ? 0 : [4, 4, 0, 0] }, lineStyle: { width: 2, color: t.series[0] } };
      }),
    },
  };
}

function donut(en: Engine, v: Visual, cs: Constraint[], t: VizTheme, sel: Selection | null): ChartBuild {
  const field = activeField(v);
  const value = v.values[0];
  if (!field || !value) return empty('Add a field to Axis and Values');
  const r = queryCategories(en, field, [value], cs, { topN: v.topN ?? 6 });
  if (!hasData(r)) return empty();
  const fmt = en.valueFormat(value);
  const keys = r.categories.map((c) => c.key);
  const total = r.series[0].data.reduce<number>((s, d) => s + (d ?? 0), 0);
  const selected = sel && sel.visualId === v.id ? new Set(sel.values) : null;
  const hasNegative = r.series[0].data.some((d) => (d ?? 0) < 0);
  if (hasNegative) return empty('Negative values cannot be shown as parts of a whole. Use a bar chart.');
  return {
    meta: { field, keys, labels: r.categories.map((c) => c.label) },
    option: {
      animationDuration: 220,
      legend: { orient: 'vertical', right: 4, top: 'middle', icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: t.secondary, fontSize: 11, width: 112, overflow: 'truncate' },
        formatter: (n: string) => { const i = r.categories.findIndex((c) => c.label === n); return `${n}  ${formatPct((r.series[0].data[i] ?? 0) / (total || 1), 0)}`; } },
      title: { text: formatNumber(total, { ...fmt, compact: true }), subtext: 'Total', left: '32%', top: '41%', textAlign: 'center', textStyle: { color: t.ink, fontSize: 18, fontWeight: 600 }, subtextStyle: { color: t.muted, fontSize: 11 }, itemGap: 2 },
      tooltip: { ...tipBase(t), trigger: 'item', formatter: (p: { dataIndex: number }) => richTip(en, v, field, keys[p.dataIndex], value, cs, r.series[0].data, t) },
      series: [{
        type: 'pie', radius: ['56%', '82%'], center: ['33%', '50%'], avoidLabelOverlap: true, label: { show: false }, padAngle: 1.2, itemStyle: { borderRadius: 4 },
        data: r.categories.map((c, i) => ({ name: c.label, value: r.series[0].data[i], itemStyle: { color: entityColor(en, field, c.key, t), opacity: selected && !selected.has(c.key) ? 0.28 : 1 } })),
      }],
    },
  };
}

function treemap(en: Engine, v: Visual, cs: Constraint[], t: VizTheme, sel: Selection | null): ChartBuild {
  const field = activeField(v);
  const value = v.values[0];
  if (!field || !value) return empty('Add a field to Axis and Values');
  const r = queryCategories(en, field, [value], cs, { topN: v.topN ?? 16 });
  if (!hasData(r)) return empty();
  const keys = r.categories.map((c) => c.key);
  const selected = sel && sel.visualId === v.id ? new Set(sel.values) : null;
  const total = r.series[0].data.reduce<number>((s, d) => s + Math.max(0, d ?? 0), 0);
  return {
    meta: { field, keys, labels: r.categories.map((c) => c.label) },
    option: {
      animationDuration: 220,
      tooltip: { ...tipBase(t), trigger: 'item', formatter: (p: { dataIndex: number; data: { idx: number } }) => (p.data ? richTip(en, v, field, keys[p.data.idx], value, cs, r.series[0].data, t) : '') },
      series: [{
        type: 'treemap', left: 0, right: 0, top: 0, bottom: 0, roam: false, nodeClick: false, breadcrumb: { show: false }, itemStyle: { borderColor: t.surface, borderWidth: 2, gapWidth: 2, borderRadius: 4 },
        label: { show: true, color: '#fff', fontSize: 12, formatter: (p: { name: string; value: number }) => `${p.name}\n${formatPct(p.value / (total || 1), 1)}`, overflow: 'truncate' },
        data: r.categories.map((c, i) => ({ name: c.label, idx: i, value: Math.max(0, r.series[0].data[i] ?? 0), itemStyle: { color: c.isOther ? t.dark ? '#5b5a55' : '#898781' : t.dark ? '#256abf' : '#2a78d6', opacity: selected && !selected.has(c.key) ? 0.3 : 1 } })),
      }],
    },
  };
}

function pareto(en: Engine, v: Visual, cs: Constraint[], t: VizTheme): ChartBuild {
  const field = activeField(v);
  const value = v.values[0];
  if (!field || !value) return empty('Add a field to Axis and Values');
  const r = queryCategories(en, field, [value], cs, { topN: v.topN ?? 20 });
  if (!hasData(r)) return empty();
  const data = r.series[0].data.map((d) => d ?? 0);
  const total = data.reduce((a, b) => a + b, 0);
  const cum: number[] = [];
  data.reduce((s, d, i) => { cum[i] = (s + d) / (total || 1); return s + d; }, 0);
  const cut = cum.findIndex((c) => c >= 0.8) + 1 || data.length;
  const fmt = en.valueFormat(value);
  const keys = r.categories.map((c) => c.key);
  return {
    meta: { field, keys, labels: r.categories.map((c) => c.label), note: `Dark bars: ${cut} of ${data.length} groups make up 80% of the total` },
    option: {
      animationDuration: 220, grid: { left: 8, right: 12, top: 12, bottom: 4, containLabel: true },
      xAxis: { ...axisBase(t), type: 'category', data: r.categories.map((c) => c.label), splitLine: { show: false }, axisLabel: { ...axisBase(t).axisLabel, width: 80, overflow: 'truncate' } },
      yAxis: { ...axisBase(t), type: 'value', axisLine: { show: false }, axisLabel: { ...axisBase(t).axisLabel, formatter: (x: number) => formatNumber(x, { ...fmt, compact: true }) } },
      tooltip: { ...tipBase(t), trigger: 'item', formatter: (p: { dataIndex: number; name: string; value: number }) => `<div style="padding:10px 12px;min-width:190px"><b>${escapeHtml(p.name)}</b>${row(en.valueLabel(value), formatNumber(p.value, fmt), t)}${row('% of total', formatPct(p.value / (total || 1)), t)}${row('Cumulative', formatPct(cum[p.dataIndex]), t)}</div>` },
      series: [{ type: 'bar', barMaxWidth: 28, data: data.map((d, i) => ({ value: d, itemStyle: { color: i < cut ? t.series[0] : t.neutral, borderRadius: [4, 4, 0, 0] } })) }],
    },
  };
}

function variance(en: Engine, v: Visual, cs: Constraint[], t: VizTheme): ChartBuild {
  const r = queryVariance(en, v, cs);
  if (!r) return empty('Add a date to Axis and a metric to Values');
  if (!r.changes.some((c) => c !== null)) return empty('A full earlier year is needed to compare');
  const f = v.values[0] ? en.valueFormat(v.values[0]) : {};
  const keys = r.categories.map((c) => c.key);
  return {
    meta: { field: r.field, keys, labels: r.categories.map((c) => c.label), note: r.omitted ? `${r.omitted} is left out because the period is not finished.` : undefined },
    option: {
      animationDuration: 220, grid: { left: 8, right: 12, top: 12, bottom: 4, containLabel: true },
      xAxis: { ...axisBase(t), type: 'category', data: r.categories.map((c) => c.label), splitLine: { show: false }, axisLabel: { ...axisBase(t).axisLabel, position: 'bottom' }, axisLine: { onZero: false, lineStyle: { color: t.axis } } },
      yAxis: { ...axisBase(t), type: 'value', axisLine: { show: false }, axisLabel: { ...axisBase(t).axisLabel, formatter: (x: number) => formatPct(x, 0) } },
      tooltip: { ...tipBase(t), trigger: 'item', formatter: (p: { dataIndex: number; name: string }) => `<div style="padding:10px 12px;min-width:190px"><b>${escapeHtml(p.name)}</b>${row('This year', formatNumber(r.current[p.dataIndex], f), t)}${row('Last year', formatNumber(r.previous[p.dataIndex], f), t)}${row('Change', formatPct(r.changes[p.dataIndex]), t)}</div>` },
      series: [{ type: 'bar', barMaxWidth: 28, data: r.changes.map((c) => ({ value: c, itemStyle: { color: (c ?? 0) >= 0 ? t.up : t.down, borderRadius: (c ?? 0) >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4] } })) }],
    },
  };
}

function scatter(en: Engine, v: Visual, cs: Constraint[], t: VizTheme): ChartBuild {
  const s = queryScatter(en, v, cs);
  if (!s) return empty('Add two metrics to Values');
  if (!s.points.length) return empty();
  const [fx, fy] = [en.valueFormat(s.x), en.valueFormat(s.y)];
  const xs = s.points.map((p) => p.x);
  const [lo, hi] = [Math.min(...xs), Math.max(...xs)];
  const n = s.points.length;
  const series: Record<string, unknown>[] = [{ type: 'scatter', symbolSize: 8, large: n > 2000, data: s.points.map((p) => [p.x, p.y, p.label]), itemStyle: { color: t.series[0], opacity: 0.72, borderColor: t.surface, borderWidth: n > 500 ? 0 : 2 } }];
  if (s.fit) series.push({ type: 'line', showSymbol: false, silent: true, data: [[lo, s.fit.intercept + s.fit.slope * lo], [hi, s.fit.intercept + s.fit.slope * hi]], lineStyle: { color: t.secondary, width: 2 }, tooltip: { show: false } });
  return {
    meta: { note: Number.isNaN(s.r) ? undefined : `r = ${s.r.toFixed(2)} across ${n.toLocaleString()} points${s.p < 0.05 ? '' : ' (not statistically significant)'}. Association does not prove cause.` },
    option: {
      animationDuration: 220, grid: { left: 12, right: 18, top: 30, bottom: 24, containLabel: true },
      xAxis: { ...axisBase(t), type: 'value', name: s.xName, nameLocation: 'middle', nameGap: 26, scale: true, axisLabel: { ...axisBase(t).axisLabel, formatter: (x: number) => formatNumber(x, { ...fx, compact: true }) } },
      yAxis: { ...axisBase(t), type: 'value', name: s.yName, scale: true, axisLine: { show: false }, axisLabel: { ...axisBase(t).axisLabel, formatter: (x: number) => formatNumber(x, { ...fy, compact: true }) } },
      tooltip: { ...tipBase(t), trigger: 'item', formatter: (p: { data: [number, number, string] }) => `<div style="padding:10px 12px;min-width:180px"><b>${escapeHtml(p.data[2])}</b>${row(s.xName, formatNumber(p.data[0], fx), t)}${row(s.yName, formatNumber(p.data[1], fy), t)}</div>` },
      series,
    },
  };
}

function heatmap(en: Engine, v: Visual, cs: Constraint[], t: VizTheme): ChartBuild {
  const h = queryHeatmap(en, v, cs);
  if (!h) return empty('Add fields to Axis, Legend, and Values');
  if (!h.cells.some((c) => c[2] !== null)) return empty();
  const f = en.valueFormat(h.value);
  return {
    meta: { field: h.xField, keys: h.xs.map((x) => x.key), labels: h.xs.map((x) => x.label) },
    option: {
      animationDuration: 200, grid: { left: 8, right: 12, top: 8, bottom: 44, containLabel: true },
      xAxis: { ...axisBase(t), type: 'category', data: h.xs.map((x) => x.label), splitLine: { show: false }, axisLine: { show: false }, axisLabel: { ...axisBase(t).axisLabel, width: 76, overflow: 'truncate' } },
      yAxis: { ...axisBase(t), type: 'category', data: h.ys.map((y) => y.label), splitLine: { show: false }, axisLine: { show: false }, axisLabel: { ...axisBase(t).axisLabel, width: 92, overflow: 'truncate' } },
      visualMap: { min: h.min, max: h.max, calculable: false, orient: 'horizontal', left: 'center', bottom: 2, itemWidth: 10, itemHeight: 140, text: [formatNumber(h.max, { ...f, compact: true }), formatNumber(h.min, { ...f, compact: true })], textGap: 8, textStyle: { color: t.secondary, fontSize: 11 }, inRange: { color: t.seq } },
      tooltip: { ...tipBase(t), trigger: 'item', formatter: (p: { data: [number, number, number | null] }) => `<div style="padding:10px 12px;min-width:180px"><b>${escapeHtml(h.xs[p.data[0]].label)} · ${escapeHtml(h.ys[p.data[1]].label)}</b>${row(en.valueLabel(h.value), formatNumber(p.data[2], f), t)}</div>` },
      series: [{ type: 'heatmap', data: h.cells, itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 } }],
    },
  };
}

function hist(en: Engine, v: Visual, cs: Constraint[], t: VizTheme): ChartBuild {
  const h = queryHistogram(en, v, cs);
  if (!h) return empty('Add a numeric column to Values');
  if (!h.n) return empty();
  const c = en.column(h.name);
  const f = { format: c?.format, currency: c?.currency, compact: true };
  const lbl = (b: { start: number; end: number }) => `${formatNumber(b.start, f)} to ${formatNumber(b.end, f)}`;
  return {
    meta: { note: `Mean ${formatNumber(h.mean, f)}, median ${formatNumber(h.median, f)}, ${h.n.toLocaleString()} values` },
    option: {
      animationDuration: 220, grid: { left: 8, right: 12, top: 12, bottom: 4, containLabel: true },
      xAxis: { ...axisBase(t), type: 'category', data: h.bins.map((b) => formatNumber(b.start, f)), splitLine: { show: false } },
      yAxis: { ...axisBase(t), type: 'value', axisLine: { show: false }, name: 'Rows' },
      tooltip: { ...tipBase(t), trigger: 'item', formatter: (p: { dataIndex: number; value: number }) => `<div style="padding:10px 12px;min-width:180px"><b>${escapeHtml(lbl(h.bins[p.dataIndex]))}</b>${row('Rows', p.value.toLocaleString('en-US'), t)}${row('% of rows', formatPct(p.value / h.n), t)}</div>` },
      series: [{ type: 'bar', barCategoryGap: '6%', data: h.bins.map((b) => b.count), itemStyle: { color: t.series[0], borderRadius: [4, 4, 0, 0] } }],
    },
  };
}

function box(en: Engine, v: Visual, cs: Constraint[], t: VizTheme): ChartBuild {
  const b = queryBox(en, v, cs);
  if (!b) return empty('Add a numeric column to Values');
  if (!b.stats.length) return empty();
  const c = en.column(b.name);
  const f = { format: c?.format, currency: c?.currency };
  const out = b.stats.flatMap((s, i) => s.outliers.map((o) => [i, o]));
  return {
    meta: { field: b.field, keys: b.categories.map((x) => x.key), labels: b.categories.map((x) => x.label), note: out.length ? `${out.length.toLocaleString()} outliers shown as dots` : undefined },
    option: {
      animationDuration: 220, grid: { left: 8, right: 12, top: 12, bottom: 4, containLabel: true },
      xAxis: { ...axisBase(t), type: 'category', data: b.categories.map((x) => x.label), splitLine: { show: false }, axisLabel: { ...axisBase(t).axisLabel, width: 80, overflow: 'truncate' } },
      yAxis: { ...axisBase(t), type: 'value', scale: true, axisLine: { show: false }, axisLabel: { ...axisBase(t).axisLabel, formatter: (x: number) => formatNumber(x, { ...f, compact: true }) } },
      tooltip: { ...tipBase(t), trigger: 'item', formatter: (p: { seriesType: string; dataIndex: number; data: number[] }) => {
        if (p.seriesType === 'scatter') return `<div style="padding:10px 12px"><b>Outlier</b>${row(b.name, formatNumber(p.data[1], f), t)}</div>`;
        const s = b.stats[p.dataIndex];
        return `<div style="padding:10px 12px;min-width:170px"><b>${escapeHtml(b.categories[p.dataIndex].label)}</b>${row('Maximum', formatNumber(s.max, f), t)}${row('Q3', formatNumber(s.q3, f), t)}${row('Median', formatNumber(s.median, f), t)}${row('Q1', formatNumber(s.q1, f), t)}${row('Minimum', formatNumber(s.min, f), t)}</div>`;
      } },
      series: [
        { type: 'boxplot', data: b.stats.map((s) => [s.low, s.q1, s.median, s.q3, s.high]), itemStyle: { color: t.dark ? '#184f95' : '#cde2fb', borderColor: t.series[0], borderWidth: 2 }, boxWidth: [12, 44] },
        { type: 'scatter', data: out, symbolSize: 8, itemStyle: { color: t.series[1], opacity: 0.75, borderColor: t.surface, borderWidth: 1 } },
      ],
    },
  };
}

export function buildChart(en: Engine, v: Visual, pageCs: Constraint[], t: VizTheme, sel: Selection | null, highlight: Constraint[] | null): ChartBuild {
  const cs = visualConstraints(v, pageCs);
  const hl = highlight ? visualConstraints(v, highlight) : null;
  if (v.multiples && ['column', 'line', 'area', 'bar', 'stacked'].includes(v.type)) return smallMultiples(en, v, cs, t);
  switch (v.type) {
    case 'column': case 'bar': case 'stacked': case 'line': case 'area': return barLike(en, v, cs, t, sel, hl);
    case 'donut': return donut(en, v, cs, t, sel);
    case 'treemap': return treemap(en, v, cs, t, sel);
    case 'pareto': return pareto(en, v, cs, t);
    case 'variance': return variance(en, v, cs, t);
    case 'scatter': return scatter(en, v, cs, t);
    case 'heatmap': return heatmap(en, v, cs, t);
    case 'histogram': return hist(en, v, cs, t);
    case 'box': return box(en, v, cs, t);
    default: return empty();
  }
}
