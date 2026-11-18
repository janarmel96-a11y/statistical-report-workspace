import { useEffect, useRef } from 'react';
import { BarChart, BoxplotChart, HeatmapChart, LineChart, PieChart, ScatterChart, TreemapChart } from 'echarts/charts';
import { AriaComponent, GridComponent, LegendComponent, MarkLineComponent, TitleComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([
  BarChart, LineChart, PieChart, ScatterChart, HeatmapChart, BoxplotChart, TreemapChart,
  GridComponent, TooltipComponent, LegendComponent, TitleComponent, VisualMapComponent, MarkLineComponent, AriaComponent, CanvasRenderer,
]);

export interface ChartEvent { dataIndex: number; name: string; x: number; y: number; series?: string }

interface Props {
  option: EChartsCoreOption;
  label: string;
  patterns: boolean;
  onClick?: (e: ChartEvent) => void;
  onContext?: (e: ChartEvent) => void;
}

const withAria = (o: EChartsCoreOption, label: string, patterns: boolean) => ({
  ...o,
  aria: { enabled: true, label: { description: label }, decal: { show: patterns } },
});

export function EChart({ option, label, patterns, onClick, onContext }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const handlers = useRef({ onClick, onContext });
  handlers.current = { onClick, onContext };

  useEffect(() => {
    const el = host.current!;
    const inst = echarts.init(el, undefined, { renderer: 'canvas' });
    chart.current = inst;
    type P = { dataIndex: number; name: string; seriesName?: string; event?: { event?: MouseEvent; offsetX?: number; offsetY?: number } };
    const toEvent = (p: P): ChartEvent => ({ dataIndex: p.dataIndex, name: p.name, series: p.seriesName, x: p.event?.event?.clientX ?? 0, y: p.event?.event?.clientY ?? 0 });
    inst.on('click', (p) => handlers.current.onClick?.(toEvent(p as unknown as P)));
    inst.on('contextmenu', (p) => { (p as unknown as P).event?.event?.preventDefault(); handlers.current.onContext?.(toEvent(p as unknown as P)); });
    const ro = new ResizeObserver(() => inst.resize());
    ro.observe(el);
    return () => { ro.disconnect(); inst.dispose(); chart.current = null; };
  }, []);

  useEffect(() => {
    chart.current?.setOption(withAria(option, label, patterns), { notMerge: true, lazyUpdate: true });
  }, [option, label, patterns]);

  return <div ref={host} className="echart" role="img" aria-label={label} onContextMenu={(e) => e.preventDefault()} />;
}

/** Renders a chart off screen for downloads, always on a clean light background. */
export function renderChartImage(option: EChartsCoreOption, width = 1120, height = 620): { dataUrl: string; width: number; height: number } {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;left:-99999px;top:0;width:${width}px;height:${height}px`;
  document.body.appendChild(el);
  const inst = echarts.init(el, undefined, { renderer: 'canvas', width, height, devicePixelRatio: 1.5 });
  inst.setOption({ ...option, animation: false }, { notMerge: true, lazyUpdate: false });
  const dataUrl = inst.getDataURL({ type: 'png', pixelRatio: 1.5, backgroundColor: '#ffffff' });
  inst.dispose();
  el.remove();
  return { dataUrl, width: Math.round(width * 1.5), height: Math.round(height * 1.5) };
}
