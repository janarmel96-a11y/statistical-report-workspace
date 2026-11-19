// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import type { AnalystForecast } from '../core/analyst';

/** Actual values, the forecast as a dashed line, and its 95% range as a shaded band. */
export function forecastOption(b: { forecast?: AnalystForecast }, dark: boolean, big = false) {
  const f = b.forecast!;
  const labels = [...f.history.map((h) => h.label), ...f.labels];
  const pad = f.history.length - 1;
  const actual = [...f.history.map((h) => h.value), ...f.labels.map(() => null)];
  const predicted = [...Array.from({ length: pad }, () => null), f.history[pad].value, ...f.values];
  const low = [...Array.from({ length: pad + 1 }, () => null), ...f.low];
  const band = [...Array.from({ length: pad + 1 }, () => null), ...f.high.map((h, i) => h - f.low[i])];
  const ink = dark ? '#c9d3e0' : '#52606f';
  const size = big ? 15 : 10;
  return {
    animationDuration: 1400,
    animationEasing: 'cubicOut' as const,
    grid: { left: big ? 80 : 52, right: 24, top: 28, bottom: big ? 64 : 46 },
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0, textStyle: { color: ink, fontSize: size + 1 }, data: ['Actual', 'Forecast'] },
    xAxis: { type: 'category', data: labels, axisLabel: { color: ink, fontSize: size } },
    yAxis: { type: 'value', axisLabel: { color: ink, fontSize: size }, splitLine: { lineStyle: { color: dark ? '#2a3442' : '#e3e6ea' } } },
    series: [
      { name: 'Range low', type: 'line', data: low, stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, tooltip: { show: false } },
      { name: '95% range', type: 'line', data: band, stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { color: 'rgba(28,92,171,0.16)' }, tooltip: { show: false } },
      { name: 'Actual', type: 'line', data: actual, smooth: true, symbolSize: big ? 9 : 6, lineStyle: { width: big ? 4 : 2.5, color: '#1c5cab' }, itemStyle: { color: '#1c5cab' } },
      { name: 'Forecast', type: 'line', data: predicted, smooth: true, symbolSize: big ? 9 : 6, lineStyle: { width: big ? 4 : 2.5, type: 'dashed', color: '#b8860b' }, itemStyle: { color: '#b8860b' } },
    ],
  };
}

const compact = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toLocaleString('en-US', { maximumFractionDigits: 1 }));

/** Horizontal bars, largest first, that grow in one after another. `note` labels each bar's end. */
export function rankedBarsOption(rows: { label: string; value: number; note?: string }[], dark: boolean, color = '#1c5cab') {
  const ink = dark ? '#c9d3e0' : '#52606f';
  const list = [...rows].reverse();
  return {
    animationDuration: 1000,
    animationEasing: 'cubicOut' as const,
    animationDelay: (i: number) => (list.length - 1 - i) * 90,
    grid: { left: 8, right: 64, top: 6, bottom: 6, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'value', show: false },
    yAxis: { type: 'category', data: list.map((r) => r.label), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: ink, fontSize: 11, width: 150, overflow: 'truncate' } },
    series: [{
      type: 'bar', data: list.map((r, i) => ({ value: r.value, itemStyle: { color: i === list.length - 1 ? '#b8860b' : color, borderRadius: [0, 6, 6, 0] } })), barMaxWidth: 22,
      label: { show: true, position: 'right', color: ink, fontSize: 11, formatter: (p: { dataIndex: number; value: number }) => list[p.dataIndex].note ?? compact(p.value) },
    }],
  };
}

/** Shares by month as stacked columns that rise in, such as NEW and OLD patients. */
export function stackedShareOption(months: string[], series: { name: string; values: number[]; color: string }[], dark: boolean) {
  const ink = dark ? '#c9d3e0' : '#52606f';
  return {
    animationDuration: 1100,
    animationEasing: 'cubicOut' as const,
    animationDelay: (i: number) => i * 60,
    grid: { left: 40, right: 12, top: 12, bottom: 40 },
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${(v * 100).toFixed(1)}%` },
    legend: { bottom: 0, textStyle: { color: ink, fontSize: 11 } },
    xAxis: { type: 'category', data: months, axisLabel: { color: ink, fontSize: 10 } },
    yAxis: { type: 'value', max: 1, axisLabel: { color: ink, fontSize: 10, formatter: (v: number) => `${Math.round(v * 100)}%` }, splitLine: { lineStyle: { color: dark ? '#2a3442' : '#e3e6ea' } } },
    series: series.map((s) => ({ name: s.name, type: 'bar', stack: 'share', data: s.values, itemStyle: { color: s.color }, barMaxWidth: 34 })),
  };
}
