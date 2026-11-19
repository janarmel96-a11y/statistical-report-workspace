// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import type { AnalystBrief } from '../core/analyst';

/** Actual values, the forecast as a dashed line, and its 95% range as a shaded band. */
export function forecastOption(b: AnalystBrief, dark: boolean, big = false) {
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
