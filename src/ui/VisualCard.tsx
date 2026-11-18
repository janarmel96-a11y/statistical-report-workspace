// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { memo, useMemo, useState } from 'react';
import { ArrowDown, ArrowDownRight, ArrowUp, ArrowUpRight, Calculator, ChevronRight, CornerLeftUp, Download, Minus, MoreHorizontal, Table2, Trash2, Copy } from 'lucide-react';
import { formatCell, formatNumber, formatPct } from '../core/format';
import { resolveDesign } from '../core/design';
import { generateInsights, newId, type Insight } from '../core/insights';
import { activeField, keyLabel, OTHER, queryCategories, queryKpi, queryRange, visualConstraints, visualTable, type Visual, type VisualTable } from '../core/report';
import type { Cell, Constraint, FieldRef } from '../core/types';
import { filterSummary, pageConstraints, useStore } from '../state/store';
import { buildChart, designTheme, vizTheme } from './chartOptions';
import { Popover, Sparkline, useDarkMode } from './common';
import { EChart, type ChartEvent } from './EChart';
import { FieldIcon } from './FieldIcon';
import { IconBreakdown } from './PageElements';

export interface DrillTarget { field: FieldRef; key: Cell; label: string; constraints: Constraint[]; title: string }

function Kpi({ v, cs }: { v: Visual; cs: Constraint[] }) {
  const en = useStore((s) => s.engine)!;
  const k = useMemo(() => (v.values[0] ? queryKpi(en, v.values[0], cs) : null), [en, v, cs]);
  const range = useMemo(() => (v.range && v.values[0]?.kind === 'col' ? queryRange(en, v.values[0].col, cs) : null), [en, v, cs]);
  if (range) return <div className="kpi"><strong>{range.label}</strong><div className="kpi-foot"><span className="delta"><small>{range.note}</small></span></div></div>;
  if (!k) return <p className="empty-note">Add a metric to Values</p>;
  const up = (k.change ?? 0) >= 0;
  return (
    <div className="kpi">
      <strong title={formatNumber(k.value, k)}>{formatNumber(k.value, { ...k, compact: true })}</strong>
      <div className="kpi-foot">
        {k.change !== null ? (
          <span className={`delta ${k.change === 0 ? '' : up ? 'up' : 'down'}`}>
            {k.change === 0 ? <Minus size={13} /> : up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
            {formatPct(Math.abs(k.change))} <small>{k.previousLabel}</small>
          </span>
        ) : <span className="delta"><small>{k.n.toLocaleString()} records</small></span>}
        <Sparkline points={k.spark} />
      </div>
    </div>
  );
}

export function TableView({ t }: { t: VisualTable }) {
  const totals = t.additive.map((a, c) => (a ? t.rows.reduce((s, r) => s + (typeof r[c] === 'number' ? (r[c] as number) : 0), 0) : null));
  const showShare = t.additive.filter(Boolean).length === 1;
  const shareCol = t.additive.indexOf(true);
  const fmt = (v: Cell, c: number) => (typeof v === 'number' ? formatNumber(v, t.formats[c] ?? {}) : formatCell(v));
  return (
    <div className="vt" tabIndex={0} aria-label={`${t.title} data table`}>
      <table>
        <thead><tr>{t.headers.map((h, i) => <th key={i} className={i ? 'num' : ''}>{h}</th>)}{showShare && <th className="num">% of total</th>}</tr></thead>
        <tbody>{t.rows.slice(0, 500).map((r, i) => (
          <tr key={i}>{r.map((c, j) => <td key={j} className={j ? 'num' : ''}>{fmt(c, j)}</td>)}{showShare && <td className="num">{typeof r[shareCol] === 'number' && totals[shareCol] ? formatPct((r[shareCol] as number) / totals[shareCol]!) : '–'}</td>}</tr>
        ))}</tbody>
        {totals.some((x) => x !== null) ? (
          <tfoot><tr>{t.headers.map((_, c) => <td key={c} className={c ? 'num' : ''}>{c === 0 ? 'Total' : totals[c] !== null ? fmt(totals[c], c) : ''}</td>)}{showShare && <td className="num">100.0%</td>}</tr></tfoot>
        ) : t.overall ? (
          <tfoot><tr>{t.overall.map((x, c) => <td key={c} className={c ? 'num' : ''}>{fmt(x, c)}</td>)}</tr></tfoot>
        ) : null}
      </table>
    </div>
  );
}

function InsightItem({ i }: { i: Insight }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`insight ${i.kind}`}>
      <b className="insight-head"><FieldIcon text={i.headline} size={14} /> {i.headline}</b>
      <p>{i.text}</p>
      <button className="link" aria-expanded={open} onClick={() => setOpen(!open)}><Calculator size={13} /> {open ? 'Hide calculation' : 'How this was calculated'}</button>
      {open && (
        <dl className="audit">
          <div><dt>Calculation</dt><dd>{i.audit.formula}</dd></div>
          <div><dt>Rows used</dt><dd>{i.audit.n.toLocaleString()}</dd></div>
          {i.audit.periods && <div><dt>Periods</dt><dd>{i.audit.periods}</dd></div>}
          {i.audit.test && <div><dt>Test</dt><dd>{i.audit.test}</dd></div>}
          <div><dt>Filters</dt><dd>{i.audit.filters}</dd></div>
        </dl>
      )}
    </li>
  );
}

export function InsightsList({ cs, limit }: { cs: Constraint[]; limit?: number }) {
  const en = useStore((s) => s.engine)!;
  const slicers = useStore((s) => s.slicers);
  const selection = useStore((s) => s.selection);
  const rev = useStore((s) => s.revision);
  const list = useMemo(() => generateInsights(en, cs, filterSummary(slicers, selection, (x) => `${x.col}: ${x.values.length} selected`)), [en, cs, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!list.length) return <p className="empty-note">No reliable findings for the current filters.</p>;
  return <ul className="insights">{list.slice(0, limit ?? 12).map((i) => <InsightItem key={i.id} i={i} />)}</ul>;
}

function DataTableVisual({ v, cs }: { v: Visual; cs: Constraint[] }) {
  const en = useStore((s) => s.engine)!;
  const t = useMemo(() => visualTable(en, v, cs), [en, v, cs]);
  return t ? <TableView t={t} /> : <p className="empty-note">Add a field to Axis and Values</p>;
}

interface CardProps { visual: Visual; onDrillThrough: (t: DrillTarget) => void }

export const VisualCard = memo(function VisualCard({ visual: v, onDrillThrough }: CardProps) {
  const engine = useStore((s) => s.engine)!;
  const slicers = useStore((s) => s.slicers);
  const selection = useStore((s) => s.selection);
  const interaction = useStore((s) => s.interaction);
  const selected = useStore((s) => s.selectedVisual === v.id);
  const palette = useStore((s) => s.palette);
  const patterns = useStore((s) => s.patterns);
  const revision = useStore((s) => s.revision);
  const select = useStore((s) => s.selectVisual);
  const setSelection = useStore((s) => s.setSelection);
  const mutate = useStore((s) => s.mutateVisual);
  const mutatePage = useStore((s) => s.mutatePage);
  const report = useStore((s) => s.report)!;
  const toast = useStore((s) => s.toast);
  const dark = useDarkMode();
  const [tableView, setTableView] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; key: Cell; label: string } | null>(null);

  const pageCs = useMemo(() => pageConstraints(slicers, selection, v.id, interaction), [slicers, selection, v.id, interaction]);
  const cs = useMemo(() => visualConstraints(v, pageCs), [v, pageCs]);
  const highlight = useMemo(() => (interaction === 'highlight' && selection && selection.visualId !== v.id
    ? pageConstraints(slicers, selection, undefined, 'filter') : null), [interaction, selection, slicers, v.id]);
  const theme = useMemo(() => designTheme(vizTheme(dark, palette), resolveDesign(report.design, dark).series), [dark, palette, report.design]);
  const isChart = !['kpi', 'table', 'insights'].includes(v.type);
  const build = useMemo(() => (isChart ? buildChart(engine, v, pageCs, theme, selection, highlight) : null),
    [engine, v, pageCs, theme, selection, highlight, isChart, revision]); // eslint-disable-line react-hooks/exhaustive-deps

  const field = activeField(v);
  const level = v.drillLevel ?? 0;
  const canDown = isChart && level < v.axis.length - 1;
  const canUp = isChart && (level > 0 || Boolean(v.drillPath?.length));

  const drillDown = (key?: Cell, label?: string) => {
    if (!canDown || !field) return;
    mutate(v.id, (x) => ({ ...x, drillLevel: level + 1, drillPath: key !== undefined ? [...(x.drillPath ?? []), { field, value: key, label: label ?? String(key) }] : x.drillPath }), false);
    setSelection(null);
  };
  const drillUp = () => {
    mutate(v.id, (x) => {
      const path = x.drillPath ?? [];
      const last = path[path.length - 1];
      return { ...x, drillLevel: Math.max(0, level - 1), drillPath: last && last.field.part === x.axis[level - 1]?.part && last.field.col === x.axis[level - 1]?.col ? path.slice(0, -1) : path };
    }, false);
    setSelection(null);
  };

  const onPoint = (e: ChartEvent) => {
    select(v.id);
    const meta = build?.meta;
    if (!meta?.field || !meta.keys) return;
    const key = meta.keys[e.dataIndex];
    if (key === undefined || key === OTHER) return;
    const label = `${meta.field.col}: ${keyLabel(engine, meta.field, key)}`;
    const same = selection?.visualId === v.id && selection.values.length === 1 && selection.values[0] === key;
    setSelection(same ? null : { visualId: v.id, field: meta.field, values: [key], label });
  };
  const onContext = (e: ChartEvent) => {
    const meta = build?.meta;
    if (!meta?.field || !meta.keys) return;
    const key = meta.keys[e.dataIndex];
    if (key === undefined || key === OTHER) return;
    setMenu({ x: e.x, y: e.y, key, label: keyLabel(engine, meta.field, key) });
  };

  const body = () => {
    if (tableView && v.type !== 'insights') return <DataTableVisual v={v} cs={pageCs} />;
    if (v.type === 'kpi') return <Kpi v={v} cs={cs} />;
    if (v.type === 'table') return <DataTableVisual v={v} cs={pageCs} />;
    if (v.type === 'insights') return <InsightsList cs={cs} />;
    if (build?.meta.empty) return <p className="empty-note">{build.meta.note}</p>;
    const chart = <EChart option={build!.option} label={`${v.title}. Open the table view for exact values.`} patterns={patterns} onClick={onPoint} onContext={onContext} />;
    return field && /^(sex|gender)$/i.test(field.col.trim()) ? <><div className="chart-with-icons">{chart}</div><IconBreakdown col={field.col} cs={pageCs} compact /></> : chart;
  };

  return (
    <article className={`card ${v.type} ${selected ? 'selected' : ''}`} onMouseDown={() => select(v.id)} aria-label={v.title}>
      <header className="card-head">
        <div className="card-drag">
          <h3 title={v.title}><FieldIcon text={v.title} size={v.type === 'kpi' ? 17 : 14} className={v.type === 'kpi' ? 'kpi-badge' : ''} /> <span>{v.title}</span></h3>
          {isChart && !!v.drillPath?.length && <nav className="crumbs" aria-label="Drill path">{v.drillPath.map((d, i) => <span key={i}><ChevronRight size={11} />{d.label}</span>)}</nav>}
        </div>
        <div className="card-tools">
          {isChart && v.axis.length > 1 && <>
            <button className="icon-btn sm" aria-label="Drill up" title="Drill up" disabled={!canUp} onClick={drillUp}><ArrowUp size={14} /></button>
            <button className="icon-btn sm" aria-label="Next level" title={canDown ? `Show ${v.axis[level + 1]?.part ?? v.axis[level + 1]?.col}` : 'Lowest level'} disabled={!canDown} onClick={() => drillDown()}><ArrowDown size={14} /></button>
          </>}
          {v.type !== 'insights' && v.type !== 'table' && <button className={`icon-btn sm ${tableView ? 'active' : ''}`} aria-pressed={tableView} aria-label="Show as table" title="Show as table" onClick={() => setTableView(!tableView)}><Table2 size={14} /></button>}
          <Popover label="More options" align="right" button={() => <button className="icon-btn sm" aria-label="More options" title="More options"><MoreHorizontal size={15} /></button>}>
            {(close) => <>
              {isChart && <button onClick={() => { close(); void import('../export/reportExports').then((m) => m.exportPng({ report, engine, table: engine.table, findings: [], constraints: pageCs, filterText: '', palette }, [v], () => {})).catch((e) => toast('error', (e as Error).message)); }}><Download size={14} /> Download image</button>}
              <button onClick={() => { close(); mutatePage((p) => { const id = newId(); const pos = p.layout.find((l) => l.i === v.id)!; return { ...p, visuals: [...p.visuals, { ...v, id, title: `${v.title} copy` }], layout: [...p.layout, { ...pos, i: id, y: 999 }] }; }); }}><Copy size={14} /> Duplicate</button>
              <button className="danger" onClick={() => { close(); mutatePage((p) => ({ ...p, visuals: p.visuals.filter((x) => x.id !== v.id), layout: p.layout.filter((l) => l.i !== v.id) })); }}><Trash2 size={14} /> Remove</button>
            </>}
          </Popover>
        </div>
      </header>
      <div className="card-body">{body()}</div>
      {isChart && !tableView && build?.meta.note && !build.meta.empty && <p className="card-note">{build.meta.note}</p>}
      {menu && (
        <div className="ctx-back" onMouseDown={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}>
          <div className="ctx" role="menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
            <b>{menu.label}</b>
            {canDown && <button role="menuitem" onClick={() => { drillDown(menu.key, menu.label); setMenu(null); }}><ArrowDown size={14} /> Drill down</button>}
            {canUp && <button role="menuitem" onClick={() => { drillUp(); setMenu(null); }}><CornerLeftUp size={14} /> Drill up</button>}
            <button role="menuitem" onClick={() => {
              const f = build!.meta.field!;
              onDrillThrough({ field: f, key: menu.key, label: menu.label, constraints: [...cs, { col: f.col, kind: 'in', part: f.part, values: [menu.key] }], title: v.title });
              setMenu(null);
            }}><Table2 size={14} /> See the rows behind this</button>
          </div>
        </div>
      )}
    </article>
  );
});

/** Used by the fields pane to preview slicer values. */
export function slicerOptions(engine: NonNullable<ReturnType<typeof useStore.getState>['engine']>, f: FieldRef) {
  return queryCategories(engine, f, [{ kind: 'col', col: f.col, agg: 'rows' }], [], { topN: 2000 }).categories.filter((c) => !c.isOther);
}
